/* Testes do site em DOM headless (jsdom).
   Roda: node testes/site.test.js  */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("/tmp/node_modules/jsdom");

const BASE = path.join(__dirname, "..", "web");
let html = fs.readFileSync(path.join(BASE, "index.html"), "utf8");
const mun = fs.readFileSync(path.join(BASE, "assets/municipios-sp.js"), "utf8");
const cal = fs.readFileSync(path.join(BASE, "assets/calibracao.js"), "utf8");

// embute os scripts externos (jsdom não busca arquivos locais por src)
html = html.replace(
  '<script src="assets/municipios-sp.js"></script>\n<script src="assets/calibracao.js"></script>',
  `<script>${mun}</script>\n<script>${cal}</script>`
);

let passou = 0, falhou = 0;
const testes = [];
const teste = (nome, fn) => testes.push([nome, fn]);
function ok(cond, msg) { if (!cond) throw new Error(msg || "esperado verdadeiro"); }
function igual(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "valores diferentes"}: recebido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`);
}

const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://www.primecorpimoveis.com.br/" });
const { window } = dom;
const doc = window.document;
const $ = s => doc.querySelector(s);

// jsdom não tem PointerEvent
function toque(alvo) {
  const ev = new window.MouseEvent("pointerdown", { bubbles: true, cancelable: true });
  alvo.dispatchEvent(ev);
}
function digitar(campo, texto) {
  campo.value = texto;
  campo.dispatchEvent(new window.Event("input", { bubbles: true }));
}
function tecla(campo, key) {
  campo.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

// ---------------- estrutura ----------------

teste("645 municípios carregados", () => {
  igual(window.MUNICIPIOS_SP.length, 645);
});

teste("nenhum <datalist> no documento", () => {
  igual(doc.querySelectorAll("datalist").length, 0, "datalist não funciona no Safari do iOS");
});

teste("16 tipologias no seletor da capa", () => {
  igual($("#m-tipo").options.length, 16);
});

teste("seletor de tipo do formulário tem opção vazia inicial", () => {
  igual($("#f-tipo").options[0].value, "");
  igual($("#f-tipo").options.length, 17);
});

teste("três imóveis na vitrine", () => {
  igual(doc.querySelectorAll("#vitrine-lista .imovel").length, 3);
});

teste("CRECI aparece em cada imóvel da vitrine", () => {
  const registros = [...doc.querySelectorAll("#vitrine-lista .registro")];
  igual(registros.length, 3);
  ok(registros.every(r => /CRECISP \d{6}/.test(r.textContent)), "art. 4º do Decreto 81.871/1978");
});

teste("marca usa arquivo oficial, não desenho", () => {
  const img = $(".marca img");
  ok(img, "logotipo ausente no cabeçalho");
  ok(/marca-horizontal/.test(img.getAttribute("src")), "src inesperado: " + img.getAttribute("src"));
  igual(doc.querySelectorAll("header svg path[stroke]").length, 0, "sobrou marca redesenhada em SVG");
});

teste("rodapé declara PJ em concessão", () => {
  ok($(".legal").textContent.includes("concessão"));
});

// ---------------- seletor de município ----------------

teste("digitar abre a lista de sugestões", () => {
  const campo = $("#m-cidade");
  digitar(campo, "camp");
  const itens = doc.querySelectorAll("#m-cidade-lista li[data-i]");
  ok(itens.length > 0, "nenhuma sugestão apareceu");
  ok([...itens].some(i => i.textContent.includes("Campinas")), "Campinas não sugerida");
  igual(campo.getAttribute("aria-expanded"), "true");
});

teste("busca ignora acento", () => {
  digitar($("#m-cidade"), "sao jose do rio preto");
  const itens = [...doc.querySelectorAll("#m-cidade-lista li[data-i]")];
  ok(itens.some(i => i.textContent.includes("São José do Rio Preto")), "acento quebrou a busca");
});

teste("prefixo tem prioridade sobre trecho no meio", () => {
  digitar($("#m-cidade"), "santo");
  const primeiro = doc.querySelector("#m-cidade-lista li[data-i]").textContent;
  ok(primeiro.toLowerCase().startsWith("santo"), "primeiro resultado foi: " + primeiro);
});

teste("município conhecido vem antes do homônimo pequeno", () => {
  const casos = [["campin", "Campinas"], ["jundia", "Jundiaí"], ["santo", "Santos"], ["sao pa", "São Paulo"]];
  for (const [termo, esperado] of casos){
    digitar($("#m-cidade"), termo);
    const primeiro = doc.querySelector("#m-cidade-lista li[data-i]").textContent;
    igual(primeiro, esperado, `busca "${termo}"`);
  }
});

teste("no máximo 10 sugestões", () => {
  digitar($("#m-cidade"), "a");
  ok(doc.querySelectorAll("#m-cidade-lista li[data-i]").length <= 10);
});

teste("termo sem resultado mostra aviso, não lista vazia", () => {
  digitar($("#m-cidade"), "zzzqqq");
  const vazio = doc.querySelector("#m-cidade-lista li.vazio");
  ok(vazio, "faltou o estado vazio");
  ok(vazio.textContent.includes("Nenhum município"));
});

teste("toque na sugestão preenche o campo e guarda o slug", () => {
  const campo = $("#m-cidade");
  digitar(campo, "campin");
  const alvo = [...doc.querySelectorAll("#m-cidade-lista li[data-i]")]
    .find(i => i.textContent.includes("Campinas"));
  toque(alvo);
  igual(campo.value, "Campinas");
  igual(campo.dataset.slug, "campinas");
  ok($("#m-cidade-lista").hidden, "lista deveria fechar após escolher");
});

teste("setas e Enter escolhem pelo teclado", () => {
  const campo = $("#m-cidade");
  digitar(campo, "jundia");
  tecla(campo, "ArrowDown");
  tecla(campo, "Enter");
  igual(campo.value, "Jundiaí");
  igual(campo.dataset.slug, "jundiai");
});

teste("Escape fecha a lista", () => {
  const campo = $("#m-cidade");
  digitar(campo, "sum");
  ok(!$("#m-cidade-lista").hidden);
  tecla(campo, "Escape");
  ok($("#m-cidade-lista").hidden);
});

teste("campo do formulário tem o mesmo seletor", () => {
  const campo = $("#f-cidade");
  digitar(campo, "indaia");
  const itens = doc.querySelectorAll("#f-cidade-lista li[data-i]");
  ok(itens.length > 0, "seletor não montado no formulário");
});

// ---------------- consulta de faixa ----------------

teste("município sem calibração convida ao parecer, não inventa valor", () => {
  const campo = $("#m-cidade");
  digitar(campo, "campinas");
  tecla(campo, "ArrowDown"); tecla(campo, "Enter");
  $("#m-area").value = "18400";
  $("#m-botao").click();
  const saida = $("#m-saida");
  ok(!saida.hidden);
  ok(saida.querySelector(".convite"), "deveria mostrar convite");
  ok(!/R\$\s?\d/.test(saida.textContent), "NÃO pode exibir valor sem calibração: " + saida.textContent.slice(0, 120));
});

teste("município inexistente é avisado com o nome digitado", () => {
  const campo = $("#m-cidade");
  campo.dataset.slug = "";
  digitar(campo, "Curitiba");
  tecla(campo, "Escape");
  $("#m-area").value = "1000";
  $("#m-botao").click();
  ok($("#m-saida").textContent.includes("Curitiba"));
});

teste("área ausente é cobrada antes de estimar", () => {
  const campo = $("#m-cidade");
  digitar(campo, "campin"); tecla(campo, "ArrowDown"); tecla(campo, "Enter");
  $("#m-area").value = "";
  $("#m-botao").click();
  ok($("#m-saida").textContent.toLowerCase().includes("metragem"));
});

teste("com calibração, exibe faixa e aplica elasticidade de área", () => {
  window.CALIBRACAO.MERCADO["campinas"] = { "area-industrial": [820, 15000] };
  const campo = $("#m-cidade");
  digitar(campo, "campin"); tecla(campo, "ArrowDown"); tecla(campo, "Enter");
  $("#m-tipo").value = "area-industrial";
  $("#m-area").value = "18400";
  $("#m-botao").click();
  const txt = $("#m-saida").textContent;
  ok(/R\$/.test(txt), "faixa não apareceu");
  const unit = 820 * Math.pow(18400 / 15000, -0.22);
  ok(unit < 820, "elasticidade não aplicada: imóvel maior deveria ter R$/m² menor");
  const esperado = "R$ " + Math.round(unit).toLocaleString("pt-BR");
  ok(txt.includes(esperado), `esperado ${esperado} no texto`);
  delete window.CALIBRACAO.MERCADO["campinas"];
});

// ---------------- formulário ----------------

teste("nome vazio bloqueia o envio", () => {
  $("#f-nome").value = "";
  $("#f-enviar").click();
  ok($("#f-erro").classList.contains("visivel"));
  ok($("#f-erro").textContent.toLowerCase().includes("nome"));
});

teste("sem telefone nem e-mail bloqueia", () => {
  $("#f-nome").value = "Eduardo M.";
  $("#f-tel").value = ""; $("#f-email").value = "";
  $("#f-enviar").click();
  ok($("#f-erro").textContent.toLowerCase().includes("telefone"));
});

teste("e-mail malformado bloqueia", () => {
  $("#f-nome").value = "Eduardo M.";
  $("#f-email").value = "eduardo@";
  $("#f-enviar").click();
  ok($("#f-erro").textContent.toLowerCase().includes("mail"));
});

teste("sem autorização de contato bloqueia — exigência de LGPD", () => {
  $("#f-nome").value = "Eduardo M.";
  $("#f-email").value = "eduardo@exemplo.com.br";
  $("#f-ok").checked = false;
  $("#f-enviar").click();
  ok($("#f-erro").textContent.toLowerCase().includes("autorização"));
});

teste("dados válidos mostram o recibo", () => {
  $("#f-nome").value = "Eduardo M.";
  $("#f-tel").value = "(19) 99999-0000";
  $("#f-ok").checked = true;
  $("#f-enviar").click();
  ok($("#f-recibo").classList.contains("visivel"), "recibo não apareceu");
  igual($("#form-campos").style.display, "none");
});

// ---------------- execução ----------------

for (const [nome, fn] of testes) {
  try { fn(); passou++; console.log("  ok    " + nome); }
  catch (e) { falhou++; console.log("  FALHA " + nome + "\n          " + e.message); }
}
console.log(`\n${passou} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
