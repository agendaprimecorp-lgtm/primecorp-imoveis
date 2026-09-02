"""
Motor de avaliação por comparáveis (AVM).

Produz o insumo técnico do PTAM — Parecer Técnico de Avaliação Mercadológica,
regulamentado pela Resolução COFECI nº 1.066/2007, que qualquer Corretor de
Imóveis com inscrição ativa no CRECI pode emitir.

Limite deliberado: PTAM serve a negociação de compra e venda. Para processo
judicial, garantia bancária ou desapropriação exige-se laudo conforme
ABNT NBR 14.653, que é outro documento e outro profissional. O módulo recusa
emitir quando a finalidade declarada exige laudo (ver `ptam.py`).

Decisões metodológicas:
  - Mediana e MAD, nunca média e desvio-padrão. Preço de anúncio no Brasil tem
    cauda pesada e "preço de fantasia"; a média é arrastada por poucos outliers.
  - Elasticidade de área estimada dos próprios dados quando há amostra, porque
    R$/m² cai conforme a metragem cresce — efeito dominante em terreno, área
    industrial e galpão, que é a tese da casa.
  - Saída em intervalo (P10/P50/P90), nunca em ponto. Errar a estimativa para
    baixo custa muito mais que errar para cima.
  - Amostra insuficiente devolve "sem base comparável" em vez de inventar
    número. Um parecer com fundamento fraco é pior que nenhum parecer.
"""
from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Iterable, Sequence

MIN_COMPARAVEIS = 7
MIN_PARA_REGRESSAO = 12
TOLERANCIA_AREA = 0.35        # ±35% da área do imóvel avaliando
JANELA_MESES = 18
CORTE_MAD = 3.0

# Elasticidade de área por tipo, usada quando a amostra não permite estimar.
# Negativa: quanto maior o imóvel, menor o R$/m².
ELASTICIDADE_PADRAO = {
    "Área industrial": -0.22,
    "Galpão": -0.18,
    "Terreno": -0.20,
    "Área rural": -0.28,
    "Fazenda": -0.28,
    "Casa": -0.12,
    "Apartamento": -0.08,
    "Sala comercial": -0.10,
}
ELASTICIDADE_FALLBACK = -0.15


class SemBaseComparavel(Exception):
    """Amostra insuficiente ou dispersa demais para sustentar um parecer."""


@dataclass(frozen=True)
class Comparavel:
    id: int
    preco: float
    area: float
    cidade: str
    tipo: str
    observado_em: datetime
    bairro: str | None = None
    fonte: str = ""
    url: str | None = None

    @property
    def valor_m2(self) -> float:
        return self.preco / self.area


@dataclass
class Avaliacao:
    p10: float
    p50: float
    p90: float
    valor_m2_p50: float
    n_comparaveis: int
    n_descartados: int
    elasticidade: float
    elasticidade_estimada: bool
    dispersao_relativa: float          # MAD / mediana — mede a qualidade da amostra
    confianca: int                     # 0–100
    amostra: list[Comparavel] = field(default_factory=list)
    descartados: list[tuple[Comparavel, str]] = field(default_factory=list)

    @property
    def amplitude_relativa(self) -> float:
        return (self.p90 - self.p10) / self.p50 if self.p50 else 0.0


# ------------------------------------------------------------------
# Seleção
# ------------------------------------------------------------------

def selecionar(
    candidatos: Iterable[Comparavel],
    *,
    tipo: str,
    cidade: str,
    area: float,
    bairro: str | None = None,
    hoje: date | None = None,
) -> list[Comparavel]:
    """
    Blocking: mesmo tipo, mesma cidade, área dentro da tolerância, dentro da
    janela temporal. Reduz o universo antes de qualquer estatística — é também
    o que evita a varredura O(N) medida no diagnóstico.
    """
    hoje = hoje or date.today()
    limite = hoje.toordinal() - int(JANELA_MESES * 30.44)
    piso, teto = area * (1 - TOLERANCIA_AREA), area * (1 + TOLERANCIA_AREA)

    return [
        c for c in candidatos
        if c.tipo == tipo
        and c.cidade.strip().lower() == cidade.strip().lower()
        and c.area > 0 and c.preco > 0
        and piso <= c.area <= teto
        and c.observado_em.date().toordinal() >= limite
    ]


# ------------------------------------------------------------------
# Estatística robusta
# ------------------------------------------------------------------

def mad(valores: Sequence[float]) -> float:
    """Desvio absoluto mediano. Resiste a até 50% de contaminação."""
    if not valores:
        return 0.0
    m = statistics.median(valores)
    return statistics.median([abs(v - m) for v in valores])


def remover_outliers(
    comps: Sequence[Comparavel], chave
) -> tuple[list[Comparavel], list[tuple[Comparavel, str]]]:
    """Corta o que estiver fora de mediana ± 3·MAD."""
    valores = [chave(c) for c in comps]
    if len(valores) < 3:
        return list(comps), []
    m = statistics.median(valores)
    d = mad(valores)
    if d == 0:
        return list(comps), []

    mantidos, cortados = [], []
    for c in comps:
        desvio = abs(chave(c) - m) / d
        if desvio > CORTE_MAD:
            cortados.append((c, f"{desvio:.1f} MAD da mediana"))
        else:
            mantidos.append(c)
    return mantidos, cortados


