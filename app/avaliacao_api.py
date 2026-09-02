"""Rotas do Sprint 2: avaliação, PTAM e fila de captação."""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from . import captacao, comparaveis, db, ptam
from .auth import UsuarioSessao, exigir_creci, exigir_papeis
from .comparaveis import Comparavel, SemBaseComparavel

router = APIRouter(prefix="/api", tags=["avaliação"])


# ------------------------------------------------------------------
# Carregamento de comparáveis
# ------------------------------------------------------------------

def _carregar_comparaveis(tipo: str, cidade: str, area: float) -> list[Comparavel]:
    """
    O blocking acontece no SQL, com índice: sem isso a consulta degrada
    linearmente (medido: 1.147 ms por anúncio contra 500 mil ativos).
    """
    linhas = db.buscar_todos(
        """SELECT l.id, l.price, COALESCE(l.raw_area, a.land_area) AS area,
                  a.city, a.asset_type, l.last_seen_at, a.neighborhood,
                  l.portal, l.url
             FROM listings l
             JOIN assets a ON a.id = l.asset_id
            WHERE a.asset_type = %s
              AND lower(a.city) = lower(%s)
              AND COALESCE(l.raw_area, a.land_area) BETWEEN %s AND %s
              AND l.price > 0
              AND l.last_seen_at > now() - interval '18 months'
            LIMIT 500""",
        (tipo, cidade,
         area * (1 - comparaveis.TOLERANCIA_AREA),
         area * (1 + comparaveis.TOLERANCIA_AREA)),
    )
    return [
        Comparavel(
            id=l["id"], preco=float(l["price"]), area=float(l["area"]),
            cidade=l["city"], tipo=l["asset_type"], observado_em=l["last_seen_at"],
            bairro=l["neighborhood"], fonte=l["portal"] or "", url=l["url"],
        )
        for l in linhas if l["area"]
    ]


# ------------------------------------------------------------------
# Avaliação
# ------------------------------------------------------------------

class AvaliacaoIn(BaseModel):
    tipo: str
    cidade: str
    area: float = Field(gt=0)
    bairro: str | None = None


@router.post("/avaliacao")
def avaliar(
    dados: AvaliacaoIn,
    u: Annotated[UsuarioSessao, Depends(exigir_papeis("corretor", "originacao"))],
) -> dict[str, Any]:
    try:
        r = comparaveis.avaliar(
            _carregar_comparaveis(dados.tipo, dados.cidade, dados.area),
            tipo=dados.tipo, cidade=dados.cidade, area=dados.area, bairro=dados.bairro,
        )
    except SemBaseComparavel as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))

    return {
        "p10": round(r.p10, 2),
        "p50": round(r.p50, 2),
        "p90": round(r.p90, 2),
        "valor_m2": round(r.valor_m2_p50, 2),
        "comparaveis": r.n_comparaveis,
        "descartados": r.n_descartados,
        "elasticidade": round(r.elasticidade, 3),
        "elasticidade_estimada": r.elasticidade_estimada,
        "dispersao_pct": round(r.dispersao_relativa * 100, 1),
        "confianca": r.confianca,
        "amplitude_pct": round(r.amplitude_relativa * 100, 1),
    }


# ------------------------------------------------------------------
# PTAM
# ------------------------------------------------------------------

class PtamIn(BaseModel):
    asset_id: int
    solicitante: str = Field(min_length=2, max_length=200)
    finalidade: str
    descricao: str | None = None


@router.post("/ptam", response_class=PlainTextResponse)
def emitir_ptam(
    dados: PtamIn,
    u: Annotated[UsuarioSessao, Depends(exigir_creci)],
) -> str:
    """
    Emissão do parecer. Exige CRECI válido do emissor — não do sistema.
    A Resolução COFECI 1.066/2007 vincula o parecer à pessoa física inscrita.
    """
    a = db.buscar_um(
        """SELECT a.*, u.full_name, u.creci_number, u.creci_state, u.creci_valid_until
             FROM assets a CROSS JOIN users u
            WHERE a.id = %s AND u.id = %s""",
        (dados.asset_id, u.id),
    )
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ativo não encontrado.")
    if not a["land_area"]:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Ativo sem área registrada. Não é possível avaliar sem a metragem.",
        )

    try:
        av = comparaveis.avaliar(
            _carregar_comparaveis(a["asset_type"], a["city"], float(a["land_area"])),
            tipo=a["asset_type"], cidade=a["city"], area=float(a["land_area"]),
        )
    except SemBaseComparavel as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))

    with db.transacao() as cur:
        cur.execute(
            "SELECT count(*) + 1 AS n FROM audit_log WHERE action = 'ptam_emitido' "
            "AND created_at >= date_trunc('year', now())"
        )
        seq = cur.fetchone()["n"]
        numero = f"PTAM-{date.today():%Y}-{seq:04d}"

        try:
            doc = ptam.gerar(
                emissor=ptam.Emissor(
                    nome=a["full_name"], creci_numero=a["creci_number"],
                    creci_uf=a["creci_state"], creci_valido_ate=a["creci_valid_until"],
                ),
                imovel=ptam.ImovelAvaliando(
                    descricao=dados.descricao or a["title"] or a["asset_type"],
                    tipo=a["asset_type"], cidade=a["city"], uf=a["state"],
                    area_terreno=float(a["land_area"]),
                    area_construida=float(a["built_area"]) if a["built_area"] else None,
                    bairro=a["neighborhood"], endereco=a["address"],
                    matricula=a["matricula_number"], cartorio=a["matricula_cartorio"],
                ),
                solicitante=dados.solicitante,
                finalidade=dados.finalidade,
                avaliacao=av,
                numero=numero,
            )
        except ptam.FinalidadeExigeLaudo as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
        except ptam.SemHabilitacao as e:
            raise HTTPException(status.HTTP_403_FORBIDDEN, str(e))

        db.registrar_auditoria(
            cur, actor_id=u.id, entity="asset", entity_id=dados.asset_id,
            action="ptam_emitido",
            detail={"numero": numero, "finalidade": dados.finalidade,
                    "p50": round(av.p50, 2), "confianca": av.confianca},
        )

    return ptam.em_markdown(doc)


