/* Testes do painel administrativo em DOM headless (jsdom).
   Roda: node testes/painel.test.js  */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("/tmp/node_modules/jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "web", "painel.html"), "utf8");

let passou = 0, falhou = 0;
const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);
function ok(c, m) { if (!c) throw new Error(m || "esperado verdadeiro"); }
function igual(a, b, m) {
  if (a !== b) throw new Error(`${m || "diferente"}: recebido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`);
}

// embute o motor: jsdom não busca script por src local
const motor = fs.readFileSync(path.join(__dirname, "..", "web", "assets", "motor.js"), "utf8");
const htmlComMotor = html.replace('<script src="assets/motor.js"></script>', `<script>${motor}</script>`);
const dom = new JSDOM(htmlComMotor, { runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;
const doc = window.document;
const $ = s => doc.querySelector(s);
const $$ = s => [...doc.querySelectorAll(s)];

// ---------------- entrada ----------------

teste("abre na tela de entrada, não no console", () => {
  ok(!$("#tela-entrada").hidden, "entrada deveria estar visível");
  ok($("#tela-console").hidden, "console não pode aparecer sem login");
});

teste("senha vem antes do segundo fator", () => {
  ok(!$("#passo-senha").hidden);
  ok($("#passo-mfa").hidden, "MFA não pode aparecer antes da senha");
});

teste("continuar leva ao segundo fator", () => {
  window.pedirCodigo();
  ok($("#passo-senha").hidden);
  ok(!$("#passo-mfa").hidden);
});

teste("campo do código aceita só 6 dígitos", () => {
  const c = $("#codigo");
  igual(c.getAttribute("maxlength"), "6");
  igual(c.getAttribute("inputmode"), "numeric");
  igual(c.getAttribute("autocomplete"), "one-time-code");
});

teste("voltar retorna para a senha", () => {
  window.voltarSenha();
  ok(!$("#passo-senha").hidden);
  ok($("#passo-mfa").hidden);
});

teste("entrar revela o console", () => {
  window.entrar();
  ok($("#tela-entrada").hidden);
  ok(!$("#tela-console").hidden);
});

// ---------------- navegação ----------------

const ABAS = ["hoje", "captacoes", "ativos", "leads", "radar", "anuncios", "avaliacao", "oportunidades", "conformidade"];

teste("nove seções existem", () => {
  for (const a of ABAS) ok($("#v-" + a), "faltou a seção " + a);
});

teste("começa em Hoje com as demais escondidas", () => {
  ok(!$("#v-hoje").hidden);
  for (const a of ABAS.slice(1)) ok($("#v-" + a).hidden, a + " deveria estar oculta");
});

teste("cada aba mostra uma seção e esconde as outras", () => {
  const botoes = $$(".aba");
  igual(botoes.length, 9);
  botoes.forEach((b, i) => {
    b.click();
    ABAS.forEach((a, j) => {
      igual($("#v" + "-" + a).hidden, i !== j, `aba ${ABAS[i]}: visibilidade de ${a}`);
    });
    igual(b.getAttribute("aria-current"), "page");
    igual($$(".aba[aria-current]").length, 1, "só uma aba pode estar marcada");
  });
  botoes[0].click();
});

// ---------------- busca de ativos ----------------

teste("tabela de ativos tem linhas", () => {
  ok($$("#tabela-ativos tbody tr").length >= 5);
});

teste("busca filtra por cidade", () => {
  window.filtrar("campinas");
  const visiveis = $$("#tabela-ativos tbody tr").filter(t => !t.hidden);
  ok(visiveis.length >= 1);
  ok(visiveis.every(t => /campinas/i.test(t.textContent)));
  ok($("#sem-resultado").hidden, "não deveria mostrar estado vazio");
});

teste("busca filtra por tipo", () => {
  window.filtrar("galpão");
  const visiveis = $$("#tabela-ativos tbody tr").filter(t => !t.hidden);
  ok(visiveis.length >= 1);
});

teste("busca sem resultado mostra estado vazio e esconde a tabela", () => {
  window.filtrar("zzzqqq");
  ok(!$("#sem-resultado").hidden, "faltou o estado vazio");
  ok($("#v-ativos .quadro").hidden, "tabela deveria sumir");
});

teste("limpar busca restaura tudo", () => {
  window.limparBusca();
  ok($("#sem-resultado").hidden);
  ok(!$("#v-ativos .quadro").hidden);
  ok($$("#tabela-ativos tbody tr").every(t => !t.hidden));
});

teste("busca ignora maiúscula", () => {
  window.filtrar("JUNDIAÍ");
  ok($$("#tabela-ativos tbody tr").filter(t => !t.hidden).length >= 1);
  window.limparBusca();
});

// ---------------- conteúdo de negócio ----------------

teste("pipeline bruto é maior que o ponderado", () => {
  const cifras = $$("#v-hoje .cifra").map(c => c.textContent.replace(/[^\d]/g, ""));
  const bruto = Number(cifras[0]), ponderado = Number(cifras[1]);
  ok(bruto > 0 && ponderado > 0, "cifras não numéricas");
  ok(bruto > ponderado, `bruto ${bruto} deveria superar ponderado ${ponderado}`);
});

teste("soma das comissões bate com o total exibido", () => {
  const linhas = $$("#v-hoje table")[0].querySelectorAll("tbody tr");
  let soma = 0;
  linhas.forEach(l => {
    const celulas = l.querySelectorAll("td.num");
    soma += Number(celulas[celulas.length - 1].textContent.replace(/\./g, ""));
  });
  const total = Number($$("#v-hoje .cifra")[0].textContent.replace(/[^\d]/g, ""));
  igual(soma, total, "a soma da tabela não fecha com o cartão");
});

teste("cada captação exibe o CRECI do anúncio ou está bloqueada", () => {
  const fichas = $$("#v-captacoes .ficha");
  ok(fichas.length >= 4);
  for (const f of fichas) {
    const pe = f.querySelector(".ficha-pe").textContent;
    ok(/CRECISP \d{6}/.test(pe) || /bloqueada/i.test(pe),
       "art. 4º: sem inscrição no anúncio e sem bloqueio — " + pe.trim().slice(0, 60));
  }
});

teste("captação sem assinatura tem publicação bloqueada", () => {
  const semAssinatura = $$("#v-captacoes .ficha")
    .filter(f => /sem assinatura/i.test(f.querySelector(".carimbo").textContent));
  ok(semAssinatura.length >= 1, "faltou o caso sem autorização escrita");
  for (const f of semAssinatura) {
    ok(/bloqueada/i.test(f.querySelector(".ficha-pe").textContent),
       "art. 5º: sem autorização escrita não pode publicar");
  }
});

teste("faixa de habilitação mostra as duas inscrições", () => {
  const t = $(".habilitacao").textContent;
  ok(t.includes("300760") && t.includes("297692"));
  ok(/concess/i.test(t), "situação da PJ deveria aparecer");
});

teste("conformidade lista PF e PJ", () => {
  const t = $("#v-conformidade").textContent;
  ok(t.includes("Joselia") && t.includes("Rodrigo"));
  ok(t.includes("PrimeCorp Imóveis"), "faltou a linha da pessoa jurídica");
});

// ---------------- marca e higiene ----------------

teste("marca usa o arquivo oficial", () => {
  const imgs = $$(".marca img");
  ok(imgs.length >= 1, "logotipo ausente");
  ok(imgs.every(i => /assets\/marca-/.test(i.getAttribute("src"))));
});

teste("vermelho da marca é o oficial", () => {
  ok(html.includes("#D93438"), "cor da marca ausente");
  ok(!html.includes("#DB1D25"), "sobrou o vermelho antigo, que estava errado");
});

teste("sem armazenamento de navegador", () => {
  ok(!/localStorage|sessionStorage/.test(html), "não é suportado em artefato");
});

teste("sair volta para a entrada e limpa o código", () => {
  $("#codigo").value = "123456";
  window.sair();
  ok(!$("#tela-entrada").hidden);
  ok($("#tela-console").hidden);
  igual($("#codigo").value, "");
  ok(!$("#passo-senha").hidden, "deveria voltar ao passo da senha");
});

// ---------------- radar ----------------

teste("varredura roda e separa venda de locação", () => {
  window.rodarRadar();
  const c = $$("#rd-saida .cifra").map(x => Number(x.textContent));
  igual(c[0], 10, "anúncios varridos");
  ok($("#rd-saida").textContent.includes("de locação fora"));
});

teste("mesmo imóvel de três corretores vira um só registro", () => {
  window.rodarRadar();
  const c = $$("#rd-saida .cifra").map(x => Number(x.textContent));
  ok(c[1] < c[0], `${c[1]} imóveis a partir de ${c[0]} anúncios`);
});

teste("alvo de captação mostra desassistência e anunciantes", () => {
  window.rodarRadar();
  const cartoes = $$("#rd-saida .painel").slice(3);
  ok(cartoes.length >= 1, "nenhum alvo listado");
  const t = cartoes[0].textContent;
  ok(/Desassistência \d+/.test(t), "faltou o índice");
  ok(/Anunciantes/.test(t), "faltou a contagem de anunciantes");
  ok(/Reconstruído/.test(t), "faltou o endereço reconstruído");
});

teste("piso de desassistência filtra a lista", () => {
  $("#rd-desas").value = "99";
  window.rodarRadar();
  ok($("#rd-saida").textContent.includes("Nenhum imóvel atingiu"));
  $("#rd-desas").value = "30";
  window.rodarRadar();
});

teste("filtro de município reduz a varredura", () => {
  $("#rd-cidade").value = "Jundiaí";
  window.rodarRadar();
  const cartoes = $$("#rd-saida .painel").slice(3);
  ok(cartoes.every(c => /Jundiaí/.test(c.textContent)), "vazou município fora do filtro");
  $("#rd-cidade").value = "";
  window.rodarRadar();
});

teste("anúncios agrupados ficam visíveis no detalhe", () => {
  window.rodarRadar();
  const det = $("#rd-saida details");
  ok(det, "faltou o detalhamento");
  ok(det.querySelectorAll("tbody tr").length >= 1);
});

// ---------------- anúncios ----------------

teste("motor carregado no painel", () => {
  ok(window.Motor, "assets/motor.js não subiu");
});

teste("cruzamento lê o CSV e conta os anúncios", () => {
  window.processarAnuncios();
  const cifras = $$("#an-saida .cifra").map(c => Number(c.textContent));
  igual(cifras[0], 7, "anúncios lidos");
  // a conta precisa fechar na tela: lidos − repetidos = vinculados + novos
  const unicos = Number($("#an-saida .sob b:last-child").textContent);
  igual(unicos, cifras[1] + cifras[2], "lidos menos repetidos deve fechar com vinculados + novos");
});

teste("duplicata do mesmo anúncio é descartada", () => {
  window.processarAnuncios();
  ok(/1<\/b> repetidos|<b>1<\/b>/.test($("#an-saida").innerHTML) ||
     $("#an-saida").textContent.includes("1 repetidos"), "duplicata não detectada");
});

teste("anúncio de Campinas é vinculado ao ativo certo", () => {
  window.processarAnuncios();
  const linhas = $$("#an-saida tbody tr");
  const campinas = linhas.find(l => l.textContent.includes("18.400"));
  ok(campinas && /PRC-SP-00000141/.test(campinas.textContent), "vínculo errado");
});

teste("anúncio de Itatiba fica sem vínculo", () => {
  window.processarAnuncios();
  const itatiba = $$("#an-saida tbody tr").find(l => l.textContent.includes("Itatiba"));
  ok(itatiba && /Ativo novo/.test(itatiba.textContent));
});

teste("CSV vazio avisa em vez de quebrar", () => {
  const antes = $("#an-csv").value;
  $("#an-csv").value = "";
  window.processarAnuncios();
  ok($("#an-saida").textContent.includes("Nenhum anúncio"));
  $("#an-csv").value = antes;
});

teste("CSV com colunas erradas avisa o formato", () => {
  const antes = $("#an-csv").value;
  $("#an-csv").value = "coluna_a;coluna_b\n1;2";
  window.processarAnuncios();
  ok(/formato|colunas/i.test($("#an-saida").textContent));
  $("#an-csv").value = antes;
});

// ---------------- avaliação ----------------

teste("avaliação devolve faixa e habilita o parecer", () => {
  window.rodarAvaliacao();
  ok($("#av-saida .laudo"), "laudo não renderizou");
  ok(!$("#av-btn-ptam").disabled, "botão de parecer deveria habilitar");
});

teste("P10 < P50 < P90 na tela", () => {
  window.rodarAvaliacao();
  const v = $$("#av-saida .laudo-faixa b").map(b => Number(b.textContent.replace(/[^\d]/g, "")));
  ok(v[0] < v[1] && v[1] < v[2], v.join(" / "));
});

teste("preços de fantasia são descartados por MAD", () => {
  window.rodarAvaliacao();
  const linha = $$("#av-saida .laudo-linha").find(l => /descartados/.test(l.textContent));
  ok(linha, "faltou a linha de descartes");
  const n = Number(linha.textContent.match(/·\s*(\d+)\s*descartados/)[1]);
  ok(n >= 2, "descartou " + n + ", esperado ao menos os 2 outliers do exemplo");
});

teste("amostra insuficiente recusa em vez de inventar", () => {
  const antes = $("#av-comps").value;
  $("#av-comps").value = "cidade;tipo;area;preco\nCampinas;Área industrial;15000;12000000";
  window.rodarAvaliacao();
  ok($("#av-saida").textContent.includes("Não é possível emitir parecer"));
  ok($("#av-btn-ptam").disabled, "parecer deveria ficar bloqueado");
  $("#av-comps").value = antes;
  window.rodarAvaliacao();
});

teste("pretensão acima do mercado dispara o alerta de preço", () => {
  $("#av-pedido").value = "22000000";
  window.rodarAvaliacao();
  ok(/acima do mercado/.test($("#av-saida").textContent));
  $("#av-pedido").value = "12500000";
});

teste("parecer traz inscrição, base normativa e limite da NBR", () => {
  window.rodarAvaliacao();
  window.emitirParecer();
  const t = $("#av-parecer").textContent;
  ok(t.includes("CRECISP 300760"), "faltou a inscrição");
  ok(t.includes("1.066") && t.includes("6.530"), "faltou a base normativa");
  ok(t.includes("14.653"), "faltou a ressalva sobre laudo pericial");
  ok(t.includes("mediana"), "faltou a metodologia");
});

teste("parecer não duplica ao emitir duas vezes", () => {
  window.emitirParecer();
  window.emitirParecer();
  igual($$("#av-parecer").length, 1);
});

// ---------------- oportunidades ----------------

teste("fila de oportunidades é ordenada por valor esperado", () => {
  window.rodarOportunidades();
  const ve = $$("#op-tabela tbody tr").map(t => {
    const c = t.querySelectorAll("td");
    return Number(c[5].textContent.replace(/[^\d]/g, ""));
  });
  for (let i = 1; i < ve.length; i++) ok(ve[i - 1] >= ve[i], "fora de ordem: " + ve.join(" > "));
});

teste("maior comissão não lidera quando o preço está fora do mercado", () => {
  window.rodarOportunidades();
  const linhas = $$("#op-tabela tbody tr").map(t => {
    const c = t.querySelectorAll("td");
    return { nome: c[0].textContent, comissao: Number(c[4].textContent.replace(/[^\d]/g, "")),
             ve: Number(c[5].textContent.replace(/[^\d]/g, "")), destino: c[7].textContent.trim() };
  });
  const maiorComissao = [...linhas].sort((a, b) => b.comissao - a.comissao)[0];
  ok(maiorComissao.nome !== linhas[0].nome,
     "o de maior comissão não deveria liderar — é a inversão que define a tese");
  ok(/PTAM/.test(maiorComissao.destino), "deveria ir para abordagem com parecer");
});

teste("confiança baixa vai para fila de pesquisa, não some da lista", () => {
  window.rodarOportunidades();
  const pesquisa = $$("#op-tabela tbody tr").filter(t => /Fila de pesquisa/.test(t.textContent));
  igual(pesquisa.length, 1, "o ativo de confiança 52 deveria estar na fila de pesquisa");
});

teste("clicar numa linha abre a decomposição do score", () => {
  window.detalharOportunidade("PRC-SP-00000171");
  const barras = $$("#op-detalhe .barra");
  igual(barras.length, 5, "cinco componentes do score");
  ok($("#op-detalhe").textContent.includes("Vinhedo"));
});

// ---------------- ativação de mandato ----------------

teste("mandato sem assinatura não pode ser ativado", () => {
  let avisou = "";
  window.alert = m => avisou = m;
  const r = window.ativarMandato("PRC-SP-00000160");
  igual(r, false);
  ok(/81\.871|autorização escrita/i.test(avisou), "art. 5º não foi citado: " + avisou);
});

teste("anexar autorização libera o botão de ativar", () => {
  window.anexarAutorizacao("PRC-SP-00000160");
  const ficha = doc.querySelector('[data-mandato="PRC-SP-00000160"]');
  ok(/Ativar mandato/.test(ficha.querySelector(".ficha-pe").textContent));
});

teste("depois de assinado, ativar publica com o CRECI do responsável", () => {
  igual(window.ativarMandato("PRC-SP-00000160"), true);
  const ficha = doc.querySelector('[data-mandato="PRC-SP-00000160"]');
  ok(/CRECISP \d{6}/.test(ficha.querySelector(".ficha-pe").textContent), "art. 4º: faltou a inscrição");
  ok(/No ar/.test(ficha.querySelector(".ficha-pe").textContent));
  igual(ficha.querySelector(".carimbo").textContent, "Autorizada");
});

// ---------------- execução ----------------

for (const [nome, fn] of testes) {
  try { fn(); passou++; console.log("  ok    " + nome); }
  catch (e) { falhou++; console.log("  FALHA " + nome + "\n          " + e.message); }
}
console.log(`\n${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
