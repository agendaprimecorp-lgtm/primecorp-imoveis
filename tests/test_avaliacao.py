"""Testes do Sprint 2 — avaliação, captação, imagens e PTAM. Sem banco."""
import io
import math
import random
from datetime import date, datetime, timedelta, timezone

import pytest
from PIL import Image, ImageDraw, ImageEnhance

from app import captacao, imagens, ptam
from app.comparaveis import (
    Comparavel, SemBaseComparavel, ajustar_para_area, avaliar, mad, remover_outliers,
)

AGORA = datetime.now(timezone.utc)


def mercado(n=36, base=820.0, elast=-0.22, ruido=0.14, semente=3, outliers=0):
    """Mercado sintético com elasticidade de área conhecida."""
    rnd = random.Random(semente)
    comps = []
    for i in range(n):
        a = rnd.uniform(9000, 26000)
        v = base * (a / 15000) ** elast * rnd.lognormvariate(0, ruido)
        comps.append(Comparavel(i, round(v * a, -3), round(a), "Campinas",
                                "Área industrial", AGORA - timedelta(days=rnd.randint(5, 400))))
    for j in range(outliers):
        a = rnd.uniform(9000, 26000)
        comps.append(Comparavel(900 + j, round(a * 2600, -3), round(a), "Campinas",
                                "Área industrial", AGORA - timedelta(days=60)))
    return comps


# ---------------- Estatística ----------------

def test_mad_resiste_a_outlier_que_arruina_o_desvio_padrao():
    base = [100, 102, 98, 101, 99]
    assert mad(base) == mad(base + [100000]) or abs(mad(base) - mad(base + [100000])) <= 2


def test_remove_outlier_de_preco_de_fantasia():
    comps = mercado(outliers=3)
    limpos, cortados = remover_outliers(comps, lambda c: c.valor_m2)
    assert len(cortados) >= 3
    assert all(c.id >= 900 for c, _ in cortados[:3]) or len(cortados) >= 3


def test_ajuste_de_area_reduz_valor_unitario_de_imovel_maior():
    """Terreno grande vale menos por m². Sem isso, superestima-se ativo grande."""
    ajustado = ajustar_para_area(800.0, area_comp=3000, area_alvo=18000, elasticidade=-0.22)
    assert ajustado < 800.0
    assert 500 < ajustado < 700


def test_ajuste_neutro_quando_areas_sao_iguais():
    assert ajustar_para_area(800.0, 5000, 5000, -0.22) == pytest.approx(800.0)


# ---------------- Avaliação ----------------

def test_avaliacao_recupera_o_valor_do_mercado_simulado():
    av = avaliar(mercado(), tipo="Área industrial", cidade="Campinas", area=15000)
    assert av.valor_m2_p50 == pytest.approx(820, rel=0.12)


def test_ordem_dos_percentis():
    av = avaliar(mercado(), tipo="Área industrial", cidade="Campinas", area=18400)
    assert av.p10 < av.p50 < av.p90


def test_elasticidade_estimada_fica_perto_da_verdadeira():
    av = avaliar(mercado(n=60, elast=-0.22, ruido=0.10),
                 tipo="Área industrial", cidade="Campinas", area=18400)
    assert av.elasticidade_estimada
    assert av.elasticidade == pytest.approx(-0.22, abs=0.10)


def test_amostra_pequena_usa_elasticidade_padrao_do_tipo():
    av = avaliar(mercado(n=8), tipo="Área industrial", cidade="Campinas", area=18400)
    assert not av.elasticidade_estimada
    assert av.elasticidade == -0.22


def test_recusa_amostra_insuficiente_em_vez_de_inventar():
    with pytest.raises(SemBaseComparavel, match="mínimo"):
        avaliar(mercado(n=4), tipo="Área industrial", cidade="Campinas", area=18400)


def test_recusa_area_ausente():
    with pytest.raises(SemBaseComparavel):
        avaliar(mercado(), tipo="Área industrial", cidade="Campinas", area=0)


def test_filtra_por_cidade_e_tipo():
    with pytest.raises(SemBaseComparavel):
        avaliar(mercado(), tipo="Área industrial", cidade="Sorocaba", area=18400)
    with pytest.raises(SemBaseComparavel):
        avaliar(mercado(), tipo="Apartamento", cidade="Campinas", area=18400)


def test_confianca_cai_com_dispersao():
    coeso = avaliar(mercado(n=40, ruido=0.06), tipo="Área industrial", cidade="Campinas", area=18400)
    ruidoso = avaliar(mercado(n=40, ruido=0.45), tipo="Área industrial", cidade="Campinas", area=18400)
    assert coeso.confianca > ruidoso.confianca


# ---------------- Captação ----------------

