"""
Score de captação e valor esperado de comissão.

Inversão em relação ao score da V3: na tese de intermediação, o pior mandato
NÃO é o imóvel caro — é o imóvel **acima do preço de mercado**. Ele ocupa
inventário, não vende, consome visita e queima a relação com o proprietário
até vencer sem resultado. Um score que premia preço alto premia exatamente o
mandato que destrói a operação.

Por isso o componente de maior peso é a aderência de preço, e ele PENALIZA
sobrepreço. Isso é o oposto do score de quem compra para revender.

Três grandezas mantidas separadas (o erro-raiz do score antigo era misturá-las):
    Confiança   -> portão. Abaixo do piso, vai para pesquisa, não para o funil.
    Captação    -> 0–100, quão bom é este mandato.
    VE comissão -> reais esperados. É por ela que a fila é ordenada.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

PISO_CONFIANCA = 60
SOBREPRECO_INTOLERAVEL = 0.30      # +30% sobre o P50 zera a aderência

# Probabilidade de conversão por estágio. Valores iniciais conservadores;
# `deal_stage_history` existe para substituí-los por taxas medidas assim que
# houver 50+ negócios encerrados.
P_FECHAMENTO = {
    "sem proposta": 0.08,
    "proposta": 0.20,
    "contraproposta": 0.40,
    "aceita": 0.55,
    "contrato": 0.70,
    "due_diligence": 0.85,
    "escritura": 0.95,
    "concluido": 1.00,
    "perdido": 0.00,
}

# Probabilidade de converter uma abordagem em mandato assinado.
P_CAPTACAO = {"exclusiva": 0.25, "simples": 0.45, "sem_contato": 0.10}


@dataclass
class Componentes:
    aderencia: float      # A — expectativa do proprietário vs mercado
    liquidez: float       # L — velocidade de absorção da micro-região
    valor: float          # V — tamanho da comissão
    exclusividade: float  # E — chance de exclusiva
    tratabilidade: float  # T — proprietário localizável, matrícula limpa

    def __post_init__(self) -> None:
        for nome, v in self.__dict__.items():
            if not 0.0 <= v <= 1.0:
                raise ValueError(f"Componente '{nome}' fora de [0,1]: {v}")


@dataclass
class ResultadoCaptacao:
    score: int
    componentes: Componentes
    confianca: int
    aprovado: bool
    destino: str
    comissao_bruta: float
    ve_comissao: float
    motivo: str


PESOS = {
    "aderencia": 0.30,
    "liquidez": 0.25,
    "valor": 0.20,
    "exclusividade": 0.15,
    "tratabilidade": 0.10,
}


def aderencia_de_preco(preco_pretendido: float, p50_mercado: float) -> float:
    """
    1,0 quando a expectativa do proprietário está no mercado ou abaixo dele.
    Decai linearmente até 0 aos +30% de sobrepreço.

    Vender abaixo do mercado é fácil e rápido; o mandato é bom. Vender 30%
    acima é vender contra a evidência — o imóvel encalha e o mandato vence.
    """
    if p50_mercado <= 0:
        return 0.0
    excesso = (preco_pretendido - p50_mercado) / p50_mercado
    if excesso <= 0:
        return 1.0
    return max(0.0, 1.0 - excesso / SOBREPRECO_INTOLERAVEL)


def liquidez(dias_medios_no_mercado: float, absorvidos_12m: int) -> float:
    """
    Combina velocidade e profundidade. Micro-região que vende rápido mas tem
    dois negócios por ano não é líquida — é pequena.
    """
    c_vel = max(0.0, min(1.0, (270 - dias_medios_no_mercado) / 210))   # 60d→1,0 · 270d→0
    c_prof = min(1.0, math.log1p(absorvidos_12m) / math.log1p(24))
    return 0.6 * c_vel + 0.4 * c_prof


def valor_da_comissao(comissao_bruta: float, referencia: float = 250_000) -> float:
    """
    Escala logarítmica: uma comissão de R$ 500 mil não vale cinco vezes uma de
    R$ 100 mil em prioridade, porque o tempo gasto não cresce na mesma medida.
    """
    if comissao_bruta <= 0:
        return 0.0
    return min(1.0, math.log1p(comissao_bruta / referencia) / math.log1p(4))


def calcular(
    *,
    preco_pretendido: float,
    p50_mercado: float,
    confianca_avaliacao: int,
    dias_medios_no_mercado: float,
    absorvidos_12m: int,
    comissao_pct: float,
    modalidade_provavel: str = "simples",
    proprietario_localizado: bool = False,
    matricula_limpa: bool | None = None,
    estagio: str = "sem proposta",
) -> ResultadoCaptacao:
    comissao_bruta = preco_pretendido * comissao_pct / 100

    tratabilidade = (0.6 if proprietario_localizado else 0.0) + (
        0.4 if matricula_limpa else (0.2 if matricula_limpa is None else 0.0)
    )

    comp = Componentes(
        aderencia=aderencia_de_preco(preco_pretendido, p50_mercado),
        liquidez=liquidez(dias_medios_no_mercado, absorvidos_12m),
        valor=valor_da_comissao(comissao_bruta),
        exclusividade=0.9 if modalidade_provavel == "exclusiva" else 0.5,
        tratabilidade=min(1.0, tratabilidade),
    )

    bruto = sum(PESOS[k] * getattr(comp, k) for k in PESOS)
    score = round(100 * bruto)

    p_captar = P_CAPTACAO["sem_contato"] if not proprietario_localizado \
        else P_CAPTACAO.get(modalidade_provavel, 0.35)
    p_vender = P_FECHAMENTO.get(estagio, 0.08)

    # A aderência de preço entra duas vezes de propósito: ela afeta tanto a
    # chance de assinar quanto a chance de vender depois de assinado.
    ve = comissao_bruta * p_captar * p_vender * (0.4 + 0.6 * comp.aderencia)

    aprovado = confianca_avaliacao >= PISO_CONFIANCA
    if not aprovado:
        destino = "Fila de pesquisa"
        motivo = (
            f"Confiança da avaliação em {confianca_avaliacao} (piso {PISO_CONFIANCA}). "
            "Não é descarte: é pesquisa de comparáveis antes de abordar o proprietário."
        )
    elif comp.aderencia < 0.35:
        destino = "Abordagem com PTAM"
        motivo = (
            f"Expectativa {(preco_pretendido / p50_mercado - 1) * 100:.0f}% acima do mercado. "
            "Captar sem alinhar preço gera mandato que vence sem venda — "
            "leve o parecer técnico à conversa."
        )
    else:
        destino = "Captação"
        motivo = "Preço aderente ao mercado e evidência suficiente para abordar."

    return ResultadoCaptacao(
        score=score,
        componentes=comp,
        confianca=confianca_avaliacao,
        aprovado=aprovado,
        destino=destino,
        comissao_bruta=round(comissao_bruta, 2),
        ve_comissao=round(ve, 2),
        motivo=motivo,
    )


def pipeline_ponderado(negocios: list[dict]) -> dict:
    """
    Agrega o funil. Devolve bruto e ponderado — a segunda cifra é a que serve
    para planejar caixa; a primeira é a que serve para comemorar.
    """
    bruto = ponderado = 0.0
    for n in negocios:
        c = n["comissao_bruta"]
        bruto += c
        ponderado += c * P_FECHAMENTO.get(n.get("estagio", "sem proposta"), 0.08)
    return {
        "bruto": round(bruto, 2),
        "ponderado": round(ponderado, 2),
        "conversao_implicita": round(ponderado / bruto * 100, 1) if bruto else 0.0,
        "n_negocios": len(negocios),
    }
