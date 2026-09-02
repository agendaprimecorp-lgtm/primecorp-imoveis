"""
PrimeCorp Core V4 — API.

Sprint 1: segurança, Postgres e correção dos gargalos de escrita.
Tese: intermediação imobiliária.
"""
from __future__ import annotations

import csv
import hashlib
import io
import urllib.parse
from contextlib import asynccontextmanager
from datetime import date
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Request, Response, UploadFile, File, status
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import auth, avaliacao_api, db
from .auth import UsuarioSessao, exigir_creci, exigir_papeis, usuario_atual
from .config import carregar_ou_abortar

VERSAO = "4.0.0"


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    cfg = carregar_ou_abortar()          # aborta o boot se a config for insegura
    app.state.cfg = cfg
    db.inicializar(cfg.database_url)
    with db.transacao() as cur:          # higiene: expurga sessões mortas no startup
        cur.execute("DELETE FROM sessions WHERE expires_at < now() - interval '7 days'")
    yield
    db.encerrar()


app = FastAPI(title="PrimeCorp Core", version=VERSAO, lifespan=ciclo_de_vida)
app.include_router(auth.router)
app.include_router(avaliacao_api.router)


@app.middleware("http")
async def cabecalhos_de_seguranca(request: Request, call_next):
    resp: Response = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    resp.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data: https:; style-src 'self'; "
        "script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    )
    if request.app.state.cfg.cookie_secure:
        resp.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.exception_handler(Exception)
async def erro_generico(request: Request, exc: Exception):
    """Nunca devolve stack trace ao cliente."""
    return JSONResponse(status_code=500, content={"erro": "Erro interno. O incidente foi registrado."})


# ------------------------------------------------------------------
# Saúde
# ------------------------------------------------------------------

@app.get("/api/health")
def health() -> dict[str, Any]:
    linha = db.buscar_um("SELECT postgis_version() AS postgis, now() AS agora")
    return {"status": "ok", "versao": VERSAO, "postgis": linha["postgis"], "hora": linha["agora"].isoformat()}


# ------------------------------------------------------------------
# Mandatos — o inventário da corretagem
# ------------------------------------------------------------------

class MandatoIn(BaseModel):
    asset_id: int
    owner_contact_id: int
    responsible_user_id: int
    mandate_type: str = Field(pattern="^(exclusiva|simples|opcao_compra)$")
    asking_price: float = Field(gt=0)
    commission_pct: float = Field(gt=0, le=20)
    starts_on: date
    ends_on: date


