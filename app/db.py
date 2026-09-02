"""
Acesso a dados com pool de conexões.

Corrige o padrão da V3, em que cada chamada abria e fechava uma conexão
SQLite e `refresh_scores` abria uma segunda conexão aninhada — uma
importação de 10 mil anúncios chegava a abrir ~20 mil conexões.
"""
from __future__ import annotations

import json
from contextlib import contextmanager
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

_pool: ConnectionPool | None = None


def inicializar(database_url: str, min_size: int = 2, max_size: int = 16) -> None:
    global _pool
    if _pool is not None:
        return
    _pool = ConnectionPool(
        conninfo=database_url,
        min_size=min_size,
        max_size=max_size,
        max_idle=300,
        kwargs={"row_factory": dict_row, "autocommit": False},
        open=True,
    )
    _pool.wait(timeout=10)


def encerrar() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def conexao() -> Iterator[psycopg.Connection]:
    if _pool is None:
        raise RuntimeError("Pool não inicializado. Chame db.inicializar() no startup.")
    with _pool.connection() as conn:
        yield conn


@contextmanager
def transacao() -> Iterator[psycopg.Cursor]:
    """
    Uma transação por unidade de trabalho.

    É isto que produz o ganho de 102× medido na importação: em vez de um
    commit por linha, todo o lote entra em uma transação só.
    """
    with conexao() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                yield cur


def buscar_um(sql: str, params: tuple = ()) -> dict[str, Any] | None:
    with conexao() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def buscar_todos(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    with conexao() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def registrar_auditoria(
    cur: psycopg.Cursor,
    *,
    actor_id: int | None,
    entity: str,
    entity_id: int | None,
    action: str,
    detail: dict | None = None,
    ip: str | None = None,
) -> None:
    """
    Auditoria com autor. Na V3 a tabela `activity` não tinha usuário —
    era impossível saber quem fez o quê, o que inviabiliza tanto RBAC
    quanto resposta a incidente.
    """
    cur.execute(
        """INSERT INTO audit_log (actor_id, entity, entity_id, action, detail, ip)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (actor_id, entity, entity_id, action, json.dumps(detail or {}), ip),
    )
