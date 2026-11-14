/* Varredura do index.html em DOM real. Verifica o que a vista não mostra:
   taxonomia consistente, filtros que não zeram a vitrine sem motivo,
   combobox com base nacional, portas da capa, consulta de faixa. */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const DIR = path.join(__dirname, "..", "web");
let falhas = 0, passes = 0;
function ok(nome, cond, detalhe) {
  if (cond) { passes++; console.log("  ok   " + nome); }
  else { falhas++; console.log("  FALHA " + nome + (detalhe ? " — " + detalhe : "")); }
}

const vc = new VirtualConsole();
const errosPagina = [];
vc.on("jsdomError", e => errosPagina.push(e.message));
vc.on("error", (...a) => errosPagina.push(a.join(" ")));

/* jsdom não resolve os <script src> relativos sem rede: embutimos os dois
   arquivos locais no lugar das tags, preservando a ordem de execução. */
let fonte = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
["assets/municipios-br.js", "assets/contato.js", "assets/carteira.js"].forEach(rel => {
  const tag = `<script src="${rel}"></script>`;
  if (!fonte.includes(tag)) { console.log("  FALHA tag ausente: " + tag); falhas++; return; }
  fonte = fonte.replace(tag, "<script>" + fs.readFileSync(path.join(DIR, rel), "utf8") + "</scr" + "ipt>");
});

const dom = new JSDOM(fonte, {
  runScripts: "dangerously", url: "https://www.primecorpimoveis.com.br/",
  virtualConsole: vc, pretendToBeVisual: true
});
const w = dom.window, d = w.document;