@router.get("/ptam/finalidades")
def finalidades() -> dict[str, Any]:
    return {
        "permitidas": ptam.FINALIDADES_PERMITIDAS,
        "vedadas": {
            k: f"{v} — exige laudo ABNT NBR 14.653"
            for k, v in ptam.FINALIDADES_VEDADAS.items()
        },
    }


# ------------------------------------------------------------------
# Fila de captação
# ------------------------------------------------------------------

class CaptacaoIn(BaseModel):
    asset_id: int
    preco_pretendido: float = Field(gt=0)
    comissao_pct: float = Field(gt=0, le=20)
    modalidade_provavel: str = Field(default="simples", pattern="^(exclusiva|simples)$")
    proprietario_localizado: bool = False
    matricula_limpa: bool | None = None
    estagio: str = "sem proposta"


@router.post("/captacao/avaliar")
def avaliar_captacao(
    dados: CaptacaoIn,
    u: Annotated[UsuarioSessao, Depends(exigir_papeis("corretor", "originacao"))],
) -> dict[str, Any]:
    a = db.buscar_um("SELECT asset_type, city, land_area FROM assets WHERE id = %s", (dados.asset_id,))
    if not a or not a["land_area"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ativo não encontrado ou sem área.")

    try:
        av = comparaveis.avaliar(
            _carregar_comparaveis(a["asset_type"], a["city"], float(a["land_area"])),
            tipo=a["asset_type"], cidade=a["city"], area=float(a["land_area"]),
        )
    except SemBaseComparavel as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))

    liq = db.buscar_um(
        """SELECT COALESCE(avg(EXTRACT(epoch FROM (last_seen_at - first_seen_at)) / 86400), 180) AS dias,
                  count(*) FILTER (WHERE NOT is_active
                        AND last_seen_at > now() - interval '12 months') AS absorvidos
             FROM listings l JOIN assets a2 ON a2.id = l.asset_id
            WHERE a2.asset_type = %s AND lower(a2.city) = lower(%s)""",
        (a["asset_type"], a["city"]),
    ) or {"dias": 180, "absorvidos": 0}

    r = captacao.calcular(
        preco_pretendido=dados.preco_pretendido,
        p50_mercado=av.p50,
        confianca_avaliacao=av.confianca,
        dias_medios_no_mercado=float(liq["dias"]),
        absorvidos_12m=int(liq["absorvidos"]),
        comissao_pct=dados.comissao_pct,
        modalidade_provavel=dados.modalidade_provavel,
        proprietario_localizado=dados.proprietario_localizado,
        matricula_limpa=dados.matricula_limpa,
        estagio=dados.estagio,
    )

    return {
        "score": r.score,
        "destino": r.destino,
        "motivo": r.motivo,
        "confianca": r.confianca,
        "comissao_bruta": r.comissao_bruta,
        "ve_comissao": r.ve_comissao,
        "componentes": {k: round(getattr(r.componentes, k), 3) for k in captacao.PESOS},
        "mercado": {"p10": round(av.p10, 2), "p50": round(av.p50, 2), "p90": round(av.p90, 2)},
        "desvio_pct": round((dados.preco_pretendido / av.p50 - 1) * 100, 1),
    }


@router.get("/captacao/fila")
def fila(
    u: Annotated[UsuarioSessao, Depends(exigir_papeis("corretor", "originacao", "leitura"))],
    limite: int = 25,
) -> list[dict[str, Any]]:
    """Ativos sem mandato, ordenados por prioridade de captação."""
    return db.buscar_todos(
        """SELECT a.id, a.asset_code, a.title, a.asset_type, a.city, a.state,
                  a.land_area, a.asking_price, a.status, a.opportunity_score,
                  EXISTS(SELECT 1 FROM asset_contacts ac WHERE ac.asset_id = a.id) AS proprietario_localizado,
                  a.has_liens
             FROM assets a
            WHERE NOT EXISTS (SELECT 1 FROM mandates m
                               WHERE m.asset_id = a.id AND m.status IN ('ativo','rascunho'))
              AND a.status NOT IN ('Descartado','Fechado')
            ORDER BY a.opportunity_score DESC NULLS LAST
            LIMIT %s""",
        (limite,),
    )
