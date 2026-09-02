"""
Autenticação e autorização.

Fluxo: senha (Argon2id) -> TOTP quando exigido pelo papel -> sessão
persistida no banco, revogável, com expiração absoluta.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any, Iterable

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field

from . import db, security
from .config import Config

router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE = "primecorp_session"


# ------------------------------------------------------------------
# Modelos
# ------------------------------------------------------------------

class LoginIn(BaseModel):
    email: EmailStr
    senha: str = Field(min_length=1, max_length=256)
    codigo_mfa: str | None = Field(default=None, max_length=16)


class TrocaSenhaIn(BaseModel):
    senha_atual: str = Field(min_length=1, max_length=256)
    senha_nova: str = Field(min_length=security.TAMANHO_MINIMO_SENHA, max_length=256)


class UsuarioSessao(BaseModel):
    id: int
    email: str
    full_name: str
    papeis: list[str]
    mfa_enabled: bool
    creci_ativo: bool


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _cfg(request: Request) -> Config:
    return request.app.state.cfg


def _ip(request: Request) -> str | None:
    # Confiar apenas no proxy reverso controlado; ver nginx/primecorp.conf.
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


def _registrar_tentativa(cur, email: str | None, ip: str | None, ok: bool, motivo: str) -> None:
    cur.execute(
        "INSERT INTO login_attempts (email, ip, success, reason) VALUES (%s, %s, %s, %s)",
        (email, ip, ok, motivo),
    )


def _rate_limit_ip(cur, ip: str | None, limite: int) -> None:
    """
    Rate limit por IP baseado no banco, não em um dicionário na memória.

    Corrige o P2-1 do server.mjs, cujo `Map` de rate limit nunca era
    expurgado — vazamento de memória proporcional ao número de IPs vistos.
    Aqui a janela é uma consulta com índice e a limpeza é um DELETE agendado.
    """
    if ip is None:
        return
    cur.execute(
        """SELECT count(*) AS n FROM login_attempts
           WHERE ip = %s AND success = false AND created_at > now() - interval '15 minutes'""",
        (ip,),
    )
    if (cur.fetchone() or {}).get("n", 0) >= limite:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Muitas tentativas a partir deste endereço. Tente novamente em alguns minutos.",
        )


def _papeis(cur, user_id: int) -> list[str]:
    cur.execute(
        """SELECT r.code FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = %s ORDER BY r.code""",
        (user_id,),
    )
    return [linha["code"] for linha in cur.fetchall()]


# ------------------------------------------------------------------
# Dependências
# ------------------------------------------------------------------

def usuario_atual(request: Request) -> UsuarioSessao:
    cfg = _cfg(request)
    bruto = request.cookies.get(COOKIE, "")
    if not bruto:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Não autenticado")

    th = security.hash_token(cfg.app_secret, bruto)
    with db.transacao() as cur:
        cur.execute(
            """SELECT s.id AS sid, u.id, u.email, u.full_name, u.mfa_enabled,
                      creci_ativo(u.id) AS creci_ok
               FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.token_hash = %s AND s.revoked_at IS NULL
                 AND s.expires_at > now() AND u.is_active""",
            (th,),
        )
        linha = cur.fetchone()
        if not linha:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão inválida ou expirada")

        cur.execute("UPDATE sessions SET last_seen_at = now() WHERE id = %s", (linha["sid"],))
        return UsuarioSessao(
            id=linha["id"],
            email=linha["email"],
            full_name=linha["full_name"],
            papeis=_papeis(cur, linha["id"]),
            mfa_enabled=linha["mfa_enabled"],
            creci_ativo=linha["creci_ok"],
        )


def exigir_papeis(*permitidos: str):
    """Uso: Depends(exigir_papeis('admin', 'corretor'))"""
    def _dep(u: Annotated[UsuarioSessao, Depends(usuario_atual)]) -> UsuarioSessao:
        if "admin" in u.papeis or any(p in u.papeis for p in permitidos):
            return u
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"Ação restrita aos papéis: {', '.join(permitidos)}",
        )
    return _dep


def exigir_creci(u: Annotated[UsuarioSessao, Depends(usuario_atual)]) -> UsuarioSessao:
    """
    Intermediação imobiliária depende de CRECI válido (Lei 6.530/1978).
    O banco também trava via trigger; esta checagem devolve erro legível
    antes de chegar lá.
    """
    if not u.creci_ativo:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Ação de intermediação exige CRECI válido vinculado ao usuário.",
        )
    return u


# ------------------------------------------------------------------
# Rotas
# ------------------------------------------------------------------

@router.post("/login")
def login(dados: LoginIn, request: Request, response: Response) -> dict[str, Any]:
    cfg = _cfg(request)
    ip = _ip(request)
    agora = datetime.now(timezone.utc)

    with db.transacao() as cur:
        _rate_limit_ip(cur, ip, cfg.login_rate_per_ip)

        cur.execute(
            """SELECT id, email, full_name, password_hash, mfa_secret, mfa_enabled,
                      is_active, failed_attempts, locked_until, creci_ativo(id) AS creci_ok
               FROM users WHERE email = %s""",
            (dados.email,),
        )
        u = cur.fetchone()

        # Verifica o hash mesmo com usuário inexistente para não vazar,
        # pelo tempo de resposta, quais e-mails existem na base.
        hash_alvo = u["password_hash"] if u else security._hasher.hash("usuario-inexistente")
        senha_ok, novo_hash = security.verificar_senha(hash_alvo, dados.senha)

        if not u or not u["is_active"]:
            _registrar_tentativa(cur, dados.email, ip, False, "usuario_inexistente_ou_inativo")
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciais inválidas")

        if u["locked_until"] and u["locked_until"] > agora:
            _registrar_tentativa(cur, dados.email, ip, False, "bloqueado")
            raise HTTPException(
                status.HTTP_423_LOCKED,
                f"Conta bloqueada até {u['locked_until'].astimezone().strftime('%H:%M')}.",
            )

        if not senha_ok:
            falhas = u["failed_attempts"] + 1
            bloqueio = security.calcular_bloqueio(falhas, cfg.max_login_attempts, cfg.lockout_minutes)
            cur.execute(
                "UPDATE users SET failed_attempts = %s, locked_until = %s WHERE id = %s",
                (falhas, bloqueio, u["id"]),
            )
            _registrar_tentativa(cur, dados.email, ip, False, "senha_incorreta")
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Credenciais inválidas")

        papeis = _papeis(cur, u["id"])
        precisa_mfa = u["mfa_enabled"] or bool(set(papeis) & cfg.mfa_obrigatorio_para)

        if precisa_mfa:
            if not u["mfa_enabled"]:
                _registrar_tentativa(cur, dados.email, ip, False, "mfa_nao_cadastrado")
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    "Seu papel exige MFA. Conclua o cadastro em /api/auth/mfa/setup.",
                )
            if not dados.codigo_mfa:
                _registrar_tentativa(cur, dados.email, ip, False, "mfa_ausente")
                raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Código MFA obrigatório")
            if not security.verificar_totp(u["mfa_secret"], dados.codigo_mfa):
                falhas = u["failed_attempts"] + 1
                bloqueio = security.calcular_bloqueio(falhas, cfg.max_login_attempts, cfg.lockout_minutes)
                cur.execute(
                    "UPDATE users SET failed_attempts = %s, locked_until = %s WHERE id = %s",
                    (falhas, bloqueio, u["id"]),
                )
                _registrar_tentativa(cur, dados.email, ip, False, "mfa_incorreto")
                raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Código MFA inválido")

        if novo_hash:
            cur.execute("UPDATE users SET password_hash = %s WHERE id = %s", (novo_hash, u["id"]))

        token = security.emitir_sessao(cfg.app_secret, cfg.session_hours)
        cur.execute(
            """INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
               VALUES (%s, %s, %s, %s, %s)""",
            (u["id"], token.hash, token.expira_em, ip, request.headers.get("user-agent", "")[:500]),
        )
        cur.execute(
            "UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = %s",
            (u["id"],),
        )
        _registrar_tentativa(cur, dados.email, ip, True, "ok")
        db.registrar_auditoria(cur, actor_id=u["id"], entity="session", entity_id=None,
                               action="login", detail={"papeis": papeis}, ip=ip)

    response.set_cookie(
        COOKIE, token.bruto,
        httponly=True, samesite="strict", secure=cfg.cookie_secure,
        max_age=cfg.session_hours * 3600, path="/",
    )
    return {
        "ok": True,
        "usuario": {"id": u["id"], "nome": u["full_name"], "papeis": papeis, "creci_ativo": u["creci_ok"]},
        "expira_em": token.expira_em.isoformat(),
    }


@router.post("/logout")
def logout(request: Request, response: Response) -> dict[str, bool]:
    """Revoga a sessão no servidor — não apenas apaga o cookie (corrige P1-3)."""
    cfg = _cfg(request)
    bruto = request.cookies.get(COOKIE, "")
    if bruto:
        th = security.hash_token(cfg.app_secret, bruto)
        with db.transacao() as cur:
            cur.execute(
                "UPDATE sessions SET revoked_at = now() WHERE token_hash = %s AND revoked_at IS NULL",
                (th,),
            )
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.post("/logout-todas")
def logout_todas(u: Annotated[UsuarioSessao, Depends(usuario_atual)], response: Response) -> dict[str, Any]:
    """Revoga todas as sessões do usuário — resposta a suspeita de vazamento."""
    with db.transacao() as cur:
        cur.execute(
            "UPDATE sessions SET revoked_at = now() WHERE user_id = %s AND revoked_at IS NULL",
            (u.id,),
        )
        n = cur.rowcount
        db.registrar_auditoria(cur, actor_id=u.id, entity="session", entity_id=None,
                               action="logout_global", detail={"revogadas": n})
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True, "sessoes_revogadas": n}


@router.get("/eu", response_model=UsuarioSessao)
def eu(u: Annotated[UsuarioSessao, Depends(usuario_atual)]) -> UsuarioSessao:
    return u


@router.post("/mfa/setup")
def mfa_setup(request: Request, u: Annotated[UsuarioSessao, Depends(usuario_atual)]) -> dict[str, Any]:
    """Gera o segredo TOTP. Só é ativado após confirmação com um código válido."""
    cfg = _cfg(request)
    segredo = security.gerar_segredo_mfa()
    with db.transacao() as cur:
        cur.execute(
            "UPDATE users SET mfa_secret = %s, mfa_enabled = false WHERE id = %s",
            (segredo, u.id),
        )
    return {
        "segredo": segredo,
        "uri": security.uri_provisionamento(segredo, u.email),
        "instrucao": "Cadastre no aplicativo autenticador e confirme em /api/auth/mfa/confirmar.",
    }


@router.post("/mfa/confirmar")
def mfa_confirmar(
    codigo: str, request: Request, u: Annotated[UsuarioSessao, Depends(usuario_atual)]
) -> dict[str, Any]:
    cfg = _cfg(request)
    with db.transacao() as cur:
        cur.execute("SELECT mfa_secret FROM users WHERE id = %s", (u.id,))
        linha = cur.fetchone()
        if not linha or not linha["mfa_secret"]:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum segredo MFA pendente.")
        if not security.verificar_totp(linha["mfa_secret"], codigo):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Código inválido.")

        codigos = security.gerar_codigos_recuperacao()
        cur.execute(
            "UPDATE users SET mfa_enabled = true, mfa_enrolled_at = now() WHERE id = %s",
            (u.id,),
        )
        db.registrar_auditoria(cur, actor_id=u.id, entity="user", entity_id=u.id, action="mfa_habilitado")
    return {
        "ok": True,
        "codigos_recuperacao": codigos,
        "aviso": "Guarde estes códigos agora. Eles não serão exibidos novamente.",
    }


@router.post("/senha")
def trocar_senha(
    dados: TrocaSenhaIn, request: Request, u: Annotated[UsuarioSessao, Depends(usuario_atual)]
) -> dict[str, Any]:
    cfg = _cfg(request)
    with db.transacao() as cur:
        cur.execute("SELECT password_hash FROM users WHERE id = %s", (u.id,))
        atual = cur.fetchone()
        ok, _ = security.verificar_senha(atual["password_hash"], dados.senha_atual)
        if not ok:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Senha atual incorreta.")
        try:
            novo = security.gerar_hash(dados.senha_nova)
        except security.SenhaFraca as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

        cur.execute(
            "UPDATE users SET password_hash = %s, password_changed_at = now() WHERE id = %s",
            (novo, u.id),
        )
        # Troca de senha invalida todas as outras sessões.
        cur.execute(
            "UPDATE sessions SET revoked_at = now() WHERE user_id = %s AND revoked_at IS NULL",
            (u.id,),
        )
        db.registrar_auditoria(cur, actor_id=u.id, entity="user", entity_id=u.id, action="senha_alterada")
    return {"ok": True, "aviso": "Todas as sessões foram encerradas. Faça login novamente."}
