/* ============================================================
   PrimeCorp — motor operacional (navegador)

   Porte fiel dos módulos Python do painel:
     app/comparaveis.py  -> avaliar()
     app/captacao.py     -> pontuarCaptacao()
     app/main.py         -> impressao() / cruzarAnuncios()

   Existe para o painel funcionar de verdade antes da API estar no ar.
   Quando o backend subir, troque as chamadas por fetch nos endpoints
   equivalentes — a forma de entrada e saída é a mesma.
   ============================================================ */
(function (raiz) {
  "use strict";

  const MIN_COMPARAVEIS = 7;
  const MIN_PARA_REGRESSAO = 12;
  const TOLERANCIA_AREA = 0.35;
  const JANELA_MESES = 18;
  const CORTE_MAD = 3.0;

  const ELASTICIDADE_PADRAO = {
    "Área industrial": -0.22, "Galpão": -0.18, "Centro de distribuição": -0.18,
    "Terreno urbano": -0.20, "Área comercial": -0.16, "Gleba rural": -0.28,
    "Fazenda": -0.28, "Chácara": -0.24, "Casa": -0.12, "Apartamento": -0.08,
    "Sala comercial": -0.10, "Loja": -0.12
  };
  const ELASTICIDADE_RESERVA = -0.15;

  const P_FECHAMENTO = {
    "sem proposta": 0.08, "proposta": 0.20, "contraproposta": 0.40,
    "aceita": 0.55, "contrato": 0.70, "due diligence": 0.85,
    "escritura": 0.95, "concluído": 1.00, "perdido": 0.00
  };
  const P_CAPTACAO = { exclusiva: 0.25, simples: 0.45, sem_contato: 0.10 };
  const SOBREPRECO_INTOLERAVEL = 0.30;
  const PISO_CONFIANCA = 60;

  const PESOS = { aderencia: 0.30, liquidez: 0.25, valor: 0.20, exclusividade: 0.15, tratabilidade: 0.10 };

  // ---------- estatística ----------

  function mediana(v) {
    if (!v.length) return 0;
    const o = [...v].sort((a, b) => a - b), m = Math.floor(o.length / 2);
    return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
  }

  function mad(v) {
    if (!v.length) return 0;
    const m = mediana(v);
    return mediana(v.map(x => Math.abs(x - m)));
  }

  function percentil(ordenados, p) {
    if (!ordenados.length) return 0;
    if (ordenados.length === 1) return ordenados[0];
    const pos = p * (ordenados.length - 1);
    const b = Math.floor(pos), a = Math.min(b + 1, ordenados.length - 1);
    return ordenados[b] + (ordenados[a] - ordenados[b]) * (pos - b);
  }

  // ---------- ajuste de escala ----------

  function ajustarParaArea(valorM2, areaComp, areaAlvo, elasticidade) {
    if (areaComp <= 0 || areaAlvo <= 0) return valorM2;
    return valorM2 * Math.pow(areaAlvo / areaComp, elasticidade);
  }

  function estimarElasticidade(comps) {
    if (comps.length < MIN_PARA_REGRESSAO) return [0, false];
    const xs = comps.map(c => Math.log(c.area));
    const ys = comps.map(c => Math.log(c.preco / c.area));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    if (den === 0) return [0, false];
    const b = num / den;
    if (b < -0.60 || b > 0.10) return [0, false];   // fora disso a amostra diz outra coisa
    return [b, true];
  }

  // ---------- seleção ----------

  function selecionar(candidatos, { tipo, cidade, area, hoje }) {
    const agora = hoje ? new Date(hoje) : new Date();
    const limite = new Date(agora.getTime() - JANELA_MESES * 30.44 * 86400000);
    const piso = area * (1 - TOLERANCIA_AREA), teto = area * (1 + TOLERANCIA_AREA);
    const alvo = (cidade || "").trim().toLowerCase();
    return candidatos.filter(c =>
      c.tipo === tipo &&
      (c.cidade || "").trim().toLowerCase() === alvo &&
      c.area > 0 && c.preco > 0 &&
      c.area >= piso && c.area <= teto &&
      (!c.observadoEm || new Date(c.observadoEm) >= limite)
    );
  }

  // ---------- avaliação ----------

  function avaliar(candidatos, opcoes) {
    const { tipo, cidade, area } = opcoes;
    if (!(area > 0)) return { erro: "Área do imóvel avaliando não informada." };

    const brutos = selecionar(candidatos, opcoes);
    if (brutos.length < MIN_COMPARAVEIS) {
      return {
        erro: `${brutos.length} comparáveis encontrados; o mínimo para sustentar um parecer é ` +
              `${MIN_COMPARAVEIS}. Amplie a janela ou registre novas pesquisas.`
      };
    }

    // corte de discrepantes a 3 MAD sobre o valor unitário
    const unitarios = brutos.map(c => c.preco / c.area);
    const m = mediana(unitarios), d = mad(unitarios);
    const limpos = [], descartados = [];
    for (const c of brutos) {
      const desvio = d ? Math.abs(c.preco / c.area - m) / d : 0;
      if (d && desvio > CORTE_MAD) descartados.push({ comp: c, desvio });
      else limpos.push(c);
    }
    if (limpos.length < MIN_COMPARAVEIS) {
      return {
        erro: `Após remover discrepantes restaram ${limpos.length} comparáveis, abaixo do ` +
              `mínimo de ${MIN_COMPARAVEIS}. A amostra está dispersa demais.`
      };
    }

    let [elast, estimada] = estimarElasticidade(limpos);
    if (!estimada) elast = ELASTICIDADE_PADRAO[tipo] ?? ELASTICIDADE_RESERVA;

    const ajustados = limpos
      .map(c => ajustarParaArea(c.preco / c.area, c.area, area, elast))
      .sort((a, b) => a - b);

    const v50 = mediana(ajustados);
    const dispersao = v50 ? mad(ajustados) / v50 : 0;

    // confiança: grandeza separada do valor, nunca somada a ele
    const cN = Math.min(1, Math.log(limpos.length / MIN_COMPARAVEIS + 1) / Math.log(40 / MIN_COMPARAVEIS + 1));
    const cD = Math.max(0, Math.min(1, (0.40 - dispersao) / 0.30));
    const cE = estimada ? 1 : 0.80;
    const confianca = Math.round(100 * (0.40 * cN + 0.45 * cD + 0.15 * cE));

    return {
      p10: percentil(ajustados, 0.10) * area,
      p50: v50 * area,
      p90: percentil(ajustados, 0.90) * area,
      valorM2: v50,
      comparaveis: limpos.length,
      descartados: descartados.length,
      elasticidade: elast,
      elasticidadeEstimada: estimada,
      dispersao,
      confianca,
      amostra: limpos,
      cortados: descartados
    };
  }

  // ---------- captação ----------

  function aderenciaDePreco(pretendido, p50) {
    if (!(p50 > 0)) return 0;
    const excesso = (pretendido - p50) / p50;
    if (excesso <= 0) return 1;
    return Math.max(0, 1 - excesso / SOBREPRECO_INTOLERAVEL);
  }

  function liquidez(diasNoMercado, absorvidos12m) {
    const vel = Math.max(0, Math.min(1, (270 - diasNoMercado) / 210));
    const prof = Math.min(1, Math.log1p(absorvidos12m) / Math.log1p(24));
    return 0.6 * vel + 0.4 * prof;
  }

  function valorDaComissao(bruta, referencia = 250000) {
    if (!(bruta > 0)) return 0;
    return Math.min(1, Math.log1p(bruta / referencia) / Math.log1p(4));
  }

  function pontuarCaptacao(e) {
    const comissaoBruta = e.precoPretendido * e.comissaoPct / 100;
    const trat = (e.proprietarioLocalizado ? 0.6 : 0) +
                 (e.matriculaLimpa === true ? 0.4 : e.matriculaLimpa === null || e.matriculaLimpa === undefined ? 0.2 : 0);

    const comp = {
      aderencia: aderenciaDePreco(e.precoPretendido, e.p50Mercado),
      liquidez: liquidez(e.diasNoMercado ?? 180, e.absorvidos12m ?? 0),
      valor: valorDaComissao(comissaoBruta),
      exclusividade: e.modalidade === "exclusiva" ? 0.9 : 0.5,
      tratabilidade: Math.min(1, trat)
    };

    const score = Math.round(100 * Object.keys(PESOS).reduce((s, k) => s + PESOS[k] * comp[k], 0));
    const pCaptar = e.proprietarioLocalizado ? (P_CAPTACAO[e.modalidade] ?? 0.35) : P_CAPTACAO.sem_contato;
    const pVender = P_FECHAMENTO[e.estagio] ?? 0.08;

    // aderência entra duas vezes de propósito: afeta assinar e afeta vender
    const ve = comissaoBruta * pCaptar * pVender * (0.4 + 0.6 * comp.aderencia);

    let destino, motivo;
    if (e.confiancaAvaliacao < PISO_CONFIANCA) {
      destino = "Fila de pesquisa";
      motivo = `Confiança da avaliação em ${e.confiancaAvaliacao} (piso ${PISO_CONFIANCA}). ` +
               `Não é descarte: é pesquisa de comparáveis antes de abordar o proprietário.`;
    } else if (comp.aderencia < 0.35) {
      destino = "Abordagem com PTAM";
      motivo = `Expectativa ${((e.precoPretendido / e.p50Mercado - 1) * 100).toFixed(0)}% acima do mercado. ` +
               `Captar sem alinhar preço gera mandato que vence sem venda — leve o parecer à conversa.`;
    } else {
      destino = "Captação";
      motivo = "Preço aderente ao mercado e evidência suficiente para abordar.";
    }

    return { score, componentes: comp, comissaoBruta, veComissao: ve, destino, motivo,
             desvioPct: (e.precoPretendido / e.p50Mercado - 1) * 100 };
  }

  function pipelinePonderado(negocios) {
    let bruto = 0, ponderado = 0;
    for (const n of negocios) {
      bruto += n.comissaoBruta;
      ponderado += n.comissaoBruta * (P_FECHAMENTO[n.estagio] ?? 0.08);
    }
    return { bruto, ponderado, conversao: bruto ? ponderado / bruto * 100 : 0, n: negocios.length };
  }

  // ---------- anúncios: impressão e cruzamento ----------

  function normalizar(t) {
    return (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  /* Assinatura do anúncio. Mesma composição do upsert do backend:
     portal + id externo + caminho da URL + título + endereço + área arredondada.
     Dois anúncios com a mesma assinatura são o mesmo anúncio. */
  function impressao(a) {
    let caminho = "";
    try { caminho = a.url ? new URL(a.url, "https://x/").pathname : ""; } catch (_) { caminho = a.url || ""; }
    const bruto = [
      normalizar(a.portal), normalizar(a.idExterno), normalizar(caminho),
      normalizar(a.titulo), normalizar(a.endereco),
      String(Math.round((Number(a.area) || 0) * 10) / 10)
    ].join("|");
    let h = 0;
    for (let i = 0; i < bruto.length; i++) { h = (h * 31 + bruto.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  /* Cruzamento anúncio -> ativo. Blocking por cidade e faixa de área antes de
     comparar, como no backend: sem isso a busca degrada linearmente. */
  function cruzarAnuncios(anuncios, ativos) {
    const porImpressao = new Map();
    const resultado = { novos: [], repetidos: [], vinculados: 0, semVinculo: 0 };

    for (const a of anuncios) {
      const imp = impressao(a);
      if (porImpressao.has(imp)) { resultado.repetidos.push({ anuncio: a, igualA: porImpressao.get(imp) }); continue; }
      porImpressao.set(imp, a);

      const candidatos = ativos.filter(t =>
        normalizar(t.cidade) === normalizar(a.cidade) &&
        t.area > 0 && a.area > 0 &&
        Math.abs(t.area - a.area) / t.area <= 0.10
      );

      let melhor = null, melhorPonto = 0;
      for (const t of candidatos) {
        let p = 0;
        if (normalizar(t.cidade) === normalizar(a.cidade)) p += 30;
        if (t.bairro && a.endereco && normalizar(a.endereco).includes(normalizar(t.bairro))) p += 25;
        if (t.area && a.area && Math.abs(t.area - a.area) / t.area <= 0.03) p += 25;
        if (t.preco && a.preco && Math.abs(t.preco - a.preco) / t.preco <= 0.08) p += 20;
        if (p > melhorPonto) { melhorPonto = p; melhor = t; }
      }

      /* Limiar 70, não 50: com 50 bastavam cidade + bairro para vincular,
         sem nenhuma confirmação de área ou preço — vínculo falso. */
      if (melhor && melhorPonto >= 70) {
        resultado.novos.push({ anuncio: a, ativo: melhor, confianca: melhorPonto, impressao: imp });
        resultado.vinculados++;
      } else {
        resultado.novos.push({ anuncio: a, ativo: null, confianca: melhorPonto, impressao: imp });
        resultado.semVinculo++;
      }
    }
    return resultado;
  }

  /* Leitor de CSV tolerante: aceita ; ou , como separador e campos entre aspas. */
  function lerCSV(texto) {
    const linhas = texto.replace(/\r/g, "").split("\n").filter(l => l.trim());
    if (!linhas.length) return { cabecalho: [], registros: [] };
    const sep = (linhas[0].match(/;/g) || []).length > (linhas[0].match(/,/g) || []).length ? ";" : ",";

    function fatiar(linha) {
      const saida = []; let atual = "", aspas = false;
      for (let i = 0; i < linha.length; i++) {
        const c = linha[i];
        if (c === '"') { if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas; }
        else if (c === sep && !aspas) { saida.push(atual); atual = ""; }
        else atual += c;
      }
      saida.push(atual);
      return saida.map(s => s.trim());
    }

    const cabecalho = fatiar(linhas[0]).map(h => normalizar(h).replace(/ /g, "_"));
    const registros = linhas.slice(1).map(l => {
      const partes = fatiar(l), obj = {};
      cabecalho.forEach((h, i) => obj[h] = partes[i] ?? "");
      return obj;
    });
    return { cabecalho, registros };
  }

  function numero(v) {
    if (v === null || v === undefined || v === "") return null;
    const t = String(v).replace(/[R$\s]/g, "");
    // 1.234.567,89 -> 1234567.89 · 1234567.89 fica como está
    const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
    return Number.isFinite(n) ? n : null;
  }


  /* ============================================================
     RADAR — varredura de oportunidade de captação

     Problema real que resolve: o mesmo imóvel é anunciado por vários
     corretores, cada um informando um endereço diferente, e nenhum
     informando o certo. Quem cruza os anúncios recupera a verdade por
     concordância — e descobre quais imóveis bons estão mal servidos.
     ============================================================ */

  const PALAVRAS_VIA = ["rua", "r", "avenida", "av", "rodovia", "rod", "estrada", "estr",
                        "alameda", "al", "travessa", "praca", "praça", "via", "marginal"];
  const RUIDO_ENDERECO = ["sn", "s n", "numero", "n", "lote", "quadra", "km", "bairro",
                          "proximo", "proxima", "regiao", "zona", "cep", "sp"];

  /* Extrai os termos que identificam a via, descartando ruído.
     "Rua Projetada, s/n - Distrito Industrial" -> ["projetada","distrito","industrial"] */
  function termosDeEndereco(texto) {
    return normalizar(texto)
      .replace(/[.,;/\-–—]/g, " ")
      .split(/\s+/)
      .filter(t => t.length >= 3 && !PALAVRAS_VIA.includes(t) && !RUIDO_ENDERECO.includes(t) && !/^\d+$/.test(t));
  }

  function numeroDaVia(texto) {
    const m = normalizar(texto).match(/(?:^|[\s,])n?[ºo°]?\s?(\d{1,5})(?![\d\/])/);
    return m ? m[1] : null;
  }

  /* Agrupa anúncios que são o MESMO IMÓVEL, ainda que de anunciantes
     diferentes, com fotos e textos diferentes. Distinto da deduplicação:
     ali é o mesmo anúncio republicado; aqui são concorrentes no mesmo bem. */
  function agruparImoveis(anuncios, { tolForte = 0.01, tolAmpla = 0.03, tolPrecoPct = 0.12 } = {}) {
    const grupos = [];
    for (const a of anuncios) {
      if (!a.area) { grupos.push({ anuncios: [a], vinculo: "sem_area" }); continue; }
      let destino = null, forca = null;

      for (const g of grupos) {
        const r = g.anuncios[0];
        if (!r.area) continue;
        if (normalizar(r.cidade) !== normalizar(a.cidade)) continue;
        if (r.tipo && a.tipo && normalizar(r.tipo) !== normalizar(a.tipo)) continue;

        const difArea = Math.abs(r.area - a.area) / r.area;

        /* A ÁREA é o identificador. Preço e endereço são justamente os campos
           que o corretor desalinhado erra — exigi-los como confirmação faria
           o radar perder o caso que ele existe para encontrar. */
        if (difArea <= tolForte) { destino = g; forca = "area_exata"; break; }

        if (difArea <= tolAmpla) {
          const precoBate = r.preco && a.preco && Math.abs(r.preco - a.preco) / r.preco <= tolPrecoPct;
          const termosR = new Set(termosDeEndereco(r.endereco || ""));
          const enderecoBate = termosDeEndereco(a.endereco || "").some(t => termosR.has(t));
          if (precoBate || enderecoBate) { destino = g; forca = "area_e_confirmacao"; break; }
        }
      }

      if (destino) { destino.anuncios.push(a); destino.vinculo = forca; }
      else grupos.push({ anuncios: [a], vinculo: "unico" });
    }
    return grupos;
  }

  /* Triangulação de endereço. Cada anunciante informa uma versão; o termo
     que mais se repete tem a maior chance de ser o correto. Divergência
     alta é sinal, não ruído: indica que os corretores não sabem onde o
     imóvel fica — e é aí que mora a oportunidade. */
  function consensoEndereco(grupo) {
    const anuncios = grupo.anuncios || grupo;
    const contagem = new Map();
    const numeros = new Map();

    for (const a of anuncios) {
      const vistos = new Set(termosDeEndereco(a.endereco || ""));
      for (const t of vistos) contagem.set(t, (contagem.get(t) || 0) + 1);
      const n = numeroDaVia(a.endereco || "");
      if (n) numeros.set(n, (numeros.get(n) || 0) + 1);
    }

    const ordenados = [...contagem.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    const consensuais = ordenados.filter(([, n]) => n >= 2).map(([t]) => t);
    const isolados = ordenados.filter(([, n]) => n === 1).map(([t]) => t);

    const totalTermos = ordenados.length || 1;
    const concordancia = Math.round(consensuais.length / totalTermos * 100);

    const numeroTop = [...numeros.entries()].sort((a, b) => b[1] - a[1])[0];
    const numeroConfirmado = numeroTop && numeroTop[1] >= 2 ? numeroTop[0] : null;

    let situacao, recado;
    if (anuncios.length === 1) {
      situacao = "anunciante_unico";
      recado = "Um único anunciante. Não há como conferir o endereço por cruzamento — exige matrícula ou visita.";
    } else if (concordancia >= 60) {
      situacao = "convergente";
      recado = `${anuncios.length} anunciantes concordam na maior parte dos termos. Endereço provável reconstruído.`;
    } else if (concordancia >= 25) {
      situacao = "parcial";
      recado = `${anuncios.length} anunciantes divergem parcialmente. Confirmar com matrícula antes de abordar.`;
    } else {
      situacao = "divergente";
      recado = `${anuncios.length} anunciantes informam endereços incompatíveis. Ninguém sabe onde o imóvel fica — oportunidade.`;
    }

    return {
      termosConsensuais: consensuais,
      termosIsolados: isolados,
      numeroConfirmado,
      concordancia,
      situacao,
      recado,
      enderecoProvavel: consensuais.length
        ? consensuais.slice(0, 6).join(" ") + (numeroConfirmado ? ", nº " + numeroConfirmado : "")
        : null,
      anunciantes: [...new Set(anuncios.map(a => a.portal || a.anunciante || "—"))]
    };
  }

  /* Índice de desassistência: o quanto o proprietário está mal servido.
     Alto = anúncio velho, pobre, sem preço, abandonado ou bagunçado entre
     corretores. É a lista de quem tende a aceitar uma conversa de captação. */
  function indiceDesassistencia(grupo, { hoje } = {}) {
    const anuncios = grupo.anuncios || grupo;
    const agora = hoje ? new Date(hoje) : new Date();
    const motivos = [];
    let pontos = 0;

    const dias = anuncios
      .map(a => a.publicadoEm ? Math.round((agora - new Date(a.publicadoEm)) / 86400000) : null)
      .filter(d => d !== null);
    const maisVelho = dias.length ? Math.max(...dias) : null;

    if (maisVelho !== null) {
      if (maisVelho >= 365) { pontos += 28; motivos.push(`No mercado há ${Math.round(maisVelho / 30)} meses`); }
      else if (maisVelho >= 180) { pontos += 20; motivos.push(`No mercado há ${Math.round(maisVelho / 30)} meses`); }
      else if (maisVelho >= 90) { pontos += 10; motivos.push("No mercado há mais de 3 meses"); }
    }

    const semPreco = anuncios.filter(a => !a.preco).length;
    if (semPreco === anuncios.length) { pontos += 16; motivos.push("Nenhum anúncio informa preço"); }
    else if (semPreco) { pontos += 6; motivos.push(`${semPreco} anúncio(s) sem preço`); }

    const fotos = Math.max(...anuncios.map(a => Number(a.fotos) || 0));
    if (fotos === 0) { pontos += 16; motivos.push("Sem fotos"); }
    else if (fotos <= 3) { pontos += 10; motivos.push(`Apenas ${fotos} foto(s)`); }

    const descricao = Math.max(...anuncios.map(a => (a.descricao || "").trim().length));
    if (descricao < 120) { pontos += 12; motivos.push("Descrição vazia ou muito curta"); }
    else if (descricao < 300) { pontos += 5; motivos.push("Descrição pobre"); }

    const semArea = anuncios.filter(a => !a.area).length;
    if (semArea) { pontos += 8; motivos.push("Metragem ausente em algum anúncio"); }

    // preços divergentes entre corretores: ninguém alinhou com o proprietário
    const precos = anuncios.map(a => a.preco).filter(Boolean);
    if (precos.length >= 2) {
      const espalhamento = (Math.max(...precos) - Math.min(...precos)) / Math.min(...precos);
      if (espalhamento > 0.15) {
        pontos += 14;
        motivos.push(`Preço varia ${(espalhamento * 100).toFixed(0)}% entre anunciantes`);
      }
    }

    // endereço bagunçado
    const cons = consensoEndereco(anuncios);
    if (cons.situacao === "divergente") { pontos += 14; motivos.push("Endereços incompatíveis entre anunciantes"); }
    else if (cons.situacao === "parcial") { pontos += 7; motivos.push("Endereços parcialmente divergentes"); }

    return { indice: Math.min(100, pontos), motivos, diasNoMercado: maisVelho, consenso: cons };
  }

  /* Varredura completa. Só venda: locação é outro negócio e outra comissão. */
  function radar(anuncios, opcoes = {}) {
    const { tipos = null, cidades = null, apenasVenda = true, areaMin = 0, areaMax = Infinity,
            precoMin = 0, precoMax = Infinity, hoje = null } = opcoes;

    const descartados = { locacao: 0, tipo: 0, cidade: 0, faixa: 0 };
    const filtrados = anuncios.filter(a => {
      const fin = normalizar(a.finalidade || "venda");
      if (apenasVenda && fin && fin !== "venda") { descartados.locacao++; return false; }
      if (tipos && tipos.length && !tipos.map(normalizar).includes(normalizar(a.tipo))) { descartados.tipo++; return false; }
      if (cidades && cidades.length && !cidades.map(normalizar).includes(normalizar(a.cidade))) { descartados.cidade++; return false; }
      const area = Number(a.area) || 0, preco = Number(a.preco) || 0;
      if (area && (area < areaMin || area > areaMax)) { descartados.faixa++; return false; }
      if (preco && (preco < precoMin || preco > precoMax)) { descartados.faixa++; return false; }
      return true;
    });

    // tira o mesmo anúncio republicado antes de agrupar por imóvel
    const porImpressao = new Map();
    for (const a of filtrados) {
      const imp = impressao(a);
      if (!porImpressao.has(imp)) porImpressao.set(imp, a);
    }
    const unicos = [...porImpressao.values()];
    const grupos = agruparImoveis(unicos);

    const achados = grupos.map(g => {
      const d = indiceDesassistencia(g, { hoje });
      const precos = g.anuncios.map(a => a.preco).filter(Boolean);
      return {
        anuncios: g.anuncios,
        anunciantes: d.consenso.anunciantes,
        nAnunciantes: d.consenso.anunciantes.length,
        cidade: g.anuncios[0].cidade,
        tipo: g.anuncios[0].tipo || "—",
        area: g.anuncios[0].area || null,
        precoMin: precos.length ? Math.min(...precos) : null,
        precoMax: precos.length ? Math.max(...precos) : null,
        endereco: d.consenso,
        desassistencia: d.indice,
        motivos: d.motivos,
        diasNoMercado: d.diasNoMercado
      };
    }).sort((a, b) => b.desassistencia - a.desassistencia);

    return {
      lidos: anuncios.length,
      apos_filtro: filtrados.length,
      duplicados: filtrados.length - unicos.length,
      imoveis: grupos.length,
      descartados,
      achados
    };
  }

  raiz.Motor = {
    avaliar, selecionar, ajustarParaArea, estimarElasticidade, mediana, mad, percentil,
    pontuarCaptacao, aderenciaDePreco, liquidez, valorDaComissao, pipelinePonderado,
    impressao, cruzarAnuncios, lerCSV, numero, normalizar,
    radar, agruparImoveis, consensoEndereco, indiceDesassistencia, termosDeEndereco, numeroDaVia,
    P_FECHAMENTO, PESOS, MIN_COMPARAVEIS, PISO_CONFIANCA
  };
})(window);