setTimeout(() => {
  console.log("\n=== 1. base de municípios ===");
  const base = w.MUNICIPIOS_BR;
  ok("MUNICIPIOS_BR carregou", Array.isArray(base) && base.length > 5000, base ? base.length : "undefined");
  if (Array.isArray(base)) {
    ok("todas as 27 UFs", new Set(base.map(m => m[1])).size === 27, new Set(base.map(m=>m[1])).size);
    ok("slugs únicos", new Set(base.map(m => m[2])).size === base.length);
    ok("São Paulo/SP presente", base.some(m => m[0] === "São Paulo" && m[1] === "SP"));
    ok("Campinas/SP presente", base.some(m => m[0] === "Campinas" && m[1] === "SP"));
    ok("Manaus/AM presente", base.some(m => m[0] === "Manaus" && m[1] === "AM"));
    ok("27 capitais marcadas", base.filter(m => m[3] === 1).length === 27, base.filter(m=>m[3]===1).length);
  }

  console.log("\n=== 2. taxonomia única ===");
  const TIPOS = w.TIPOS, CAMPOS = w.CAMPOS, IMOVEIS = w.IMOVEIS;
  ok("TIPOS existe", Array.isArray(TIPOS) && TIPOS.length >= 17, TIPOS && TIPOS.length);
  if (!Array.isArray(TIPOS)) { console.log("\nsem TIPOS, abortando\n"); process.exit(1); }
  const slugs = new Set(TIPOS.map(t => t.slug));
  ok("slugs de tipo únicos", slugs.size === TIPOS.length);
  const camposDeclarados = new Set(TIPOS.flatMap(t => t.campos));
  const semDefinicao = [...camposDeclarados].filter(c => !CAMPOS[c]);
  ok("todo campo declarado tem definição em CAMPOS", semDefinicao.length === 0, semDefinicao.join(","));
  const tiposOrfaos = IMOVEIS.filter(im => !slugs.has(im.tipo)).map(im => im.tipo);
  ok("todo imóvel usa um slug de TIPOS", tiposOrfaos.length === 0, tiposOrfaos.join(","));

  console.log("\n=== 3. referências estáveis ===");
  const semRef = IMOVEIS.filter(im => !im.ref).map(im => im.titulo);
  ok("todo imóvel tem código próprio", semRef.length === 0, semRef.join(","));
  ok("códigos únicos", new Set(IMOVEIS.map(im => im.ref)).size === IMOVEIS.length);
  const semDesc = IMOVEIS.filter(im => !im.descricao).length;
  ok("todo imóvel tem descrição", semDesc === 0, semDesc);

  console.log("\n=== 4. seletores preenchidos ===");
  ["c-tipo","v-tipo"].forEach(id => {
    const n = d.getElementById(id);
    ok(id + " tem optgroups", n && n.querySelectorAll("optgroup").length >= 4,
       n ? n.querySelectorAll("optgroup").length : "ausente");
  });
  ok("dropdown de tipo lista os grupos",
     d.querySelectorAll("#fl-tipo-grupos .tg-nome").length === new Set(TIPOS.map(t=>t.grupo)).size,
     d.querySelectorAll("#fl-tipo-grupos .tg-nome").length);
  ok("abre sem tipo marcado", JSON.stringify(w.tiposMarcados()) === "[]", JSON.stringify(w.tiposMarcados()));

  console.log("\n=== 5. portas da capa ===");
  ok("pp-comprar começa fechado", d.getElementById("pp-comprar").hidden);
  ok("pp-vender começa fechado", d.getElementById("pp-vender").hidden);
  d.getElementById("porta-comprar").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  ok("clique abre pp-comprar", !d.getElementById("pp-comprar").hidden);
  ok("porta-comprar marcada", d.getElementById("porta-comprar").getAttribute("aria-selected") === "true");
  d.getElementById("porta-vender").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  ok("abrir vender fecha comprar", d.getElementById("pp-comprar").hidden && !d.getElementById("pp-vender").hidden);
  d.querySelector("[data-fechar]").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  ok("botão fechar fecha as duas", d.getElementById("pp-comprar").hidden && d.getElementById("pp-vender").hidden);

  console.log("\n=== 6. capa limpa ===");
  ok("busca simples removida da capa", d.getElementById("busca-capa") === null);
  ok("carteira ao vivo removida", d.querySelector(".capa-painel") === null);
  ok("sem o texto 'Ver a carteira'", !/Ver a carteira/.test(d.body.textContent));
  ok("sem grade de caminhos na capa", d.querySelector(".escolhas") === null);
  ok("sem faixa de credenciais na capa", d.querySelector(".credenciais") === null);
  ok("título de dois lados, sem segmento único", /negocia os dois lados/.test(d.querySelector(".capa h1").textContent), d.querySelector(".capa h1").textContent);
  ok("capa não cita a cidade no título", !/São Paulo/.test(d.querySelector(".capa h1").textContent));
  ok("sem 'São Paulo' na chamada da capa", !/São Paulo/.test(d.querySelector(".capa").textContent));
  const ctas = [...d.querySelectorAll('.capa-portas a')].map(a => a.textContent.trim());
  ok("dois CTAs: Buscar imóveis e Quero vender", ctas.length === 2 && ctas[0] === "Buscar imóveis" && ctas[1] === "Quero vender meu imóvel", ctas.join(" | "));
  ok("duas portas: comprador e vendedor", d.querySelectorAll(".capa-porta").length === 2);
  ok("símbolo Propto como marca d'água", d.querySelector(".capa-simbolo img") !== null &&
     /propto-simbolo\.svg/.test(d.querySelector(".capa-simbolo img").getAttribute("src")));
  ok("símbolo fica fora da leitura", d.querySelector(".capa-simbolo").getAttribute("aria-hidden") === "true");
  ok("carteira abre com título curto", d.querySelector("#carteira h2").textContent === "Imóveis à venda");
  ok("carteira sem texto explicativo", d.querySelector("#carteira .cab p") === null);
  ok("sem atalhos na carteira", d.querySelector("#carteira .atalhos") === null);

  ok("sem parágrafo de autorização na capa", d.querySelector(".capa .lead") === null);
  ok("eyebrow diz só Compra e venda", d.querySelector(".capa .olho").textContent.trim() === "Compra e venda");
  ok("'sem locação' fora da capa", !/sem locação/i.test(d.querySelector(".capa").textContent));
  ok("link de WhatsApp na capa aponta para wa.me", /^https:\/\/wa\.me\//.test(d.getElementById("capa-zap").href), d.getElementById("capa-zap").href);
  ok("destaques existem na home", d.getElementById("destaques-lista") !== null);
  ok("destaques mostram até 3 imóveis", d.querySelectorAll("#destaques-lista article.imovel").length === Math.min(3, w.IMOVEIS.length),
     d.querySelectorAll("#destaques-lista article.imovel").length);
  ok("destaque abre a ficha", (() => { const c = d.querySelector("#destaques-lista article.imovel"); if (!c) return false; c.dispatchEvent(new w.MouseEvent("click", {bubbles:true})); return d.getElementById("ficha-veu").classList.contains("aberta") || d.getElementById("ficha-veu").hidden === false || d.getElementById("ficha") !== null; })());
  d.dispatchEvent(new w.KeyboardEvent("keydown", {key:"Escape", bubbles:true}));

  console.log("\n=== 6b. segmentos com peso igual ===");
  const cartoesSeg = [...d.querySelectorAll(".seg-card")];
  ok("seis cartões de segmento", cartoesSeg.length === 6, cartoesSeg.length);
  const segs = cartoesSeg.filter(c => c.dataset.grupo).map(c => c.dataset.grupo);
  ok("seis cartões apontam para grupos reais", segs.length === 6 && segs.every(g => TIPOS.some(t => t.grupo === g)), segs.join(","));
  ok("cartões com ícone", cartoesSeg.every(c => c.querySelector("svg") !== null));
  d.querySelector('.seg-card[data-grupo="Rural"]').dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  ok("clicar no cartão Rural não marca tipo nenhum (escolha é do cliente)", w.tiposMarcados().length === 0, w.tiposMarcados().join());
  d.getElementById("fl-limpar").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));

  console.log("\n=== 8. vitrine e filtros padrão ZAP ===");
  const vitrine = d.getElementById("vitrine-lista");
  const conta = () => vitrine.querySelectorAll("article.imovel").length;
  /* "Limpar" volta ao ponto de partida: nada escolhido, carteira fechada. */
  const limpar = () => { d.getElementById("fl-limpar").dispatchEvent(new w.MouseEvent("click", {bubbles:true})); w.marcarTipos([]); w.montarExtras(); w.atualizar(); };
  function por(sets){
    Object.entries(sets).forEach(([id, v]) => {
      if (id === "fl-tipo" || id === "fl-grupo") {
        w.marcarTipos(id === "fl-tipo" ? [v] : TIPOS.filter(t => t.grupo === v).map(t => t.slug));
        w.montarExtras(); w.atualizar(); return;
      }
      const n = d.getElementById(id);
      n.value = v;
      n.dispatchEvent(new w.Event(n.tagName === "SELECT" ? "change" : "input", {bubbles:true}));
    });
    return conta();
  }

  limpar();
  ok("sem escolha, a carteira não aparece", conta() === 0, conta());

  // --- contagem ANTES de aplicar: o detalhe que o ZAP acerta ---
  const botao = d.getElementById("fl-buscar");
  ok("botão começa como Buscar", botao.textContent === "Buscar", botao.textContent);
  por({"fl-tipo":"galpao"});
  ok("botão atualiza a contagem", /Ver 1 imóvel$/.test(botao.textContent), botao.textContent);
  ok("filtro por tipo devolve 1", conta() === 1);
  por({"fl-area-min":"99999"});
  ok("zero resultados mostra Buscar", botao.textContent === "Buscar", botao.textContent);
  ok("botão continua clicável em zero", botao.disabled === false);
  limpar();
  ok("limpar reabilita o botão e fecha a carteira", botao.disabled === false && conta() === 0);

  // --- segmento filtra o seletor de tipo ---
  por({"fl-grupo":"Industrial e logístico"});
  const marcados = w.tiposMarcados();
  ok("segmento marca só os tipos do segmento",
     marcados.length > 0 && marcados.every(sl => (TIPOS.find(t=>t.slug===sl)||{}).grupo === "Industrial e logístico"), marcados.join(","));
  ok("segmento industrial devolve 2", conta() === 2, conta());
  limpar();

  // --- faixas: mínimo e máximo ---
  ok("preço mínimo de 5 mi devolve 2", por({"fl-preco-min":"5000000"}) === 2);
  limpar();
  ok("preço máximo de 3 mi devolve 1", por({"fl-preco-max":"3000000"}) === 1);
  limpar();
  ok("faixa de 5 a 10 mi devolve 1", por({"fl-preco-min":"5000000","fl-preco-max":"10000000"}) === 1);
  limpar();
  ok("área máxima de 7.000 devolve 2", por({"fl-area-max":"7000"}) === 2, conta());
  limpar();
  ok("faixa de área 5.000 a 7.000 devolve 1", por({"fl-area-min":"5000","fl-area-max":"7000"}) === 1);
  limpar();

  // --- busca por código ---
  ok("código completo acha 1", por({"fl-codigo":"GA-JUN-002"}) === 1);
  ok("código parcial funciona", por({"fl-codigo":"GA-"}) === 1);
  ok("código inexistente devolve 0", por({"fl-codigo":"ZZ-000"}) === 0);
  limpar();

  // --- ordenação ---
  function precos(){ return [...vitrine.querySelectorAll(".preco")].map(e =>
    Number(e.textContent.replace(/\D/g,""))); }
  por({"fl-grupo":"Industrial e logístico"});
  por({"fl-ordem":"preco-asc"});
  const asc = precos();
  ok("menor preço ordena crescente", asc.every((v,i) => i === 0 || asc[i-1] <= v), asc.join(","));
  por({"fl-ordem":"preco-desc"});
  const desc = precos();
  ok("maior preço ordena decrescente", desc.every((v,i) => i === 0 || desc[i-1] >= v), desc.join(","));
  por({"fl-ordem":"area-desc"});
  ok("maior área traz a área industrial primeiro",
     /18\.400/.test(vitrine.querySelector("article.imovel").textContent));
  por({"fl-ordem":"m2-asc"});
  ok("menor R$/m² traz a área industrial primeiro",
     /18\.400/.test(vitrine.querySelector("article.imovel").textContent));
  limpar();

  // --- características adaptativas ---
  por({"fl-tipo":"galpao"});
  const atrib = [...d.getElementById("fl-atribs-campos").querySelectorAll("select")].map(x => x.dataset.campo);
  ok("galpão oferece pé-direito e docas", atrib.includes("pedireito") && atrib.includes("docas"), atrib.join(","));
  ok("galpão NÃO oferece quartos", !atrib.includes("quartos"), atrib.join(","));
  let fx = d.getElementById("fx-pedireito");
  fx.value = "10"; fx.dispatchEvent(new w.Event("change", {bubbles:true}));
  ok("pé-direito 10m mantém o galpão de 11m", conta() === 1);
  fx.value = "12"; fx.dispatchEvent(new w.Event("change", {bubbles:true}));
  ok("pé-direito 12m exclui o galpão de 11m", conta() === 0);
  ok("vazio oferece encomenda de busca", vitrine.querySelector("#vazio-cta") !== null);
  ok("vazio com filtro oferece limpar", vitrine.querySelector("#vazio-limpar") !== null);
  limpar();
  ok("característica some ao limpar", d.getElementById("fx-pedireito") === null ||
     d.getElementById("fx-pedireito").value === "");

  // --- etiquetas de filtro ativo ---
  limpar();
  ok("sem filtro, diz que não há filtro",
     /nenhum filtro/.test(d.getElementById("fl-etiquetas").textContent));
  por({"fl-tipo":"galpao","fl-preco-max":"10000000"});
  let etqs = [...d.getElementById("fl-etiquetas").querySelectorAll(".etiqueta")];
  ok("duas etiquetas para dois filtros", etqs.length === 2, etqs.length);
  ok("etiqueta mostra o nome do tipo", /Galpão/.test(etqs[0].textContent), etqs[0].textContent);
  ok("etiqueta mostra o teto de preço", /até R\$/.test(etqs[1].textContent), etqs[1].textContent);
  etqs[1].querySelector("button").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  ok("remover etiqueta limpa aquele filtro", d.getElementById("fl-preco-max").value === "");
  ok("o outro filtro permanece", JSON.stringify(w.tiposMarcados()) === '["galpao"]');
  ok("sobra uma etiqueta", d.getElementById("fl-etiquetas").querySelectorAll(".etiqueta").length === 1);
  limpar();

  // --- painel de filtros abre e fecha ---
  const mais = d.getElementById("fl-mais"), extras = d.getElementById("fl-extras");
  ok("painel começa fechado", !extras.classList.contains("aberto"));
  mais.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  ok("clique abre o painel", extras.classList.contains("aberto") && mais.getAttribute("aria-expanded") === "true");
  mais.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  ok("clique fecha o painel", !extras.classList.contains("aberto"));

  // --- CTA do vazio leva os filtros para a encomenda ---
  por({"fl-tipo":"galpao","fl-area-min":"20000"});
  ok("filtro impossível zera a vitrine", conta() === 0);
  vitrine.querySelector("#vazio-cta").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  ok("CTA abre a porta de encomenda", !d.getElementById("pp-comprar").hidden);
  ok("CTA pré-preenche o tipo", d.getElementById("c-tipo").value === "galpao");
  ok("CTA pré-preenche a área", d.getElementById("c-area").value === "20000");
  limpar();

  console.log("\n=== 9. formulários ===");
  function enviar(pref, dados) {
    Object.entries(dados).forEach(([id, v]) => {
      const n = d.getElementById(id);
      if (n.type === "checkbox") n.checked = v; else n.value = v;
    });
    d.getElementById(pref + "-enviar").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  }
  enviar("c", {"c-nome":"", "c-tel":"", "c-ok":false});
  ok("nome vazio é recusado", d.getElementById("c-erro").classList.contains("ok"));
  enviar("c", {"c-nome":"Rodrigo Viana", "c-tel":"123", "c-ok":false});
  ok("telefone curto é recusado", /WhatsApp/.test(d.getElementById("c-erro").textContent));
  enviar("c", {"c-nome":"Rodrigo Viana", "c-tel":"19999887766", "c-ok":false});
  ok("sem consentimento é recusado", /autoriza/i.test(d.getElementById("c-erro").textContent));
  enviar("c", {"c-nome":"Rodrigo Viana", "c-tel":"19999887766", "c-ok":true});
  ok("com tudo preenchido mostra recibo", d.getElementById("c-recibo").classList.contains("ok"));

  enviar("v", {"v-nome":"Joselia Viana", "v-tel":"19988776655", "v-ok":true});
  ok("formulário de venda também conclui", d.getElementById("v-recibo").classList.contains("ok"));

  console.log("\n=== 10. identidade, acessibilidade e conformidade ===");
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  ok("não sobrou referência a municipios-sp.js", !/municipios-sp\.js/.test(html));
  ok("não sobrou 'todo o Brasil'", !/todo o Brasil/i.test(html));
  ok("marca do cabeçalho com símbolo e tipografia", /marca-simbolo-128\.png/.test(html) && /class="marca-txt"/.test(html));
  ok("marca negativa no rodapé", /marca-horizontal-negativa-600\.png/.test(html));
  ok("vermelho da marca #d5383a", /#d5383a/.test(html) && !/#DB1D25|#db1d25/.test(html));
  ok("rodapé traz razão social e CNPJ", /PRIMECORP BROKERS CONSULTORIA E INTERMEDIAÇÃO DE NEGÓCIOS LTDA/.test(html) && /55\.745\.297\/0001-06/.test(html));
  ok("nomes e CRECI pessoais fora do site", !/Joselia|Rodrigo França|CRECISP 300760|CRECISP 297692/.test(html));
  ok("cita Decreto 81.871/1978", /81\.871/.test(html));
  ok("sem ressalva de jurisdição no rodapé (escopo é SP)", !/327\/1992/.test(html));
  ok("sem texto sobre processo de concessão no site", !/concess/i.test(html));
  ok("sem parecer de avaliação no rodapé", !/mediante contratação/i.test(html));
  ok("site não promete avaliação gratuita", !/avaliação gratuita/i.test(html));
  ok("nenhuma menção a locação como serviço", !/alug|loca(ç|c)ão de im/i.test(html.replace(/não operamos locação/g,"")));

  const semAlt = [...d.querySelectorAll("img")].filter(i => i.getAttribute("alt") === null || (i.getAttribute("alt") === "" && i.getAttribute("aria-hidden") !== "true"));
  ok("toda imagem tem alt", semAlt.length === 0, semAlt.length);
  const semLabel = [...d.querySelectorAll("input:not([type=checkbox]), select, textarea")]
    .filter(c => c.id && !d.querySelector(`label[for="${c.id}"]`) && !c.getAttribute("aria-label"));
  ok("todo campo tem label", semLabel.length === 0, semLabel.map(c=>c.id).join(","));
  ok("mapa do Brasil removido (escopo SP)", d.querySelectorAll(".mapa-br").length === 0);
  ok("um único h1", d.querySelectorAll("h1").length === 1, d.querySelectorAll("h1").length);
  ok("link de pular para o conteúdo", d.querySelector(".pular") !== null);

  console.log("\n=== 11. menu móvel ===");
  const btn = d.getElementById("abrir-menu"), nav = d.getElementById("menu-principal"), veu = d.getElementById("veu-menu");
  ok("hambúrguer existe", btn !== null);
  ok("hambúrguer controla o menu", btn.getAttribute("aria-controls") === "menu-principal");
  ok("menu começa fechado", btn.getAttribute("aria-expanded") === "false" && !nav.classList.contains("aberto"));
  btn.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  ok("clique abre o menu", btn.getAttribute("aria-expanded") === "true" && nav.classList.contains("aberto"));
  ok("véu aparece com o menu", veu.classList.contains("aberto") && !veu.hidden);
  nav.querySelector("a").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  ok("clicar num item fecha o menu", btn.getAttribute("aria-expanded") === "false");
  btn.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  veu.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  ok("clicar no véu fecha o menu", btn.getAttribute("aria-expanded") === "false");
  btn.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  d.dispatchEvent(new w.KeyboardEvent("keydown", {key:"Escape", bubbles:true}));
  ok("Esc fecha o menu", btn.getAttribute("aria-expanded") === "false");

  console.log("\n=== 12. ficha do imóvel ===");
  limpar();
  por({"fl-grupo":"Industrial e logístico"});
  const cartoes = [...vitrine.querySelectorAll("article.imovel")];
  ok("cartão é acionável", cartoes[0].getAttribute("role") === "button" && cartoes[0].tabIndex === 0);
  ok("cartão carrega a referência", /^[A-Z]{2}-[A-Z]{3}-\d{3}$/.test(cartoes[0].dataset.ref), cartoes[0].dataset.ref);
  const refGalpao = cartoes.find(c => /GA-JUN/.test(c.dataset.ref)).dataset.ref;

  cartoes[0].dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  const fichaVeu = d.getElementById("ficha-veu");
  ok("clique abre a ficha", fichaVeu.classList.contains("aberta"));
  ok("ficha tem título", d.getElementById("ficha-titulo") !== null);
  ok("ficha mostra a referência", /AI-CPQ-001/.test(d.getElementById("ficha").textContent));
  ok("ficha mostra a descrição", d.querySelector(".ficha p.desc") !== null);
  ok("ficha cita o CRECI do anúncio", /CRECISP 300760/.test(d.getElementById("ficha").textContent));
  ok("ficha cita o Decreto 81.871", /81\.871/.test(d.querySelector(".ficha-legal").textContent));
  ok("ficha expõe os atributos do tipo", /Zoneamento/.test(d.querySelector(".ficha-grade").textContent));
  ok("ficha calcula valor por m²", /Valor por m²/.test(d.querySelector(".ficha-grade").textContent));
  ok("URL ganha endereço próprio", w.location.hash === "#imovel/AI-CPQ-001", w.location.hash);
  ok("rolagem de fundo travada", d.body.style.overflow === "hidden");

  d.dispatchEvent(new w.KeyboardEvent("keydown", {key:"Escape", bubbles:true}));
  ok("Esc fecha a ficha", !fichaVeu.classList.contains("aberta"));
  ok("rolagem liberada", d.body.style.overflow === "");
  ok("URL volta ao normal", !w.location.hash.startsWith("#imovel/"), w.location.hash);

  // teclado: Enter no cartão
  cartoes[1].dispatchEvent(new w.KeyboardEvent("keydown", {key:"Enter", bubbles:true}));
  ok("Enter no cartão abre a ficha", fichaVeu.classList.contains("aberta"));
  ok("abriu o imóvel certo", /GA-JUN-002/.test(d.getElementById("ficha").textContent));

  // CTA de interesse leva o imóvel ao formulário
  d.getElementById("ficha-interesse").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  ok("interesse fecha a ficha", !fichaVeu.classList.contains("aberta"));
  ok("interesse abre a porta de compra", !d.getElementById("pp-comprar").hidden);
  ok("interesse leva o tipo", d.getElementById("c-tipo").value === "galpao", d.getElementById("c-tipo").value);
  ok("interesse leva a cidade", d.getElementById("c-cidade").value === "Jundiaí/SP", d.getElementById("c-cidade").value);
  ok("interesse cita a referência na mensagem", /GA-JUN-002/.test(d.getElementById("c-msg").value), d.getElementById("c-msg").value);

  // abertura por hash (link compartilhado)
  w.location.hash = "#imovel/" + refGalpao;
  w.dispatchEvent(new w.PopStateEvent("popstate"));
  ok("link compartilhado abre a ficha", fichaVeu.classList.contains("aberta"));
  fecharTudo();
  function fecharTudo(){
    if (fichaVeu.classList.contains("aberta"))
      d.dispatchEvent(new w.KeyboardEvent("keydown", {key:"Escape", bubbles:true}));
  }

  console.log("\n=== 13. âncoras e enquadramento ===");
  [...d.querySelectorAll('.menu a[href^="#"]')].forEach(a => {
    const href = a.getAttribute("href");
    ok("âncora " + href + " existe", d.querySelector(href) !== null);
  });
  const sm = /scroll-margin-top:calc\(var\(--hdr\) \+ 16px\)/.test(fs.readFileSync(path.join(DIR,"index.html"),"utf8"));
  ok("seções têm folga para o cabeçalho fixo", sm);

  console.log("\n=== 14. WhatsApp e destino do lead ===");
  const C2 = w.CONTATO;
  ok("telefone configurado", C2.whatsapp === "5519999194447", C2.whatsapp);
  ok("destino padrão não perde lead", C2.destino === "whatsapp" || !!C2.ENDPOINT, C2.destino);
  const zap = d.getElementById("zap");
  ok("botão flutuante existe", zap !== null);
  ok("botão aponta para wa.me", /^https:\/\/wa\.me\/5519999194447\?text=/.test(zap.href), zap.href.slice(0,46));
  ok("botão abre em nova aba com rel seguro", zap.target === "_blank" && /noopener/.test(zap.rel));
  ok("mensagem do botão não é vazia", decodeURIComponent(zap.href.split("text=")[1] || "").length > 25);
  ok("rodapé tem WhatsApp", /wa\.me\/5519999194447/.test(d.getElementById("pe-zap").href));
  ok("rodapé tem telefone clicável", d.querySelector('a[href="tel:+5519999194447"]') !== null);
  ok("rodapé tem os dois e-mails",
     d.querySelector('a[href^="mailto:contato@"]') !== null && d.querySelector('a[href^="mailto:comercial@"]') !== null);

  // o formulário agora abre o WhatsApp em vez de engolir o lead
  let abriu = null;
  w.open = (u) => { abriu = u; return null; };
  d.getElementById("v-campos").style.display = "";
  d.getElementById("v-recibo").classList.remove("ok");
  ["v-nome","v-tel"].forEach(id => d.getElementById(id).value = "");
  enviar("v", {"v-nome":"Teste Proprietário", "v-tel":"19988776655", "v-ok":true,
               "v-tipo":"galpao", "v-area":"4200"});
  ok("envio aciona o WhatsApp", abriu !== null && /wa\.me\/5519999194447/.test(abriu || ""));
  const corpo = decodeURIComponent((abriu||"").split("text=")[1] || "");
  ok("mensagem leva o nome", /Teste Proprietário/.test(corpo));
  ok("mensagem leva o telefone", /19988776655/.test(corpo));
  ok("mensagem leva a finalidade", /Cadastrar imóvel para venda/.test(corpo), corpo.split("\n")[0]);
  ok("mensagem leva a área", /4200|4\.200/.test(corpo));
  ok("recibo aparece mesmo assim", d.getElementById("v-recibo").classList.contains("ok"));

  // ficha tem botão de WhatsApp próprio, com a referência
  cartoes[1].dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  const fz = d.getElementById("ficha-zap");
  ok("ficha tem WhatsApp próprio", fz !== null && /wa\.me\//.test(fz.href));
  ok("WhatsApp da ficha cita a referência",
     /GA-JUN-002/.test(decodeURIComponent(fz.href.split("text=")[1] || "")));
  d.dispatchEvent(new w.KeyboardEvent("keydown", {key:"Escape", bubbles:true}));

  console.log("\n=== 15. LGPD e dados de contato ===");
  const htm = fs.readFileSync(path.join(DIR,"index.html"), "utf8");
  ok("rodapé sem bloco LGPD (pedido do titular)", !/direitos de titular|13\.709|15 dias/i.test(htm));
  ok("telefone no schema.org", /\+55-19-99919-4447/.test(htm));
  ok("sem telefone antigo remanescente", !/99805-1985|98110-5192/.test(htm));

  console.log("\n=== 16. console da página ===");
  const reais = errosPagina.filter(m => !/Could not load|Not implemented|css/i.test(m));
  ok("sem erro de execução", reais.length === 0, reais.slice(0,3).join(" | "));

  console.log(`\n${passes} passaram, ${falhas} falharam\n`);
  process.exit(falhas ? 1 : 0);
}, 60);