# ------------------------------------------------------------------
# Ajuste hedônico de escala
# ------------------------------------------------------------------

def estimar_elasticidade(comps: Sequence[Comparavel]) -> tuple[float, bool]:
    """
    Regressão log-log de R$/m² contra área: ln(v) = a + b·ln(A).
    O coeficiente b é a elasticidade. Só é usado com amostra suficiente e
    quando o resultado cai numa faixa economicamente plausível — regressão
    com poucos pontos produz inclinações absurdas.
    """
    if len(comps) < MIN_PARA_REGRESSAO:
        return 0.0, False

    xs = [math.log(c.area) for c in comps]
    ys = [math.log(c.valor_m2) for c in comps]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    den = sum((x - mx) ** 2 for x in xs)
    if den == 0:
        return 0.0, False

    b = num / den
    if not (-0.60 <= b <= 0.10):     # fora disso, a amostra está dizendo outra coisa
        return 0.0, False
    return b, True


def ajustar_para_area(valor_m2: float, area_comp: float, area_alvo: float, elasticidade: float) -> float:
    """
    Traz o R$/m² do comparável para a escala do imóvel avaliando.

    Um terreno de 3.000 m² a R$ 800/m² não implica que um de 18.000 m² valha
    R$ 800/m². Sem esse ajuste, avaliar ativo grande com comparável pequeno
    superestima o valor de forma sistemática — o erro mais caro do setor.
    """
    if area_comp <= 0 or area_alvo <= 0:
        return valor_m2
    return valor_m2 * (area_alvo / area_comp) ** elasticidade


# ------------------------------------------------------------------
# Avaliação
# ------------------------------------------------------------------

def avaliar(
    candidatos: Iterable[Comparavel],
    *,
    tipo: str,
    cidade: str,
    area: float,
    bairro: str | None = None,
    hoje: date | None = None,
) -> Avaliacao:
    if area <= 0:
        raise SemBaseComparavel("Área do imóvel avaliando não informada.")

    brutos = selecionar(candidatos, tipo=tipo, cidade=cidade, area=area, bairro=bairro, hoje=hoje)
    if len(brutos) < MIN_COMPARAVEIS:
        raise SemBaseComparavel(
            f"{len(brutos)} comparáveis encontrados; o mínimo para sustentar um parecer "
            f"é {MIN_COMPARAVEIS}. Amplie a janela geográfica ou registre novas pesquisas."
        )

    limpos, descartados = remover_outliers(brutos, lambda c: c.valor_m2)
    if len(limpos) < MIN_COMPARAVEIS:
        raise SemBaseComparavel(
            f"Após remoção de discrepantes restaram {len(limpos)} comparáveis, "
            f"abaixo do mínimo de {MIN_COMPARAVEIS}. A amostra está dispersa demais."
        )

    elast, estimada = estimar_elasticidade(limpos)
    if not estimada:
        elast = ELASTICIDADE_PADRAO.get(tipo, ELASTICIDADE_FALLBACK)

    ajustados = sorted(
        ajustar_para_area(c.valor_m2, c.area, area, elast) for c in limpos
    )

    v50 = statistics.median(ajustados)
    v10 = _percentil(ajustados, 0.10)
    v90 = _percentil(ajustados, 0.90)
    dispersao = mad(ajustados) / v50 if v50 else 0.0

    return Avaliacao(
        p10=v10 * area,
        p50=v50 * area,
        p90=v90 * area,
        valor_m2_p50=v50,
        n_comparaveis=len(limpos),
        n_descartados=len(descartados),
        elasticidade=elast,
        elasticidade_estimada=estimada,
        dispersao_relativa=dispersao,
        confianca=_confianca(len(limpos), dispersao, estimada),
        amostra=limpos,
        descartados=descartados,
    )


def _percentil(ordenados: Sequence[float], p: float) -> float:
    """Interpolação linear. Sem numpy: o módulo roda em qualquer worker."""
    if not ordenados:
        return 0.0
    if len(ordenados) == 1:
        return ordenados[0]
    pos = p * (len(ordenados) - 1)
    baixo = int(math.floor(pos))
    alto = min(baixo + 1, len(ordenados) - 1)
    return ordenados[baixo] + (ordenados[alto] - ordenados[baixo]) * (pos - baixo)


def _confianca(n: int, dispersao: float, elasticidade_estimada: bool) -> int:
    """
    Confiança é grandeza separada do valor — nunca somada a ele.
    Diz o quanto se pode apoiar no número, não quanto o imóvel vale.
    """
    # Tamanho da amostra: satura por volta de 40 comparáveis.
    c_n = min(1.0, math.log(n / MIN_COMPARAVEIS + 1) / math.log(40 / MIN_COMPARAVEIS + 1))
    # Dispersão: 10% de MAD relativo é uma amostra coesa; 40% é ruído.
    c_d = max(0.0, min(1.0, (0.40 - dispersao) / 0.30))
    c_e = 1.0 if elasticidade_estimada else 0.80
    return round(100 * (0.40 * c_n + 0.45 * c_d + 0.15 * c_e))
