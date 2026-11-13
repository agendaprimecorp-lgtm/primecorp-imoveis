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
["assets/municipios-br.js", "assets/contato.js", "assets/carteira.js", "assets/calibracao.js"].forEach(rel => {
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

  console.log("\n=== 3. elasticidade cobre toda tipologia ===");
  const C = w.CALIBRACAO || {};
  const semElast = TIPOS.filter(t => (C.ELASTICIDADE || {})[t.slug] === undefined).map(t => t.slug);
  ok("ELASTICIDADE cobre os 17 tipos", semElast.length === 0, semElast.join(","));

  console.log("\n=== 4. seletores preenchidos ===");
  ["m-tipo","c-tipo","v-tipo","fl-tipo"].forEach(id => {
    const n = d.getElementById(id);
    ok(id + " tem optgroups", n && n.querySelectorAll("optgroup").length >= 4,
       n ? n.querySelectorAll("optgroup").length : "ausente");
  });

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

  console.log("\n=== 6. combobox de cidade ===");
  function digitar(id, texto) {
    const c = d.getElementById(id);
    c.value = texto;
    c.dispatchEvent(new w.Event("input", {bubbles:true}));
    return d.getElementById(id + "-lista");
  }
  let lista = digitar("m-cidade", "campin");
  const itens = [...lista.querySelectorAll("li[data-i]")].map(li => li.textContent.replace(/\s+/g," ").trim());
  ok("'campin' sugere algo", itens.length > 0, itens.length);
  ok("Campinas vem primeiro", /^Campinas/.test(itens[0] || ""), itens[0]);
  ok("sugestão mostra a UF", /SP/.test(itens[0] || ""), itens[0]);

  lista = digitar("m-cidade", "sao paul");
  const primeiros = [...lista.querySelectorAll("li[data-i]")].map(li => ({
    nome: li.querySelector("span:first-child").textContent.trim(),
    uf: li.querySelector(".uf").textContent.trim()
  }));
  ok("'sao paul' sem acento acha São Paulo",
     primeiros.some(x => x.nome === "São Paulo" && x.uf === "SP"), JSON.stringify(primeiros[0]));
  ok("capital antes de homônimo",
     primeiros[0] && primeiros[0].nome === "São Paulo" && primeiros[0].uf === "SP", JSON.stringify(primeiros[0]));

  lista = digitar("m-cidade", "agua boa");
  const homonimos = [...lista.querySelectorAll("li[data-i]")];
  ok("homônimo lista mais de uma UF", new Set(homonimos.map(li => li.querySelector(".uf").textContent)).size > 1,
     homonimos.map(li => li.querySelector(".uf").textContent).join(","));

  lista = digitar("m-cidade", "zzzqqq");
  ok("termo sem resultado avisa", lista.querySelector("li.vazio") !== null);

  // escolha por clique registra slug
  digitar("m-cidade", "campinas");
  const alvo = d.getElementById("m-cidade-lista").querySelector("li[data-i]");
  alvo.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  const campoM = d.getElementById("m-cidade");
  ok("clique preenche Nome/UF", campoM.value === "Campinas/SP", campoM.value);
  ok("clique registra slug", campoM.dataset.slug === "campinas-sp", campoM.dataset.slug);

  console.log("\n=== 7. consulta de faixa ===");
  function consultar(tipo, cidade, area) {
    d.getElementById("m-tipo").value = tipo;
    const c = d.getElementById("m-cidade");
    c.value = cidade.nome; c.dataset.slug = cidade.slug; c.dataset.cidade = cidade.nomeSo;
    d.getElementById("m-area").value = area;
    d.getElementById("m-botao").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
    return d.getElementById("m-saida");
  }
  let saida = consultar("galpao", {nome:"Campinas/SP", slug:"campinas-sp", nomeSo:"Campinas"}, 6000);
  ok("município sem calibração convida ao parecer",
     saida.querySelector(".convite") !== null && !/R\$/.test(saida.querySelector(".convite b").textContent));
  ok("convite tem CTA para avaliação", saida.querySelector("#conv-cta") !== null);

  // sem slug (digitou e não escolheu) → não deve calcular
  d.getElementById("m-cidade").dataset.slug = "";
  d.getElementById("m-botao").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  ok("cidade não escolhida na lista não calcula",
     d.getElementById("m-saida").querySelector(".convite") !== null);

  // com calibração injetada: deve calcular
  w.CALIBRACAO.MERCADO = {"campinas-sp": {"galpao": [1850, 5000]}};
  saida = consultar("galpao", {nome:"Campinas/SP", slug:"campinas-sp", nomeSo:"Campinas"}, 6000);
  ok("com calibração mostra três valores", saida.querySelectorAll(".tres b").length === 3);
  const ref = saida.querySelector(".tres .meio b").textContent;
  ok("valor de referência é número em reais", /^R\$ [\d.]+$/.test(ref), ref);
  // 6000 m² com elasticidade negativa → R$/m² abaixo de 1850
  const unit = Number((saida.querySelector(".nota code").textContent.match(/[\d.]+/)||[0])[0].replace(/\./g,""));
  ok("elasticidade reduz R$/m² em área maior", unit > 0 && unit < 1850, unit);

  console.log("\n=== 8. vitrine e filtros ===");
  const vitrine = d.getElementById("vitrine-lista");
  ok("vitrine renderizou os imóveis", vitrine.querySelectorAll("article.imovel").length === IMOVEIS.length,
     vitrine.querySelectorAll("article.imovel").length);

  function filtrar(sets) {
    Object.entries(sets).forEach(([id, v]) => {
      const n = d.getElementById(id);
      n.value = v;
      n.dispatchEvent(new w.Event("change", {bubbles:true}));
    });
    return d.getElementById("vitrine-lista").querySelectorAll("article.imovel").length;
  }
  function limpar(){ d.getElementById("fl-limpar").dispatchEvent(new w.MouseEvent("click", {bubbles:true})); }

  limpar();
  ok("filtro por tipo galpão devolve 1", filtrar({"fl-tipo":"galpao"}) === 1);
  const extras = [...d.getElementById("fl-extras").querySelectorAll("select")].map(s => s.dataset.campo);
  ok("galpão oferece pé-direito e docas", extras.includes("pedireito") && extras.includes("docas"), extras.join(","));
  ok("galpão NÃO oferece quartos", !extras.includes("quartos"), extras.join(","));

  // pé-direito 10 m: o galpão tem 11 → passa; 12 → não passa
  let fx = d.getElementById("fx-pedireito");
  fx.value = "10"; fx.dispatchEvent(new w.Event("change", {bubbles:true}));
  ok("pé-direito 10m mantém o galpão de 11m", vitrine.querySelectorAll("article.imovel").length === 1);
  fx.value = "12"; fx.dispatchEvent(new w.Event("change", {bubbles:true}));
  ok("pé-direito 12m exclui o galpão de 11m", vitrine.querySelectorAll("article.imovel").length === 0);
  ok("vazio oferece mandato de busca", vitrine.querySelector("#vazio-cta") !== null);

  // CTA do vazio leva filtros para a busca
  limpar();
  filtrar({"fl-tipo":"galpao", "fl-area-min":"20000"});
  ok("filtro impossível zera a vitrine", vitrine.querySelectorAll("article.imovel").length === 0);
  vitrine.querySelector("#vazio-cta").dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
  ok("CTA abre o painel de compra", !d.getElementById("pp-comprar").hidden);
  ok("CTA pré-preenche o tipo", d.getElementById("c-tipo").value === "galpao", d.getElementById("c-tipo").value);
  ok("CTA pré-preenche a área", d.getElementById("c-area").value === "20000", d.getElementById("c-area").value);

  limpar();
  ok("limpar restaura a vitrine", vitrine.querySelectorAll("article.imovel").length === IMOVEIS.length);

  // preço
  ok("preço até 3 mi devolve só o terreno", filtrar({"fl-preco-max":"3000000"}) === 1);
  limpar();

  // cidade pelo combo do filtro
  digitar("fl-cidade", "jundia");
  ok("filtro por cidade digitada funciona", vitrine.querySelectorAll("article.imovel").length === 1,
     vitrine.querySelectorAll("article.imovel").length);
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
  ok("não sobrou 'Estado de São Paulo'", !/Estado de São Paulo/.test(html));
  ok("marca horizontal no cabeçalho", /marca-horizontal-600\.png/.test(html));
  ok("marca negativa no rodapé", /marca-horizontal-negativa-600\.png/.test(html));
  ok("vermelho da marca #d5383a", /#d5383a/.test(html) && !/#DB1D25|#db1d25/.test(html));
  ok("CRECI dos dois corretores no rodapé", /300760/.test(html) && /297692/.test(html));
  ok("cita Decreto 81.871/1978", /81\.871/.test(html));
  ok("cita Resolução 327/1992 para fora de SP", /327\/1992/.test(html));
  ok("declara PJ em concessão", /concess/i.test(html));
  ok("ressalva de que a faixa não é parecer", /não constitui parecer/i.test(html));
  ok("nenhuma menção a locação como serviço", !/alug|loca(ç|c)ão de im/i.test(html.replace(/não operamos locação/g,"")));

  const semAlt = [...d.querySelectorAll("img")].filter(i => !i.getAttribute("alt"));
  ok("toda imagem tem alt", semAlt.length === 0, semAlt.length);
  const semLabel = [...d.querySelectorAll("input:not([type=checkbox]), select, textarea")]
    .filter(c => c.id && !d.querySelector(`label[for="${c.id}"]`));
  ok("todo campo tem label", semLabel.length === 0, semLabel.map(c=>c.id).join(","));
  ok("mapa do Brasil renderizou 27 UFs", d.querySelectorAll(".mapa-br .uf").length === 27,
     d.querySelectorAll(".mapa-br .uf").length);
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
  ok("mensagem leva a finalidade", /Avaliar meu imóvel/.test(corpo), corpo.split("\n")[0]);
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
  ok("rodapé informa canal de direitos do titular", /direitos de titular/i.test(htm));
  ok("cita a Lei 13.709 (LGPD)", /13\.709/.test(htm));
  ok("cita prazo de resposta", /15 dias/.test(htm));
  ok("telefone no schema.org", /\+55-19-99919-4447/.test(htm));
  ok("sem telefone antigo remanescente", !/99805-1985|98110-5192/.test(htm));

  console.log("\n=== 16. console da página ===");
  const reais = errosPagina.filter(m => !/Could not load|Not implemented|css/i.test(m));
  ok("sem erro de execução", reais.length === 0, reais.slice(0,3).join(" | "));

  console.log(`\n${passes} passaram, ${falhas} falharam\n`);
  process.exit(falhas ? 1 : 0);
}, 60);
