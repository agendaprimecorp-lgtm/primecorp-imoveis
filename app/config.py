"""
Configuração fail-closed.

Correção do P0-1: a V3 subia com `ADMIN_PASSWORD="primecorp"` e
`APP_SECRET="change-me-primecorp-v3"` quando o .env não era carregado —
qualquer pessoa poderia forjar cookie de sessão. Aqui a aplicação
RECUSA A INICIAR se um segredo obrigatório estiver ausente, curto ou
com valor de exemplo.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass

MIN_SECRET_LEN = 32

# Valores que já circularam em repositório/documentação — nunca aceitos.
VALORES_PROIBIDOS = {
    "change-me-primecorp-v3",
    "primecorp",
    "primecorp-dev-admin",
    "primecorp-dev-secret-change-me",
    "troque-esta-senha",
    "gere-uma-chave-longa-e-aleatoria",
    "troque-por-uma-chave-longa-e-unica",
    "troque-por-outro-segredo-longo",
    "changeme",
    "secret",
}


class ErroDeConfiguracao(RuntimeError):
    pass


def _obrigatorio(nome: str, *, segredo: bool = False) -> str:
    valor = os.getenv(nome, "").strip()
    if not valor:
        raise ErroDeConfiguracao(f"{nome} não definida. A aplicação não sobe sem ela.")
    if segredo:
        if valor.lower() in VALORES_PROIBIDOS:
            raise ErroDeConfiguracao(
                f"{nome} usa um valor de exemplo conhecido publicamente. "
                f"Gere um novo com: python -c \"import secrets;print(secrets.token_urlsafe(48))\""
            )
        if len(valor) < MIN_SECRET_LEN:
            raise ErroDeConfiguracao(
                f"{nome} tem {len(valor)} caracteres; o mínimo é {MIN_SECRET_LEN}."
            )
    return valor


def _bool(nome: str, padrao: bool = False) -> bool:
    return os.getenv(nome, "1" if padrao else "0").strip().lower() in {"1", "true", "yes", "sim"}


def _int(nome: str, padrao: int) -> int:
    try:
        return int(os.getenv(nome, str(padrao)))
    except ValueError:
        raise ErroDeConfiguracao(f"{nome} deve ser um inteiro.")


@dataclass(frozen=True)
class Config:
    database_url: str
    app_secret: str
    ambiente: str
    cookie_secure: bool
    session_hours: int
    max_login_attempts: int
    lockout_minutes: int
    login_rate_per_ip: int
    mfa_obrigatorio_para: frozenset[str]
    google_maps_key: str
    allow_private_feeds: bool

    @classmethod
    def carregar(cls) -> "Config":
        ambiente = os.getenv("AMBIENTE", "producao").strip().lower()
        if ambiente not in {"producao", "homologacao", "desenvolvimento"}:
            raise ErroDeConfiguracao("AMBIENTE deve ser producao, homologacao ou desenvolvimento.")

        cfg = cls(
            database_url=_obrigatorio("DATABASE_URL"),
            app_secret=_obrigatorio("APP_SECRET", segredo=True),
            ambiente=ambiente,
            cookie_secure=_bool("COOKIE_SECURE", padrao=True),
            session_hours=_int("SESSION_HOURS", 8),
            max_login_attempts=_int("MAX_LOGIN_ATTEMPTS", 5),
            lockout_minutes=_int("LOCKOUT_MINUTES", 15),
            login_rate_per_ip=_int("LOGIN_RATE_PER_IP", 20),
            mfa_obrigatorio_para=frozenset(
                p.strip() for p in os.getenv("MFA_OBRIGATORIO_PARA", "admin,corretor,juridico").split(",") if p.strip()
            ),
            google_maps_key=os.getenv("GOOGLE_MAPS_API_KEY", "").strip(),
            allow_private_feeds=_bool("ALLOW_PRIVATE_FEEDS", padrao=False),
        )

        # Em produção não se abre exceção para cookie inseguro nem feed privado.
        if cfg.ambiente == "producao":
            if not cfg.cookie_secure:
                raise ErroDeConfiguracao("COOKIE_SECURE=0 é proibido em produção.")
            if cfg.allow_private_feeds:
                raise ErroDeConfiguracao("ALLOW_PRIVATE_FEEDS=1 é proibido em produção (SSRF).")
            if "sslmode=" not in cfg.database_url:
                raise ErroDeConfiguracao("DATABASE_URL em produção precisa declarar sslmode.")
        return cfg


def carregar_ou_abortar() -> Config:
    try:
        return Config.carregar()
    except ErroDeConfiguracao as e:
        print(f"\n[BOOT ABORTADO] {e}\n", file=sys.stderr)
        raise SystemExit(78)  # EX_CONFIG