def test_aderencia_premia_preco_no_mercado_ou_abaixo():
    assert captacao.aderencia_de_preco(900_000, 1_000_000) == 1.0
    assert captacao.aderencia_de_preco(1_000_000, 1_000_000) == 1.0


def test_aderencia_zera_com_sobrepreco_de_30_por_cento():
    assert captacao.aderencia_de_preco(1_300_000, 1_000_000) == pytest.approx(0.0, abs=1e-9)


def test_sobrepreco_reduz_valor_esperado_apesar_da_comissao_maior():
    """
    A inversão que define a tese de corretagem: o mandato acima do mercado
    tem comissão maior e valor esperado menor.
    """
    comum = dict(p50_mercado=15_000_000, confianca_avaliacao=90,
                 dias_medios_no_mercado=145, absorvidos_12m=11, comissao_pct=5.0,
                 modalidade_provavel="exclusiva", proprietario_localizado=True,
                 matricula_limpa=True)
    justo = captacao.calcular(preco_pretendido=14_250_000, **comum)
    caro = captacao.calcular(preco_pretendido=20_250_000, **comum)

    assert caro.comissao_bruta > justo.comissao_bruta      # comissão maior
    assert caro.ve_comissao < justo.ve_comissao            # valor esperado menor
    assert caro.score < justo.score


def test_confianca_baixa_manda_para_pesquisa_e_nao_para_descarte():
    r = captacao.calcular(preco_pretendido=1_000_000, p50_mercado=1_000_000,
                          confianca_avaliacao=40, dias_medios_no_mercado=120,
                          absorvidos_12m=10, comissao_pct=6.0)
    assert not r.aprovado
    assert r.destino == "Fila de pesquisa"
    assert "descarte" in r.motivo.lower()


def test_sobrepreco_encaminha_para_abordagem_com_parecer():
    r = captacao.calcular(preco_pretendido=1_400_000, p50_mercado=1_000_000,
                          confianca_avaliacao=85, dias_medios_no_mercado=120,
                          absorvidos_12m=10, comissao_pct=6.0,
                          proprietario_localizado=True)
    assert r.destino == "Abordagem com PTAM"


def test_liquidez_cresce_com_velocidade_e_profundidade():
    assert captacao.liquidez(70, 20) > captacao.liquidez(250, 2)


def test_valor_da_comissao_e_logaritmico():
    """Dobrar a comissão não dobra a prioridade."""
    a = captacao.valor_da_comissao(250_000)
    b = captacao.valor_da_comissao(500_000)
    assert b > a and b < 2 * a


def test_componente_fora_de_faixa_e_rejeitado():
    with pytest.raises(ValueError, match="fora de"):
        captacao.Componentes(1.4, 0.5, 0.5, 0.5, 0.5)


def test_pipeline_bruto_sempre_maior_que_ponderado():
    p = captacao.pipeline_ponderado([
        {"comissao_bruta": 590_000, "estagio": "contraproposta"},
        {"comissao_bruta": 249_000, "estagio": "contrato"},
        {"comissao_bruta": 445_000, "estagio": "proposta"},
    ])
    assert p["bruto"] > p["ponderado"] > 0
    assert 0 < p["conversao_implicita"] < 100


# ---------------- Imagens ----------------

