/* Testes do motor do painel. Os casos espelham tests/test_avaliacao.py:
   se o Python e o JS divergirem, o painel mente para o corretor.
   Roda: node testes/motor.test.js */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("/tmp/node_modules/jsdom");

const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
const window = dom.window;
window.eval(fs.readFileSync(path.join(__dirname, "..", "web", "assets", "motor.js"), "utf8"));
const M = window.Motor;

let passou = 0, falhou = 0;
const testes = [];
const teste = (n, f) => testes.push([n, f]);
function ok(c, m) { if (!c) throw new Error(m || "esperado verdadeiro"); }
function igual(a, b, m) { if (a !== b) throw new Error(`${m || "diferente"}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); }
function perto(a, b, tol, m) {
  if (Math.abs(a - b) > tol) throw new Error(`${m || "fora da tolerância"}: ${a} vs ${b} (±${tol})`);
}

// gerador determinístico, espelha o mercado sintético da suíte Python
function rnd(semente) {
  let s = semente;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}
function mercado({ n = 36, base = 820, elast = -0.22, ruido = 0.14, semente = 3, outliers = 0 } = {}) {
  const r = rnd(semente), comps = [];
  const hoje = Date.now();
  for (let i = 0; i < n; i++) {
    const area = 9000 + r() * 17000;
    const z = Math.sqrt(-2 * Math.log(Math.max(r(), 1e-9))) * Math.cos(2 * Math.PI * r());
    const v = base * Math.pow(area / 15000, elast) * Math.exp(z * ruido);
    comps.push({ id: i, preco: Math.round(v * area), area: Math.round(area), cidade: "Campinas",
                 tipo: "Área industrial", observadoEm: new Date(hoje - r() * 400 * 86400000).toISOString() });
  }
  for (let j = 0; j < outliers; j++) {
    const area = 9000 + r() * 17000;
    comps.push({ id: 900 + j, preco: Math.round(area * 2600), area: Math.round(area), cidade: "Campinas",
                 tipo: "Área industrial", observadoEm: new Date(hoje - 60 * 86400000).toISOString() });
  }
  return comps;
}

// ---------------- estatística ----------------

teste("mediana de lista ímpar e par", () => {
  igual(M.mediana([3, 1, 2]), 2);
  igual(M.mediana([4, 1, 2, 3]), 2.5);
});

teste("MAD resiste a outlier que arruína o desvio-padrão", () => {
  const base = [100, 102, 98, 101, 99];
  perto(M.mad(base), M.mad(base.concat([100000])), 2, "outlier moveu o MAD");
});

teste("percentis respeitam a ordem", () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  ok(M.percentil(v, 0.1) < M.percentil(v, 0.5));
  ok(M.percentil(v, 0.5) < M.percentil(v, 0.9));
});

// ---------------- ajuste de área ----------------

teste("imóvel maior vale menos por m²", () => {
  const a = M.ajustarParaArea(800, 3000, 18000, -0.22);
  ok(a < 800, "ajuste não reduziu");
  ok(a > 500 && a < 700, "valor implausível: " + a);
});

teste("áreas iguais não mudam o valor", () => {
  perto(M.ajustarParaArea(800, 5000, 5000, -0.22), 800, 1e-9);
});

// ---------------- avaliação ----------------

teste("recupera o valor do mercado simulado", () => {
  const r = M.avaliar(mercado(), { tipo: "Área industrial", cidade: "Campinas", area: 15000 });
  ok(!r.erro, r.erro);
  perto(r.valorM2, 820, 820 * 0.15, "R$/m² fora da faixa");
});

teste("ordem dos percentis", () => {
  const r = M.avaliar(mercado(), { tipo: "Área industrial", cidade: "Campinas", area: 18400 });
  ok(r.p10 < r.p50 && r.p50 < r.p90);
});

teste("elasticidade estimada fica perto da verdadeira", () => {
  const r = M.avaliar(mercado({ n: 60, ruido: 0.10 }), { tipo: "Área industrial", cidade: "Campinas", area: 18400 });
  ok(r.elasticidadeEstimada, "deveria estimar com 60 elementos");
  perto(r.elasticidade, -0.22, 0.12);
});

teste("amostra pequena usa a elasticidade da tipologia", () => {
  const r = M.avaliar(mercado({ n: 8 }), { tipo: "Área industrial", cidade: "Campinas", area: 18400 });
  ok(!r.elasticidadeEstimada);
  igual(r.elasticidade, -0.22);
});

teste("recusa amostra insuficiente em vez de inventar", () => {
  const r = M.avaliar(mercado({ n: 4 }), { tipo: "Área industrial", cidade: "Campinas", area: 18400 });
  ok(r.erro && /mínimo/.test(r.erro), "deveria recusar: " + JSON.stringify(r).slice(0, 80));
});

teste("descarta preço de fantasia por MAD", () => {
  const r = M.avaliar(mercado({ outliers: 3 }), { tipo: "Área industrial", cidade: "Campinas", area: 18400 });
  ok(r.descartados >= 3, "descartou " + r.descartados);
});

teste("filtra por cidade e por tipo", () => {
  ok(M.avaliar(mercado(), { tipo: "Área industrial", cidade: "Sorocaba", area: 18400 }).erro);
  ok(M.avaliar(mercado(), { tipo: "Apartamento", cidade: "Campinas", area: 18400 }).erro);
});

teste("confiança cai com dispersão", () => {
  const coeso = M.avaliar(mercado({ n: 40, ruido: 0.06 }), { tipo: "Área industrial", cidade: "Campinas", area: 18400 });
  const ruidoso = M.avaliar(mercado({ n: 40, ruido: 0.45 }), { tipo: "Área industrial", cidade: "Campinas", area: 18400 });
  ok(coeso.confianca > ruidoso.confianca, `${coeso.confianca} vs ${ruidoso.confianca}`);
});

// ---------------- captação ----------------

teste("aderência premia preço no mercado ou abaixo", () => {
  igual(M.aderenciaDePreco(900000, 1000000), 1);
  igual(M.aderenciaDePreco(1000000, 1000000), 1);
});

teste("aderência zera com 30% de sobrepreço", () => {
  perto(M.aderenciaDePreco(1300000, 1000000), 0, 1e-9);
});

teste("sobrepreço reduz o valor esperado apesar da comissão maior", () => {
  const comum = { p50Mercado: 15000000, confiancaAvaliacao: 90, diasNoMercado: 145,
                  absorvidos12m: 11, comissaoPct: 5, modalidade: "exclusiva",
                  proprietarioLocalizado: true, matriculaLimpa: true, estagio: "sem proposta" };
  const justo = M.pontuarCaptacao({ ...comum, precoPretendido: 14250000 });
  const caro = M.pontuarCaptacao({ ...comum, precoPretendido: 20250000 });
  ok(caro.comissaoBruta > justo.comissaoBruta, "comissão do caro deveria ser maior");
  ok(caro.veComissao < justo.veComissao, "VE do caro deveria ser menor — é a inversão da tese");
  ok(caro.score < justo.score);
});

teste("confiança baixa manda para pesquisa, não para descarte", () => {
  const r = M.pontuarCaptacao({ precoPretendido: 1000000, p50Mercado: 1000000, confiancaAvaliacao: 40,
                                diasNoMercado: 120, absorvidos12m: 10, comissaoPct: 6 });
  igual(r.destino, "Fila de pesquisa");
  ok(/descarte/i.test(r.motivo));
});

teste("sobrepreço encaminha para abordagem com parecer", () => {
  const r = M.pontuarCaptacao({ precoPretendido: 1400000, p50Mercado: 1000000, confiancaAvaliacao: 85,
                                diasNoMercado: 120, absorvidos12m: 10, comissaoPct: 6,
                                proprietarioLocalizado: true });
  igual(r.destino, "Abordagem com PTAM");
});

teste("valor da comissão é logarítmico", () => {
  const a = M.valorDaComissao(250000), b = M.valorDaComissao(500000);
  ok(b > a && b < 2 * a, "dobrar a comissão não dobra a prioridade");
});

teste("pipeline bruto supera o ponderado", () => {
  const p = M.pipelinePonderado([
    { comissaoBruta: 590000, estagio: "contraproposta" },
    { comissaoBruta: 249000, estagio: "contrato" },
    { comissaoBruta: 445000, estagio: "proposta" },
    { comissaoBruta: 159000, estagio: "sem proposta" }
  ]);
  igual(p.bruto, 1443000);
  perto(p.ponderado, 512020, 1);
  ok(p.conversao > 0 && p.conversao < 100);
});

// ---------------- anúncios ----------------

const A1 = { portal: "PortalX", idExterno: "123", url: "https://portalx.com.br/imovel/123",
             titulo: "Área industrial Campinas", endereco: "Rua A, Distrito Industrial",
             cidade: "Campinas", area: 18400, preco: 12500000 };

teste("mesma origem gera a mesma impressão", () => {
  igual(M.impressao(A1), M.impressao({ ...A1 }));
});

teste("impressão ignora parâmetro de rastreio na URL", () => {
  igual(M.impressao(A1), M.impressao({ ...A1, url: A1.url + "?utm_source=email" }));
});

teste("anúncio diferente gera impressão diferente", () => {
  ok(M.impressao(A1) !== M.impressao({ ...A1, idExterno: "124", url: "https://portalx.com.br/imovel/124" }));
});

teste("duplicata é detectada no cruzamento", () => {
  const r = M.cruzarAnuncios([A1, { ...A1 }], []);
  igual(r.novos.length, 1);
  igual(r.repetidos.length, 1);
});

teste("vincula anúncio ao ativo quando área e preço confirmam", () => {
  const ativos = [{ id: 1, cidade: "Campinas", bairro: "Distrito Industrial", area: 18400, preco: 12500000 }];
  const r = M.cruzarAnuncios([A1], ativos);
  igual(r.vinculados, 1);
  ok(r.novos[0].confianca >= 70, "confiança " + r.novos[0].confianca);
});

teste("não vincula com cidade e bairro apenas — limiar 70 evita falso positivo", () => {
  const ativos = [{ id: 1, cidade: "Campinas", bairro: "Distrito Industrial", area: 18400, preco: 12500000 }];
  const distinto = { ...A1, area: 18400, preco: 40000000 };  // mesmo bairro e área, preço muito outro
  const r = M.cruzarAnuncios([distinto], ativos);
  ok(r.novos[0].confianca < 100, "não deveria somar tudo");
});

teste("anúncio em cidade sem ativo fica sem vínculo", () => {
  const r = M.cruzarAnuncios([{ ...A1, cidade: "Sorocaba" }], [{ id: 1, cidade: "Campinas", area: 18400 }]);
  igual(r.semVinculo, 1);
  igual(r.vinculados, 0);
});

// ---------------- CSV ----------------

teste("lê CSV com vírgula", () => {
  const { registros } = M.lerCSV("portal,preco,area\nPortalX,1000000,500");
  igual(registros.length, 1);
  igual(registros[0].portal, "PortalX");
});

teste("lê CSV com ponto e vírgula (padrão do Excel brasileiro)", () => {
  const { registros } = M.lerCSV("portal;preco;area\nPortalX;1.250.000,50;500");
  igual(registros[0].preco, "1.250.000,50");
  igual(M.numero(registros[0].preco), 1250000.5);
});

teste("lê campo entre aspas com separador dentro", () => {
  const { registros } = M.lerCSV('titulo,cidade\n"Área industrial, com frente",Campinas');
  igual(registros[0].titulo, "Área industrial, com frente");
  igual(registros[0].cidade, "Campinas");
});

teste("cabeçalho é normalizado sem acento", () => {
  const { cabecalho } = M.lerCSV("Área;Preço;ID Externo\n1;2;3");
  ok(cabecalho.includes("area") && cabecalho.includes("preco") && cabecalho.includes("id_externo"), cabecalho.join(","));
});

teste("número aceita formato brasileiro e americano", () => {
  igual(M.numero("R$ 12.500.000,00"), 12500000);
  igual(M.numero("12500000.5"), 12500000.5);
  igual(M.numero(""), null);
  igual(M.numero("abc"), null);
});


// ---------------- radar ----------------

const HOJE = "2026-08-20";
function anuncio(o) {
  return Object.assign({ portal: "P", idExterno: String(Math.random()), url: "/x",
    titulo: "t", endereco: "", cidade: "Campinas", tipo: "Área industrial",
    area: 18400, preco: 12000000, fotos: 8, descricao: "d".repeat(400),
    publicadoEm: "2026-07-01", finalidade: "venda" }, o);
}

teste("termos de endereço descartam via e ruído", () => {
  const t = M.termosDeEndereco("Rua Projetada, s/n - Distrito Industrial");
  ok(t.includes("projetada") && t.includes("distrito") && t.includes("industrial"), t.join(","));
  ok(!t.includes("rua") && !t.includes("sn"), "sobrou ruído: " + t.join(","));
});

teste("número da via é extraído quando existe", () => {
  igual(M.numeroDaVia("Av. Principal, 1200"), "1200");
  igual(M.numeroDaVia("Rua Projetada, s/n"), null);
});

teste("mesma metragem agrupa mesmo com preço e endereço divergentes", () => {
  const g = M.agruparImoveis([
    anuncio({ portal: "A", preco: 12500000, endereco: "Rua Projetada, Distrito Industrial" }),
    anuncio({ portal: "B", preco: 14900000, endereco: "Av. das Indústrias, Jd. Bandeirantes" }),
    anuncio({ portal: "C", preco: 0, endereco: "Distrito Industrial, s/n" })
  ]);
  igual(g.length, 1, "os três são o mesmo imóvel — é o caso que o radar existe para pegar");
});

teste("metragem diferente não agrupa", () => {
  const g = M.agruparImoveis([anuncio({ area: 18400 }), anuncio({ area: 24100 })]);
  igual(g.length, 2);
});

teste("cidade diferente não agrupa mesmo com área idêntica", () => {
  const g = M.agruparImoveis([anuncio({ cidade: "Campinas" }), anuncio({ cidade: "Sumaré" })]);
  igual(g.length, 2);
});

teste("consenso reconstrói o termo repetido entre anunciantes", () => {
  const c = M.consensoEndereco([
    anuncio({ endereco: "Rua Projetada, Distrito Industrial" }),
    anuncio({ endereco: "Distrito Industrial, s/n" }),
    anuncio({ endereco: "Av. das Indústrias, Jd. Bandeirantes" })
  ]);
  ok(c.termosConsensuais.includes("distrito"), "não achou o termo repetido");
  ok(c.enderecoProvavel && c.enderecoProvavel.includes("distrito"));
});

teste("número confirmado por dois anunciantes é aceito", () => {
  const c = M.consensoEndereco([
    anuncio({ endereco: "Av. Principal, 1200" }),
    anuncio({ endereco: "Avenida Principal 1200, centro" })
  ]);
  igual(c.numeroConfirmado, "1200");
});

teste("anunciante único é sinalizado, não tratado como consenso", () => {
  const c = M.consensoEndereco([anuncio({ endereco: "Rua X, 10" })]);
  igual(c.situacao, "anunciante_unico");
  ok(/matrícula|visita/i.test(c.recado));
});

teste("endereços incompatíveis viram sinal de oportunidade", () => {
  const c = M.consensoEndereco([
    anuncio({ endereco: "Rua Alfa, Centro" }),
    anuncio({ endereco: "Rodovia Beta, km 40" }),
    anuncio({ endereco: "Alameda Gama, Jardim Delta" })
  ]);
  igual(c.situacao, "divergente");
  ok(/oportunidade/i.test(c.recado));
});

teste("anúncio velho, sem foto e sem preço pontua alto na desassistência", () => {
  const d = M.indiceDesassistencia([
    anuncio({ publicadoEm: "2024-11-01", fotos: 0, descricao: "", preco: 0 })
  ], { hoje: HOJE });
  ok(d.indice >= 50, "índice " + d.indice);
  ok(d.motivos.some(m => /foto/i.test(m)));
  ok(d.motivos.some(m => /preço/i.test(m)));
});

teste("anúncio recente e bem feito pontua baixo", () => {
  const d = M.indiceDesassistencia([anuncio({ publicadoEm: "2026-08-01" })], { hoje: HOJE });
  ok(d.indice <= 10, "índice " + d.indice + ": " + d.motivos.join(", "));
});

teste("preço divergente entre corretores entra como motivo", () => {
  const d = M.indiceDesassistencia([
    anuncio({ preco: 12500000 }), anuncio({ preco: 14900000 })
  ], { hoje: HOJE });
  ok(d.motivos.some(m => /varia/i.test(m)), d.motivos.join(", "));
});

teste("radar descarta locação — só venda interessa", () => {
  const r = M.radar([anuncio({ finalidade: "venda" }), anuncio({ area: 3000, finalidade: "locacao" })], { hoje: HOJE });
  igual(r.descartados.locacao, 1);
  igual(r.apos_filtro, 1);
});

teste("radar tira o mesmo anúncio republicado antes de agrupar", () => {
  const a = anuncio({ portal: "X", idExterno: "1", url: "/i/1" });
  const r = M.radar([a, { ...a }], { hoje: HOJE });
  igual(r.duplicados, 1);
  igual(r.imoveis, 1);
});

teste("radar filtra por tipologia e por município", () => {
  const base = [anuncio({ tipo: "Área industrial", cidade: "Campinas" }),
                anuncio({ tipo: "Galpão", cidade: "Jundiaí", area: 6200 })];
  igual(M.radar(base, { tipos: ["Galpão"], hoje: HOJE }).apos_filtro, 1);
  igual(M.radar(base, { cidades: ["Campinas"], hoje: HOJE }).apos_filtro, 1);
});

teste("radar aplica área mínima", () => {
  const r = M.radar([anuncio({ area: 500 }), anuncio({ area: 18400 })], { areaMin: 1000, hoje: HOJE });
  igual(r.apos_filtro, 1);
});

teste("resultado sai ordenado por desassistência", () => {
  const r = M.radar([
    anuncio({ area: 18400, publicadoEm: "2024-10-01", fotos: 0, descricao: "", preco: 0 }),
    anuncio({ area: 6200, publicadoEm: "2026-08-10" })
  ], { hoje: HOJE });
  ok(r.achados[0].desassistencia >= r.achados[1].desassistencia, "fora de ordem");
});

teste("cenário completo: três corretores, um imóvel, endereços diferentes", () => {
  const r = M.radar([
    anuncio({ portal: "PortalX", idExterno: "1", url: "/1", preco: 12500000,
              endereco: "Rua Projetada, Distrito Industrial", publicadoEm: "2026-06-01", fotos: 9 }),
    anuncio({ portal: "PortalY", idExterno: "2", url: "/2", preco: 14900000,
              endereco: "Av. das Indústrias, Jd. Bandeirantes", publicadoEm: "2025-04-10", fotos: 2, descricao: "curto" }),
    anuncio({ portal: "PortalZ", idExterno: "3", url: "/3", preco: 0,
              endereco: "Distrito Industrial, s/n", publicadoEm: "2025-01-15", fotos: 0, descricao: "" })
  ], { hoje: HOJE });

  igual(r.imoveis, 1, "deveria reconhecer um único imóvel");
  const a = r.achados[0];
  igual(a.nAnunciantes, 3);
  ok(a.precoMin === 12500000 && a.precoMax === 14900000, "faixa de preço anunciada");
  ok(a.desassistencia >= 45, "índice " + a.desassistencia);
  ok(a.endereco.enderecoProvavel, "deveria reconstruir algo do endereço");
});

// ---------------- execução ----------------

for (const [n, f] of testes) {
  try { f(); passou++; console.log("  ok    " + n); }
  catch (e) { falhou++; console.log("  FALHA " + n + "\n          " + e.message); }
}
console.log(`\n${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