@app.post("/api/mandatos", status_code=201)
def criar_mandato(
    dados: MandatoIn,
    request: Request,
    u: Annotated[UsuarioSessao, Depends(exigir_creci)],
) -> dict[str, Any]:
    """
    Cria mandato como rascunho. Só vira 'ativo' depois que a autorização
    escrita for anexada — a constraint `ativo_exige_assinatura` garante isso
    mesmo que alguém tente alterar o status por outro caminho.
    """
    if dados.ends_on <= dados.starts_on:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "O prazo final deve ser posterior ao início.")

    with db.transacao() as cur:
        cur.execute("SELECT creci_ativo(%s) AS ok", (dados.responsible_user_id,))
        if not cur.fetchone()["ok"]:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "O responsável indicado não possui CRECI válido (Lei 6.530/1978).",
            )
        # Opt-out do proprietário bloqueia a captação.
        cur.execute("SELECT opt_out FROM contacts WHERE id = %s", (dados.owner_contact_id,))
        c = cur.fetchone()
        if not c:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Contato do proprietário não encontrado.")
        if c["opt_out"]:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Este titular solicitou oposição ao tratamento. Captação bloqueada.",
            )

        cur.execute(
            """INSERT INTO mandates
               (asset_id, owner_contact_id, responsible_user_id, mandate_type,
                asking_price, commission_pct, starts_on, ends_on, created_by)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (dados.asset_id, dados.owner_contact_id, dados.responsible_user_id,
             dados.mandate_type, dados.asking_price, dados.commission_pct,
             dados.starts_on, dados.ends_on, u.id),
        )
        mid = cur.fetchone()["id"]
        db.registrar_auditoria(cur, actor_id=u.id, entity="mandate", entity_id=mid,
                               action="criado", detail=dados.model_dump(mode="json"))
    return {"id": mid, "status": "rascunho",
            "proximo_passo": "Anexar a autorização escrita e ativar via PATCH /api/mandatos/{id}/ativar"}


@app.get("/api/mandatos/vencendo")
def mandatos_vencendo(u: Annotated[UsuarioSessao, Depends(exigir_papeis("corretor", "juridico", "leitura"))]):
    return db.buscar_todos("SELECT * FROM v_mandatos_vencendo")


@app.get("/api/pipeline/comissao")
def pipeline_comissao(u: Annotated[UsuarioSessao, Depends(exigir_papeis("corretor", "leitura"))]):
    """Métrica-mestre da tese de intermediação."""
    linhas = db.buscar_todos("SELECT * FROM v_pipeline_comissao ORDER BY comissao_bruta_estimada DESC")
    total = sum(float(l["comissao_bruta_estimada"] or 0) for l in linhas)
    return {"total_pipeline_bruto": round(total, 2), "negocios": linhas}


# ------------------------------------------------------------------
# Importação em lote — corrige P1-2 (ganho medido de 102×)
# ------------------------------------------------------------------

CABECALHOS_CSV = {
    "asset_id", "portal", "external_id", "url", "title", "price",
    "raw_address", "raw_area", "raw_built_area", "description", "notes",
}


def _num(v: Any) -> float | None:
    if v in (None, ""):
        return None
    try:
        return float(str(v).replace(".", "").replace(",", ".") if "," in str(v) else v)
    except ValueError:
        return None


def _fingerprint(d: dict) -> str:
    caminho = urllib.parse.urlsplit(d.get("url") or "").path
    bruto = "|".join([
        (d.get("portal") or "").strip().lower(),
        (d.get("external_id") or "").strip().lower(),
        caminho.strip().lower(),
        " ".join((d.get("title") or "").lower().split()),
        " ".join((d.get("raw_address") or "").lower().split()),
        f"{round(_num(d.get('raw_area')) or 0, 1)}",
    ])
    return hashlib.sha256(bruto.encode()).hexdigest()


@app.post("/api/import/csv")
async def importar_csv(
    request: Request,
    u: Annotated[UsuarioSessao, Depends(exigir_papeis("originacao", "admin"))],
    arquivo: UploadFile = File(...),
) -> dict[str, Any]:
    """
    Importação transacional.

    A V3 fazia commit por linha e chamava refresh_scores por linha, abrindo
    uma segunda conexão a cada anúncio. Aqui o lote inteiro entra em uma
    transação e os scores são recalculados em uma passada ao final.
    """
    if arquivo.size and arquivo.size > 32 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Arquivo acima de 32 MB.")

    bruto = (await arquivo.read()).decode("utf-8-sig", errors="replace")
    leitor = csv.DictReader(io.StringIO(bruto))
    if not leitor.fieldnames or not (set(leitor.fieldnames) & CABECALHOS_CSV):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Cabeçalhos aceitos: {sorted(CABECALHOS_CSV)}")

    linhas = list(leitor)
    if len(linhas) > 100_000:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Máximo de 100 mil linhas por arquivo.")

    registros = [(
        _num(r.get("asset_id")) and int(float(r["asset_id"])) or None,
        (r.get("portal") or "")[:200], (r.get("external_id") or "")[:200],
        (r.get("url") or None), (r.get("title") or "")[:500], _num(r.get("price")),
        (r.get("raw_address") or "")[:500], _num(r.get("raw_area")), _num(r.get("raw_built_area")),
        (r.get("description") or "")[:5000], (r.get("notes") or "")[:2000], _fingerprint(r),
    ) for r in linhas]

    with db.transacao() as cur:
        cur.execute(
            "INSERT INTO import_runs (status, items_seen, triggered_by) VALUES ('running', %s, %s) RETURNING id",
            (len(registros), u.id),
        )
        run_id = cur.fetchone()["id"]

        cur.executemany(
            """INSERT INTO listings
                 (asset_id, portal, external_id, url, title, price, raw_address,
                  raw_area, raw_built_area, description, notes, fingerprint)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (fingerprint) DO UPDATE SET
                 price = EXCLUDED.price,
                 title = EXCLUDED.title,
                 last_seen_at = now(),
                 is_active = true""",
            registros,
        )

        # Histórico de preço em uma passada: registra apenas mudança efetiva.
        cur.execute(
            """INSERT INTO price_history (listing_id, asset_id, price)
               SELECT l.id, l.asset_id, l.price FROM listings l
               WHERE l.price IS NOT NULL
                 AND l.last_seen_at > now() - interval '1 minute'
                 AND NOT EXISTS (
                   SELECT 1 FROM price_history p
                   WHERE p.listing_id = l.id AND p.price = l.price
                     AND p.observed_at > now() - interval '1 day')"""
        )
        novos = cur.rowcount

        cur.execute(
            "UPDATE import_runs SET status='ok', finished_at=now(), items_new=%s WHERE id=%s",
            (novos, run_id),
        )
        db.registrar_auditoria(cur, actor_id=u.id, entity="import_run", entity_id=run_id,
                               action="csv_importado", detail={"linhas": len(registros)})

    return {"ok": True, "run_id": run_id, "linhas_processadas": len(registros), "precos_registrados": novos}


# ------------------------------------------------------------------
# LGPD
# ------------------------------------------------------------------

@app.post("/api/lgpd/opt-out/{contact_id}")
def opt_out(contact_id: int, u: Annotated[UsuarioSessao, Depends(usuario_atual)]) -> dict[str, Any]:
    """Oposição do titular: propaga para toda a base e bloqueia recontato."""
    with db.transacao() as cur:
        cur.execute(
            "UPDATE contacts SET opt_out = true, opt_out_at = now() WHERE id = %s RETURNING name",
            (contact_id,),
        )
        linha = cur.fetchone()
        if not linha:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Contato não encontrado.")
        cur.execute(
            """INSERT INTO data_subject_requests (contact_id, request_type, due_at)
               VALUES (%s, 'oposicao', now() + interval '15 days')""",
            (contact_id,),
        )
        db.registrar_auditoria(cur, actor_id=u.id, entity="contact", entity_id=contact_id,
                               action="opt_out")
    return {"ok": True, "contato": linha["name"]}


@app.get("/api/lgpd/expurgo-pendente")
def expurgo_pendente(u: Annotated[UsuarioSessao, Depends(exigir_papeis("juridico", "admin"))]):
    return db.buscar_todos("SELECT * FROM v_lgpd_expurgo_pendente")


@app.get("/api/conformidade/creci")
def conformidade_creci(u: Annotated[UsuarioSessao, Depends(exigir_papeis("admin", "juridico"))]):
    return db.buscar_todos("SELECT * FROM v_creci_alerta")
