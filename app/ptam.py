"""
PTAM — Parecer Técnico de Avaliação Mercadológica.

Base normativa: Lei 6.530/1978, art. 3º (competência do Corretor de Imóveis
para opinar quanto ao valor comercial) e Resolução COFECI nº 1.066/2007, que
regulamenta a elaboração do parecer. A emissão é permitida a todo Corretor de
Imóveis, pessoa física, regularmente inscrito no CRECI; a inscrição no CNAI é
opcional e dá direito ao selo certificador.

LIMITE QUE O MÓDULO IMPÕE: o PTAM presta-se a negociação de compra e venda.
Processo judicial, garantia bancária, fim fiscal e desapropriação exigem laudo
conforme ABNT NBR 14.653 — documento distinto, com metodologia mais rigorosa.
Emitir PTAM para essas finalidades expõe o corretor. Por isso a finalidade é
campo obrigatório e as finalidades vedadas são recusadas, não avisadas.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .comparaveis import Avaliacao

FINALIDADES_PERMITIDAS = {
    "compra_venda": "Negociação de compra e venda",
    "definicao_preco": "Definição de preço de oferta",
    "partilha_amigavel": "Partilha amigável entre as partes",
    "gestao_patrimonial": "Gestão patrimonial e tomada de decisão",
}

FINALIDADES_VEDADAS = {
    "judicial": "processo judicial",
    "garantia_bancaria": "garantia bancária ou financiamento",
    "fiscal": "fim fiscal ou tributário",
    "desapropriacao": "desapropriação",
    "inventario_judicial": "inventário judicial",
}


class FinalidadeExigeLaudo(Exception):
    """Finalidade declarada exige laudo NBR 14.653, não PTAM."""


class SemHabilitacao(Exception):
    """Emissor sem inscrição válida no CRECI."""


@dataclass(frozen=True)
class Emissor:
    nome: str
    creci_numero: str
    creci_uf: str
    creci_valido_ate: date
    cnai: str | None = None

    @property
    def inscricao(self) -> str:
        return f"CRECI{self.creci_uf} {self.creci_numero}"


@dataclass(frozen=True)
class ImovelAvaliando:
    descricao: str
    tipo: str
    cidade: str
    uf: str
    area_terreno: float
    bairro: str | None = None
    endereco: str | None = None
    area_construida: float | None = None
    matricula: str | None = None
    cartorio: str | None = None


@dataclass
class PTAM:
    numero: str
    emitido_em: date
    emissor: Emissor
    imovel: ImovelAvaliando
    solicitante: str
    finalidade: str
    avaliacao: Avaliacao
    valor_indicado: float
    faixa_negociacao: tuple[float, float]
    metodologia: str
    ressalvas: list[str]


def gerar(
    *,
    emissor: Emissor,
    imovel: ImovelAvaliando,
    solicitante: str,
    finalidade: str,
    avaliacao: Avaliacao,
    numero: str,
    hoje: date | None = None,
) -> PTAM:
    hoje = hoje or date.today()

    if finalidade in FINALIDADES_VEDADAS:
        raise FinalidadeExigeLaudo(
            f"Finalidade '{FINALIDADES_VEDADAS[finalidade]}' exige laudo conforme "
            "ABNT NBR 14.653, elaborado por profissional habilitado para perícia. "
            "O PTAM não substitui esse documento."
        )
    if finalidade not in FINALIDADES_PERMITIDAS:
        raise ValueError(f"Finalidade desconhecida: {finalidade}")
    if emissor.creci_valido_ate < hoje:
        raise SemHabilitacao(
            f"{emissor.inscricao} venceu em {emissor.creci_valido_ate:%d/%m/%Y}. "
            "A Resolução COFECI 1.066/2007 exige inscrição regular para emitir PTAM."
        )

    metodologia = (
        f"Método comparativo direto de dados de mercado. Foram pesquisados "
        f"{avaliacao.n_comparaveis + avaliacao.n_descartados} elementos de mercado do mesmo "
        f"tipo e município, com área entre 65% e 135% da área do imóvel avaliando, "
        f"observados nos últimos 18 meses. {avaliacao.n_descartados} elemento(s) "
        f"foram descartados por afastamento superior a 3 desvios absolutos medianos. "
        f"Os {avaliacao.n_comparaveis} elementos remanescentes tiveram o valor unitário "
        f"homogeneizado para a escala do imóvel avaliando por fator de área com "
        f"elasticidade de {avaliacao.elasticidade:.3f}, "
        f"{'estimada por regressão log-log sobre a própria amostra' if avaliacao.elasticidade_estimada else 'adotada como referência para a tipologia'}. "
        f"Adotou-se mediana e desvio absoluto mediano em lugar de média e desvio-padrão, "
        f"em razão da assimetria característica de preços de oferta."
    )

    ressalvas = [
        "Este parecer reflete valor de mercado para negociação de compra e venda, "
        "nos termos da Resolução COFECI nº 1.066/2007.",
        "Não substitui laudo de avaliação conforme ABNT NBR 14.653, exigido para "
        "fins judiciais, garantia bancária, fiscais ou de desapropriação.",
        "A pesquisa baseia-se em preços de oferta. Preço de oferta e preço de "
        "transação divergem sistematicamente; a faixa apresentada já incorpora "
        "essa dispersão.",
        f"Amplitude entre P10 e P90 de {avaliacao.amplitude_relativa * 100:.1f}% "
        f"sobre o valor indicado, com dispersão amostral de "
        f"{avaliacao.dispersao_relativa * 100:.1f}%.",
        "Não foi realizada vistoria pericial nem verificação de conformidade "
        "construtiva, ambiental ou registral, salvo se expressamente consignado.",
    ]

    if avaliacao.confianca < 70:
        ressalvas.insert(
            0,
            f"ATENÇÃO: confiança da amostra em {avaliacao.confianca}/100. "
            "Recomenda-se ampliar a pesquisa antes de usar este parecer como "
            "base única de decisão.",
        )
    if imovel.matricula is None:
        ressalvas.append(
            "A área considerada é a informada pelo solicitante. Recomenda-se "
            "confrontá-la com a área constante da matrícula antes da oferta."
        )

    return PTAM(
        numero=numero,
        emitido_em=hoje,
        emissor=emissor,
        imovel=imovel,
        solicitante=solicitante,
        finalidade=FINALIDADES_PERMITIDAS[finalidade],
        avaliacao=avaliacao,
        valor_indicado=round(avaliacao.p50, -3),
        faixa_negociacao=(round(avaliacao.p10, -3), round(avaliacao.p90, -3)),
        metodologia=metodologia,
        ressalvas=ressalvas,
    )


def _moeda(v: float) -> str:
    return f"R$ {v:,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")


def _numero(v: float, casas: int = 2) -> str:
    return f"{v:,.{casas}f}".replace(",", "@").replace(".", ",").replace("@", ".")


def em_markdown(p: PTAM) -> str:
    """Saída textual do parecer. A versão em PDF é gerada a partir desta."""
    i = p.imovel
    linhas = [
        "# Parecer Técnico de Avaliação Mercadológica",
        "",
        f"**Parecer nº** {p.numero}  ",
        f"**Emitido em** {p.emitido_em:%d/%m/%Y}  ",
        f"**Solicitante** {p.solicitante}  ",
        f"**Finalidade** {p.finalidade}",
        "",
        "## 1. Do emissor e da competência",
        "",
        f"{p.emissor.nome}, Corretor(a) de Imóveis inscrito(a) sob o nº "
        f"**{p.emissor.inscricao}**"
        + (f", CNAI nº {p.emissor.cnai}" if p.emissor.cnai else "")
        + f", com inscrição regular até {p.emissor.creci_valido_ate:%d/%m/%Y}.",
        "",
        "A competência do Corretor de Imóveis para opinar quanto ao valor comercial "
        "decorre do art. 3º da Lei nº 6.530, de 12 de maio de 1978, e a forma de "
        "elaboração deste parecer observa a Resolução COFECI nº 1.066, de 22 de "
        "novembro de 2007.",
        "",
        "## 2. Do imóvel avaliando",
        "",
        "| | |",
        "|---|---|",
        f"| Descrição | {i.descricao} |",
        f"| Tipologia | {i.tipo} |",
        f"| Localização | {i.endereco or '—'}, {i.bairro or '—'}, {i.cidade}/{i.uf} |",
        f"| Área do terreno | {_numero(i.area_terreno, 2)} m² |",
    ]
    if i.area_construida:
        linhas.append(f"| Área construída | {_numero(i.area_construida, 2)} m² |")
    linhas.append(
        f"| Matrícula | {i.matricula or 'não apresentada'}"
        + (f" — {i.cartorio}" if i.cartorio else "")
        + " |"
    )

    a = p.avaliacao
    linhas += [
        "",
        "## 3. Da metodologia",
        "",
        p.metodologia,
        "",
        "## 4. Do resultado",
        "",
        "| Referência | Valor total | Valor unitário |",
        "|---|---:|---:|",
        f"| Limite inferior (P10) | {_moeda(p.faixa_negociacao[0])} | "
        f"{_moeda(p.faixa_negociacao[0] / i.area_terreno)}/m² |",
        f"| **Valor de mercado indicado (P50)** | **{_moeda(p.valor_indicado)}** | "
        f"**{_moeda(a.valor_m2_p50)}/m²** |",
        f"| Limite superior (P90) | {_moeda(p.faixa_negociacao[1])} | "
        f"{_moeda(p.faixa_negociacao[1] / i.area_terreno)}/m² |",
        "",
        f"Elementos de mercado utilizados: **{a.n_comparaveis}**. "
        f"Descartados por discrepância: {a.n_descartados}. "
        f"Índice de confiança da amostra: **{a.confianca}/100**.",
        "",
        "## 5. Das ressalvas",
        "",
    ]
    linhas += [f"{n}. {r}" for n, r in enumerate(p.ressalvas, 1)]
    linhas += [
        "",
        "---",
        "",
        f"{p.emissor.nome}  ",
        f"{p.emissor.inscricao}  ",
        f"{p.emitido_em:%d/%m/%Y}",
    ]
    return "\n".join(linhas)
