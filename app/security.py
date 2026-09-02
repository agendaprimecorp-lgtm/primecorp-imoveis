"""
Segurança: hashing Argon2id, MFA por TOTP, sessões revogáveis e proteção
contra força bruta.

Corrige:
  P0-1  senha única em texto plano, sem rate-limit, comparada com hmac.compare_digest
  P1-3  logout que apagava o cookie mas deixava o token válido por 12 h
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pyotp
from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

# Parâmetros alinhados ao perfil de segunda recomendação do OWASP para Argon2id.
# 64 MiB de memória, 3 iterações, paralelismo 4.
_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=64 * 1024,
    parallelism=4,
    hash_len=32,
    salt_len=16,
    type=Type.ID,
)

TAMANHO_MINIMO_SENHA = 12


class SenhaFraca(ValueError):
    pass


def validar_forca(senha: str) -> None:
    """Regra de comprimento primeiro — é o fator que mais importa."""
    if len(senha) < TAMANHO_MINIMO_SENHA:
        raise SenhaFraca(f"A senha precisa de ao menos {TAMANHO_MINIMO_SENHA} caracteres.")
    if senha.lower() in {"primecorp", "primecorp123", "senha123456", "123456789012"}:
        raise SenhaFraca("Senha trivial.")


def gerar_hash(senha: str) -> str:
    validar_forca(senha)
    return _hasher.hash(senha)


def verificar_senha(hash_armazenado: str, senha: str) -> tuple[bool, str | None]:
    """
    Retorna (ok, novo_hash_ou_None). O novo hash aparece quando os parâmetros
    do Argon2 evoluíram e vale regravar de forma transparente no próximo login.
    """
    try:
        _hasher.verify(hash_armazenado, senha)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False, None
    if _hasher.check_needs_rehash(hash_armazenado):
        return True, _hasher.hash(senha)
    return True, None


# ------------------------------------------------------------------
# Sessões
# ------------------------------------------------------------------

@dataclass(frozen=True)
class TokenSessao:
    bruto: str        # vai para o cookie — nunca é persistido
    hash: str         # vai para a tabela sessions.token_hash
    expira_em: datetime


def emitir_sessao(app_secret: str, horas: int) -> TokenSessao:
    bruto = secrets.token_urlsafe(48)
    return TokenSessao(
        bruto=bruto,
        hash=hash_token(app_secret, bruto),
        expira_em=datetime.now(timezone.utc) + timedelta(hours=horas),
    )


def hash_token(app_secret: str, token_bruto: str) -> str:
    """
    HMAC-SHA256 com o segredo da aplicação (keyed hash), não SHA-256 puro:
    um vazamento apenas do banco não permite montar tabela de correspondência
    sem também obter o APP_SECRET.
    """
    return hmac.new(app_secret.encode(), token_bruto.encode(), hashlib.sha256).hexdigest()


def comparar_hash(a: str, b: str) -> bool:
    """
    Comparação em tempo constante tolerante a tamanhos diferentes.

    Corrige o P2-2 do server.mjs: `crypto.timingSafeEqual` lança exceção
    quando os buffers têm tamanhos distintos, o que virava erro 500 acionável
    remotamente. `hmac.compare_digest` trata isso sem lançar.
    """
    return hmac.compare_digest(a or "", b or "")


# ------------------------------------------------------------------
# MFA — TOTP
# ------------------------------------------------------------------

def gerar_segredo_mfa() -> str:
    return pyotp.random_base32()


def uri_provisionamento(segredo: str, email: str, emissor: str = "PrimeCorp") -> str:
    return pyotp.TOTP(segredo).provisioning_uri(name=email, issuer_name=emissor)


def verificar_totp(segredo: str, codigo: str, janela: int = 1) -> bool:
    """janela=1 tolera ±30 s de desvio de relógio."""
    if not segredo or not codigo:
        return False
    codigo = codigo.strip().replace(" ", "")
    if not codigo.isdigit() or len(codigo) != 6:
        return False
    return pyotp.TOTP(segredo).verify(codigo, valid_window=janela)


def gerar_codigos_recuperacao(quantidade: int = 8) -> list[str]:
    return [f"{secrets.token_hex(4)}-{secrets.token_hex(4)}" for _ in range(quantidade)]


def hash_codigo_recuperacao(app_secret: str, codigo: str) -> str:
    return hash_token(app_secret, codigo.strip().lower())


# ------------------------------------------------------------------
# Força bruta
# ------------------------------------------------------------------

def calcular_bloqueio(tentativas_falhas: int, max_tentativas: int, minutos: int) -> datetime | None:
    """
    Backoff exponencial limitado: o bloqueio dobra a cada bloco de falhas,
    com teto de 24 h. Torna a enumeração de senha inviável sem punir
    permanentemente quem apenas errou a digitação.
    """
    if tentativas_falhas < max_tentativas:
        return None
    excedente = tentativas_falhas - max_tentativas
    fator = min(2 ** (excedente // max_tentativas), 96)   # 96 × 15 min = 24 h
    return datetime.now(timezone.utc) + timedelta(minutes=minutos * fator)
