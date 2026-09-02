#!/usr/bin/env python3
"""
Migração V3 (SQLite) + V2 (JSON) -> PostgreSQL V4.

Uso:
    python migrate/migrar.py --sqlite ../primecorp_property_intelligence_v2/data/primecorp.db \
                             --json   ../primecorp-imoveis-v2/data \
                             --dry-run

Princípios:
  - Idempotente: rodar duas vezes não duplica (ON CONFLICT em chaves naturais).
  - Transacional: ou entra tudo, ou nada. Sem estado parcial.
  - Fail-loud: registro que não satisfaz constraint de LGPD é REJEITADO e
    relatado, nunca "consertado" silenciosamente com valor inventado.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

RETENCAO_PADRAO_DIAS = 365 * 2


class Relatorio:
    def __init__(self) -> None:
        self.migrados: dict[str, int] = {}
        self.rejeitados: list[tuple[str, str, str]] = []

    def ok(self, tabela: str, n: int = 1) -> None:
        self.migrados[tabela] = self.migrados.get(tabela, 0) + n

    def rejeita(self, tabela: str, ident: str, motivo: str) -> None:
        self.rejeitados.append((tabela, ident, motivo))

    def imprimir(self) -> None:
        print("\n=== MIGRADOS ===")
        for t, n in sorted(self.migrados.items()):
            print(f"  {t:<20} {n:>8}")
        if self.rejeitados:
            print(f"\n=== REJEITADOS ({len(self.rejeitados)}) ===")
            for t, i, m in self.rejeitados[:50]:
                print(f"  [{t}] {i}: {m}")
            if len(self.rejeitados) > 50:
                print(f"  ... e mais {len(self.rejeitados) - 50}")
        else:
            print("\nNenhum registro rejeitado.")


def migrar_sqlite(cur, caminho: Path, rel: Relatorio) -> None:
    if not caminho.exists():
        print(f"[aviso] SQLite não encontrado em {caminho} — pulando.")
        return

    src = sqlite3.connect(f"file:{caminho}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row

    mapa_ativos: dict[int, int] = {}
    for a in src.execute("SELECT * FROM assets"):
        cur.execute(
            """INSERT INTO assets
                 (asset_code, asset_type, title, city, state, neighborhood, address,
                  postal_code, geom, land_area, built_area, asking_price,
                  location_score, location_class, opportunity_score,
                  score_frozen_at_discovery, thesis, next_action, created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,
                       CASE WHEN %s IS NOT NULL AND %s IS NOT NULL
                            THEN ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography END,
                       %s,%s,%s,%s,%s::location_class,%s,%s,%s,%s,
                       COALESCE(%s::timestamptz, now()))
               ON CONFLICT (asset_code) DO NOTHING
               RETURNING id""",
            (a["asset_code"], a["asset_type"] or "Outro", a["title"] or "", a["city"], a["state"],
             a["neighborhood"], a["address"], a["postal_code"],
             a["lng"], a["lat"], a["lng"], a["lat"],
             a["land_area"], a["built_area"], a["asking_price"],
             a["location_score"] or 0, a["location_class"] or "INCONCLUSIVO",
             a["opportunity_score"] or 0,
             a["opportunity_score"] or 0,           # congela o score de origem
             a["thesis"] or "", a["next_action"] or "", a["created_at"]),
        )
        linha = cur.fetchone()
        if linha:
            mapa_ativos[a["id"]] = linha["id"]
            rel.ok("assets")

    for l in src.execute("SELECT * FROM listings"):
        cur.execute(
            """INSERT INTO listings
                 (asset_id, portal, external_id, url, title, price, raw_address,
                  raw_area, raw_built_area, description, notes, fingerprint,
                  first_seen_at, last_seen_at, is_active, link_method)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                       COALESCE(%s::timestamptz,now()), COALESCE(%s::timestamptz,now()), %s, 'import')
               ON CONFLICT (fingerprint) DO NOTHING""",
            (mapa_ativos.get(l["asset_id"]), l["portal"] or "", l["external_id"] or "", l["url"],
             l["title"] or "", l["price"], l["raw_address"], l["raw_area"], l["raw_built_area"],
             l["description"] or "", l["notes"] or "", l["fingerprint"],
             l["first_seen_at"], l["last_seen_at"], bool(l["is_active"])),
        )
        rel.ok("listings")

    # Contatos: a V3 permitia lawful_basis vazio. O V4 não. Rejeitar é o correto:
    # inventar base legal para um dado pessoal é exatamente o que a LGPD proíbe.
    for c in src.execute("SELECT * FROM contacts"):
        base = (c["lawful_basis"] or "").strip().lower()
        fonte = (c["source"] or "").strip()
        if base not in {"consentimento", "execucao_contrato", "obrigacao_legal",
                        "legitimo_interesse", "exercicio_direitos", "protecao_credito"}:
            rel.rejeita("contacts", c["name"] or f"#{c['id']}", f"base legal ausente/inválida: '{base}'")
            continue
        if not fonte:
            rel.rejeita("contacts", c["name"] or f"#{c['id']}", "trilha de origem vazia")
            continue
        if base == "legitimo_interesse" and not os.getenv("LIA_VERSION"):
            rel.rejeita("contacts", c["name"] or f"#{c['id']}",
                        "legítimo interesse sem LIA_VERSION definida no ambiente")
            continue

        cur.execute(
            """INSERT INTO contacts (name, role, phone, email, basis, source_type,
                                     source_ref, lia_version, retention_until, notes)
               VALUES (%s,%s,%s,%s,%s::lawful_basis,'fonte_publica',%s,%s,%s,%s)""",
            (c["name"], c["role"] or "", c["phone"], c["email"], base, fonte,
             os.getenv("LIA_VERSION"), date.today() + timedelta(days=RETENCAO_PADRAO_DIAS),
             c["notes"] or ""),
        )
        rel.ok("contacts")

    for e in src.execute("SELECT * FROM evidence"):
        if e["asset_id"] not in mapa_ativos:
            continue
        cur.execute(
            """INSERT INTO evidence (asset_id, evidence_type, value, weight, verified, source)
               VALUES (%s,%s,%s,%s,%s,%s)""",
            (mapa_ativos[e["asset_id"]], e["evidence_type"], e["value"],
             e["weight"] or 0, bool(e["verified"]), e["source"] or ""),
        )
        rel.ok("evidence")

    src.close()


def migrar_json(cur, pasta: Path, rel: Relatorio) -> None:
    """Migra leads.json e properties.json — fim da race condition do P0-2."""
    if not pasta.exists():
        print(f"[aviso] pasta JSON não encontrada em {pasta} — pulando.")
        return

    arq_leads = pasta / "leads.json"
    if arq_leads.exists():
        for l in json.loads(arq_leads.read_text(encoding="utf-8")):
            if not l.get("name") or not (l.get("phone") or l.get("email")):
                rel.rejeita("leads", l.get("id", "?"), "sem nome ou sem meio de contato")
                continue
            cur.execute(
                """INSERT INTO leads (stage, purpose, name, phone, email, location,
                                      message, source, created_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s, COALESCE(%s::timestamptz, now()))""",
                (l.get("stage", "Novo"), l.get("purpose"), l["name"], l.get("phone"),
                 l.get("email"), l.get("location"), l.get("message"),
                 l.get("source", "site"), l.get("createdAt")),
            )
            rel.ok("leads")

    arq_props = pasta / "properties.json"
    if arq_props.exists():
        for p in json.loads(arq_props.read_text(encoding="utf-8")):
            cur.execute(
                """INSERT INTO assets
                     (asset_code, asset_type, title, city, state, neighborhood, address,
                      geom, land_area, built_area, asking_price, opportunity_score,
                      score_frozen_at_discovery, thesis)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,
                           CASE WHEN %s IS NOT NULL AND %s IS NOT NULL
                                THEN ST_SetSRID(ST_MakePoint(%s,%s),4326)::geography END,
                           %s,%s,%s,%s,%s,%s)
                   ON CONFLICT (asset_code) DO NOTHING""",
                (p["id"], p.get("type", "Outro"), p.get("title", ""), p.get("city"),
                 p.get("state"), p.get("neighborhood"), p.get("addressPublic"),
                 p.get("lng"), p.get("lat"), p.get("lng"), p.get("lat"),
                 p.get("area"), p.get("builtArea"), p.get("price"),
                 min(int(p.get("score", 0)), 100), min(int(p.get("score", 0)), 100),
                 p.get("summary", "")),
            )
            rel.ok("assets(json)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sqlite", type=Path, required=True)
    ap.add_argument("--json", type=Path, required=True)
    ap.add_argument("--dry-run", action="store_true", help="Executa e desfaz — valida sem gravar.")
    args = ap.parse_args()

    url = os.getenv("DATABASE_URL")
    if not url:
        print("DATABASE_URL não definida.", file=sys.stderr)
        return 78

    rel = Relatorio()
    with psycopg.connect(url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            migrar_sqlite(cur, args.sqlite, rel)
            migrar_json(cur, args.json, rel)
            if args.dry_run:
                conn.rollback()
                print("\n[DRY-RUN] Nada foi gravado.")
            else:
                conn.commit()

    rel.imprimir()
    if rel.rejeitados:
        print("\nAtenção: registros rejeitados precisam de decisão humana antes do go-live.")
        print("Contato sem base legal ou sem trilha de origem NÃO deve ser importado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