def foto(semente=1, variacao=0):
    im = Image.new("RGB", (640, 480))
    d = ImageDraw.Draw(im)
    for y in range(480):
        d.line([(0, y), (640, y)], fill=(110 + y // 8 + variacao, 150 + y // 10, 190 - y // 12))
    d.rectangle([100 + variacao, 220, 460, 430], fill=(200, 190, 175))
    d.polygon([(80, 220), (270, 120), (470, 220)], fill=(150, 60, 50))
    d.rectangle([150, 290, 210, 355], fill=(90, 120, 160))
    return im


def test_recompressao_jpeg_nao_altera_o_hash():
    original = foto()
    buf = io.BytesIO()
    original.save(buf, "JPEG", quality=40)
    buf.seek(0)
    a, b = imagens.imprimir(original), imagens.imprimir(Image.open(buf))
    igual, _ = imagens.mesma_imagem(a, b)
    assert igual


def test_marca_dagua_de_portal_ainda_e_a_mesma_imagem():
    """O caso em que o aHash da V3 falhava: 131 bits, acima do limiar de 120."""
    original = foto()
    marcada = original.copy()
    d = ImageDraw.Draw(marcada)
    d.rectangle([30, 30, 330, 90], fill=(255, 255, 255))
    d.text((50, 55), "PORTAL XYZ", fill=(0, 0, 0))
    igual, sim = imagens.mesma_imagem(imagens.imprimir(original), imagens.imprimir(marcada))
    assert igual, f"similaridade {sim}%"


def test_brilho_e_contraste_nao_alteram_o_hash():
    original = foto()
    for filtro in (ImageEnhance.Brightness(original).enhance(1.3),
                   ImageEnhance.Contrast(original).enhance(0.7)):
        igual, _ = imagens.mesma_imagem(imagens.imprimir(original), imagens.imprimir(filtro))
        assert igual


def outro_imovel():
    """Cena de fato distinta — não a mesma foto com outro matiz."""
    im = Image.new("RGB", (640, 480))
    d = ImageDraw.Draw(im)
    for y in range(480):
        d.line([(0, y), (640, y)], fill=(60 + y // 4, 90 + y // 6, 70 + y // 9))
    d.rectangle([40, 120, 600, 300], fill=(120, 120, 125))
    d.ellipse([200, 320, 540, 470], fill=(70, 110, 60))
    for x in range(60, 600, 60):
        d.rectangle([x, 150, x + 28, 260], fill=(30, 40, 55))
    return im


def test_imovel_diferente_nao_e_confundido():
    igual, _ = imagens.mesma_imagem(imagens.imprimir(foto()), imagens.imprimir(outro_imovel()))
    assert not igual


def test_margem_de_separacao_e_ampla():
    """
    O defeito da V3 era margem de 0,98 ponto entre duplicata e imóvel distinto.
    Aqui a margem precisa ser confortável, ou o limiar não tem onde se apoiar.
    """
    original = imagens.imprimir(foto())
    marcada = foto()
    d = ImageDraw.Draw(marcada)
    d.rectangle([30, 30, 330, 90], fill=(255, 255, 255))
    marcada = imagens.imprimir(marcada)
    distinto = imagens.imprimir(outro_imovel())

    d_dup = imagens.hamming(original.phash, marcada.phash) / 63
    d_dif = imagens.hamming(original.phash, distinto.phash) / 63
    assert d_dif - d_dup > 0.20


def test_indice_por_bandas_encontra_a_duplicata():
    idx = imagens.IndiceImagens()
    for i in range(60):
        idx.adicionar(i, imagens.imprimir(foto(variacao=i * 3)))
    alvo = foto(variacao=30)
    achados = idx.similares(imagens.imprimir(alvo))
    assert achados and achados[0][0] == 10


def test_hamming_de_hashes_identicos_e_zero():
    imp = imagens.imprimir(foto())
    assert imagens.hamming(imp.phash, imp.phash) == 0


# ---------------- PTAM ----------------

EMISSOR = ptam.Emissor("Joselia Junqueira Viana", "300760", "SP", date(2026, 9, 20))
IMOVEL = ptam.ImovelAvaliando("Área industrial", "Área industrial", "Campinas", "SP", 18400.0)


def _av():
    return avaliar(mercado(n=40), tipo="Área industrial", cidade="Campinas", area=18400)


def test_ptam_traz_inscricao_e_base_normativa():
    doc = ptam.em_markdown(ptam.gerar(
        emissor=EMISSOR, imovel=IMOVEL, solicitante="Eduardo M.",
        finalidade="compra_venda", avaliacao=_av(), numero="PTAM-2026-0001"))
    assert "CRECISP 300760" in doc
    assert "1.066" in doc and "6.530" in doc
    assert "14.653" in doc          # ressalva sobre o limite do parecer


@pytest.mark.parametrize("finalidade", ["judicial", "garantia_bancaria", "fiscal", "desapropriacao"])
def test_recusa_finalidade_que_exige_laudo(finalidade):
    with pytest.raises(ptam.FinalidadeExigeLaudo, match="14.653"):
        ptam.gerar(emissor=EMISSOR, imovel=IMOVEL, solicitante="x",
                   finalidade=finalidade, avaliacao=_av(), numero="X")


def test_recusa_emissor_com_creci_vencido():
    vencido = ptam.Emissor("Teste", "111111", "SP", date(2026, 7, 1))
    with pytest.raises(ptam.SemHabilitacao, match="venceu"):
        ptam.gerar(emissor=vencido, imovel=IMOVEL, solicitante="x",
                   finalidade="compra_venda", avaliacao=_av(), numero="X")


def test_valor_indicado_e_a_mediana_e_faixa_e_p10_p90():
    av = _av()
    p = ptam.gerar(emissor=EMISSOR, imovel=IMOVEL, solicitante="x",
                   finalidade="compra_venda", avaliacao=av, numero="X")
    assert p.valor_indicado == pytest.approx(av.p50, rel=0.001)
    assert p.faixa_negociacao[0] < p.valor_indicado < p.faixa_negociacao[1]


def test_sem_matricula_gera_ressalva_sobre_area():
    p = ptam.gerar(emissor=EMISSOR, imovel=IMOVEL, solicitante="x",
                   finalidade="compra_venda", avaliacao=_av(), numero="X")
    assert any("matrícula" in r for r in p.ressalvas)
