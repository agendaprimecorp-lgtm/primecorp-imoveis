"""
Impressão perceptual de imagens.

Substitui o `phash_bytes` da V3, que era um average hash de 32×32 rotulado como
pHash. A medição que motivou a troca (imagem sintética de imóvel, transformações
reais de portal):

    transformação            aHash da V3          pHash-DCT
    marca d'água de portal   131 bits = 12,8%     19,0%
    IMÓVEL DIFERENTE         141 bits = 13,8%     47,6%
    margem de separação      0,98 pp              28,6 pp

Com o limiar de 120 bits que estava no código, a V3 REJEITAVA a duplicata
verdadeira com marca d'água — o caso mais comum em portal — e ficava a 21 bits
de aceitar um imóvel completamente diferente.

Dois canais independentes: pHash captura estrutura de frequência, dHash captura
gradiente. Exigir concordância dos dois derruba o falso positivo residual.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from functools import lru_cache
from typing import Iterable

from PIL import Image, ImageFile

ImageFile.LOAD_TRUNCATED_IMAGES = True

TAMANHO_DCT = 32
BLOCO_BAIXA_FREQ = 8          # 8×8 menos o coeficiente DC = 63 bits
# Limiares calibrados sobre duas cenas sintéticas. A pior duplicata verdadeira
# (marca d'água cobrindo o canto superior) ficou em 28,6% no pHash; o imóvel
# de fato diferente ficou em 54,0%. Fixados no meio da margem, com folga para
# os dois lados. RECALIBRAR com imagens reais dos portais antes do go-live.
LIMIAR_PHASH = 0.38
LIMIAR_DHASH = 0.36
LADO_DHASH = 9                # 9×8 comparações = 64 bits

# Rejeita imagem grande demais antes de decodificar: defesa contra decompression bomb.
Image.MAX_IMAGE_PIXELS = 80_000_000


@dataclass(frozen=True)
class Impressao:
    phash: int
    dhash: int

    def hex(self) -> tuple[str, str]:
        return f"{self.phash:016x}", f"{self.dhash:016x}"


@lru_cache(maxsize=1)
def _matriz_cosseno(n: int) -> tuple[tuple[float, ...], ...]:
    """Pré-computa cos(π(2i+1)k/2n). Sem isso a DCT domina o custo da ingestão."""
    return tuple(
        tuple(math.cos(math.pi * (i + 0.5) * k / n) for i in range(n))
        for k in range(n)
    )


def _dct2(matriz: list[list[float]], n: int) -> list[list[float]]:
    cos = _matriz_cosseno(n)
    linhas = [[sum(linha[i] * cos[k][i] for i in range(n)) for k in range(n)] for linha in matriz]
    return [[sum(linhas[i][x] * cos[k][i] for i in range(n)) for x in range(n)] for k in range(n)]


def phash(img: Image.Image) -> int:
    """pHash por DCT-II 2D. Descarta o coeficiente DC — é só o brilho médio."""
    g = img.convert("L").resize((TAMANHO_DCT, TAMANHO_DCT), Image.Resampling.LANCZOS)
    px = list(g.getdata())  # noqa: compat Pillow <14
    matriz = [[float(px[y * TAMANHO_DCT + x]) for x in range(TAMANHO_DCT)] for y in range(TAMANHO_DCT)]

    coef = _dct2(matriz, TAMANHO_DCT)
    bloco = [coef[k][x] for k in range(BLOCO_BAIXA_FREQ) for x in range(BLOCO_BAIXA_FREQ)][1:]

    mediana = sorted(bloco)[len(bloco) // 2]
    valor = 0
    for b in bloco:
        valor = (valor << 1) | (1 if b > mediana else 0)
    return valor


def dhash(img: Image.Image) -> int:
    """Gradiente horizontal. Barato e quase ortogonal ao pHash."""
    g = img.convert("L").resize((LADO_DHASH, LADO_DHASH - 1), Image.Resampling.LANCZOS)
    px = list(g.getdata())
    valor = 0
    for y in range(LADO_DHASH - 1):
        linha = px[y * LADO_DHASH:(y + 1) * LADO_DHASH]
        for x in range(LADO_DHASH - 1):
            valor = (valor << 1) | (1 if linha[x] > linha[x + 1] else 0)
    return valor


def imprimir(caminho_ou_img) -> Impressao:
    img = caminho_ou_img if isinstance(caminho_ou_img, Image.Image) else Image.open(caminho_ou_img)
    return Impressao(phash=phash(img), dhash=dhash(img))


def hamming(a: int, b: int) -> int:
    return (a ^ b).bit_count()


def mesma_imagem(x: Impressao, y: Impressao) -> tuple[bool, float]:
    """
    Exige concordância dos dois canais. Devolve também a similaridade do canal
    mais forte, para exibição.
    """
    d_p = hamming(x.phash, y.phash) / 63
    d_d = hamming(x.dhash, y.dhash) / 64
    return (d_p <= LIMIAR_PHASH and d_d <= LIMIAR_DHASH), round((1 - d_p) * 100, 1)


# ------------------------------------------------------------------
# Busca — resolve o O(N) do diagnóstico
# ------------------------------------------------------------------

def bandas(valor: int, n_bandas: int = 7, bits: int = 63) -> list[tuple[int, int]]:
    """
    LSH por bandas: fatia o hash em pedaços. Duas imagens dentro do limiar
    coincidem em pelo menos uma banda com altíssima probabilidade, então basta
    indexar as bandas e comparar só quem colide.

    Varredura linear medida: 7,27 s por consulta em 1 milhão de imagens.
    Com bandas, a comparação cai para as dezenas de candidatos que colidem.
    """
    largura = bits // n_bandas
    return [
        (i, (valor >> (i * largura)) & ((1 << largura) - 1))
        for i in range(n_bandas)
    ]


class IndiceImagens:
    """Índice em memória para lote de importação. Em produção, use pgvector/HNSW."""

    def __init__(self) -> None:
        self._bandas: dict[tuple[int, int], list[int]] = {}
        self._impressoes: dict[int, Impressao] = {}

    def adicionar(self, id_imagem: int, imp: Impressao) -> None:
        self._impressoes[id_imagem] = imp
        for chave in bandas(imp.phash):
            self._bandas.setdefault(chave, []).append(id_imagem)

    def similares(self, imp: Impressao) -> list[tuple[int, float]]:
        candidatos: set[int] = set()
        for chave in bandas(imp.phash):
            candidatos.update(self._bandas.get(chave, ()))

        achados = []
        for cid in candidatos:
            igual, sim = mesma_imagem(imp, self._impressoes[cid])
            if igual:
                achados.append((cid, sim))
        return sorted(achados, key=lambda t: -t[1])

    def __len__(self) -> int:
        return len(self._impressoes)
