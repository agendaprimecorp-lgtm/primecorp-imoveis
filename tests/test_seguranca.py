"""Testes do Sprint 1 — segurança. Não exigem banco."""
import os
from datetime import datetime, timezone

import pyotp
import pytest

from app import security as s
from app.config import Config, ErroDeConfiguracao


# ---------------- Senha ----------------

def test_hash_argon2id_e_verificacao():
    h = s.gerar_hash("PrimeCorp#2026!Forte")
    assert h.startswith("$argon2id$")
    ok, _ = s.verificar_senha(h, "PrimeCorp#2026!Forte")
    assert ok
    ruim, _ = s.verificar_senha(h, "PrimeCorp#2026!Fortf")
    assert not ruim


def test_hashes_diferentes_para_mesma_senha():
    """Salt aleatório: dois hashes da mesma senha nunca coincidem."""
    assert s.gerar_hash("SenhaLongaValida1") != s.gerar_hash("SenhaLongaValida1")


@pytest.mark.parametrize("fraca", ["primecorp", "curta", "12345", ""])
def test_rejeita_senha_fraca(fraca):
    with pytest.raises(s.SenhaFraca):
        s.gerar_hash(fraca)


def test_hash_invalido_nao_lanca():
    ok, novo = s.verificar_senha("nao-e-um-hash", "qualquer")
    assert not ok and novo is None


# ---------------- Sessão ----------------

def test_token_de_sessao_depende_do_segredo():
    tk = s.emitir_sessao("A" * 48, 8)
    assert s.hash_token("A" * 48, tk.bruto) == tk.hash
    assert s.hash_token("B" * 48, tk.bruto) != tk.hash   # vazar só o banco não basta


def test_token_bruto_tem_entropia_suficiente():
    tk = s.emitir_sessao("A" * 48, 8)
    assert len(tk.bruto) >= 43          # 32 bytes em base64url
    assert tk.expira_em > datetime.now(timezone.utc)


def test_comparar_hash_tolera_tamanhos_diferentes():
    """Regressão do bug do server.mjs: comparação não pode lançar exceção."""
    assert s.comparar_hash("abc", "abcdefghij") is False
    assert s.comparar_hash("", "x") is False
    assert s.comparar_hash("igual", "igual") is True


# ---------------- MFA ----------------

def test_totp_aceita_codigo_corrente_e_recusa_invalido():
    seg = s.gerar_segredo_mfa()
    assert s.verificar_totp(seg, pyotp.TOTP(seg).now())
    assert not s.verificar_totp(seg, "000000")


@pytest.mark.parametrize("entrada", ["", "12345", "1234567", "abcdef", None])
def test_totp_rejeita_formato_invalido(entrada):
    assert not s.verificar_totp(s.gerar_segredo_mfa(), entrada)


def test_uri_de_provisionamento_identifica_o_emissor():
    uri = s.uri_provisionamento(s.gerar_segredo_mfa(), "ana@primecorp.com.br")
    assert uri.startswith("otpauth://totp/") and "PrimeCorp" in uri


# ---------------- Força bruta ----------------

def test_sem_bloqueio_abaixo_do_limite():
    assert s.calcular_bloqueio(4, 5, 15) is None


def test_bloqueio_cresce_e_tem_teto():
    d1 = s.calcular_bloqueio(5, 5, 15)
    d2 = s.calcular_bloqueio(15, 5, 15)
    teto = s.calcular_bloqueio(500, 5, 15)
    assert d1 < d2 <= teto
    horas = (teto - datetime.now(timezone.utc)).total_seconds() / 3600
    assert 23 < horas < 25          # teto de 24 h


# ---------------- Configuração fail-closed ----------------

def _ambiente(**extra):
    base = {
        "AMBIENTE": "producao",
        "DATABASE_URL": "postgresql://u:p@db:5432/pc?sslmode=require",
        "APP_SECRET": "k" * 48,
        "COOKIE_SECURE": "1",
    }
    base.update(extra)
    return base


def test_config_valida_carrega(monkeypatch):
    for k, v in _ambiente().items():
        monkeypatch.setenv(k, v)
    assert Config.carregar().ambiente == "producao"


@pytest.mark.parametrize("segredo", [
    "change-me-primecorp-v3",
    "primecorp-dev-admin",
    "troque-por-outro-segredo-longo",
    "curto",
])
def test_recusa_segredo_de_exemplo_ou_curto(monkeypatch, segredo):
    for k, v in _ambiente(APP_SECRET=segredo).items():
        monkeypatch.setenv(k, v)
    with pytest.raises(ErroDeConfiguracao):
        Config.carregar()


def test_recusa_segredo_ausente(monkeypatch):
    for k, v in _ambiente().items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("APP_SECRET")
    with pytest.raises(ErroDeConfiguracao):
        Config.carregar()


def test_producao_recusa_cookie_inseguro(monkeypatch):
    for k, v in _ambiente(COOKIE_SECURE="0").items():
        monkeypatch.setenv(k, v)
    with pytest.raises(ErroDeConfiguracao, match="COOKIE_SECURE"):
        Config.carregar()


def test_producao_recusa_feed_privado(monkeypatch):
    for k, v in _ambiente(ALLOW_PRIVATE_FEEDS="1").items():
        monkeypatch.setenv(k, v)
    with pytest.raises(ErroDeConfiguracao, match="SSRF"):
        Config.carregar()


def test_producao_exige_sslmode_no_banco(monkeypatch):
    for k, v in _ambiente(DATABASE_URL="postgresql://u:p@db:5432/pc").items():
        monkeypatch.setenv(k, v)
    with pytest.raises(ErroDeConfiguracao, match="sslmode"):
        Config.carregar()
