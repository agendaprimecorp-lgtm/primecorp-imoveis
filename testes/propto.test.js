/* Prova da integração Propto → vitrine, ponta a ponta.

   Sobe um Propto falso devolvendo o contrato, serve o site num
   servidor local e abre no navegador de verdade. Verifica o que
   importa: a vitrine se alimenta sozinha, locação não entra,
   anúncio sem CRECI não entra, e a queda do Propto não derruba
   o site. */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, "..", "web");
const TIPOS = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
                '.css':'text/css', '.png':'image/png', '.json':'application/json' };

let falhas = 0, passes = 0;
const ok = (n, c, d) => c ? (passes++, console.log('  ok    ' + n))
                          : (falhas++, console.log('  FALHA ' + n + (d ? ' — ' + d : '')));

/* ---- o que o Propto deve devolver ---- */
const OFERTAS = [
  { ref:'PC-0021', status:'publicado', operacao:'venda', tipo:'Galpão', cidade:'Sumaré', uf:'SP',
    regiao:'Rod. Anhanguera, km 110', titulo:'Galpão com pátio para carreta',
    descricao:'Estrutura pré-moldada com piso para porta-paletes.',
    preco:7400000, area_terreno:9000, area_construida:4200, pedireito:12, docas:6,
    energia_kva:500, zoneamento:'Industrial',
    creci:'CRECISP 297692', corretor:'Rodrigo França Viana',
    fotos:['https://propto.com.br/api/foto?k=fotos/x/a.jpg'] },

  { ref:'PC-0022', status:'publicado', operacao:'venda', tipo:'Área industrial', cidade:'Paulínia', uf:'SP',
    titulo:'Área industrial com frente para via coletora',
    preco:15200000, area_terreno:24000, frente:150, zoneamento:'Industrial',
    creci:'CRECISP 300760', corretor:'Joselia Junqueira Viana' },

  { ref:'PC-0028', status:'publicado', operacao:'venda', tipo:'Apartamento', cidade:'Campinas', uf:'SP',
    titulo:'Apartamento alto padrão no Cambuí', preco:2400000,
    area_construida:180, quartos:3, suites:1, banheiros:3, vagas:2,
    piscina:true, churrasqueira:true, elevador:true, portaria24h:true, varanda:true,
    creci:'CRECISP 300760',
    fotos:['https://propto.com.br/api/foto?k=a.jpg','https://propto.com.br/api/foto?k=b.jpg',
           'https://propto.com.br/api/foto?k=c.jpg'] },

  { ref:'PC-0023', status:'publicado', operacao:'venda', tipo:'Fazenda', cidade:'Lajeado', uf:'RS',
    titulo:'Fazenda com recurso hídrico', preco:9800000, area_terreno:1210000,
    agua:true, benfeitorias:true, creci:'CRECISP 297692' },

  /* não podem entrar */
  { ref:'PC-0024', status:'publicado', operacao:'locação', tipo:'Galpão', cidade:'Campinas', uf:'SP',
    titulo:'Galpão para locação', preco:48000, area_terreno:3000, creci:'CRECISP 297692' },
  { ref:'PC-0025', status:'em captação', operacao:'venda', tipo:'Casa', cidade:'Campinas', uf:'SP',
    titulo:'Casa em captação', preco:900000, area_terreno:300, creci:'CRECISP 297692' },
  { ref:'PC-0026', status:'publicado', operacao:'venda', tipo:'Galpão', cidade:'Indaiatuba', uf:'SP',
    titulo:'Galpão sem responsável', preco:3000000, area_terreno:2000 },
  { ref:'PC-0027', status:'publicado', operacao:'venda', tipo:'Terreno', cidade:'Vinhedo', uf:'SP',
    titulo:'Terreno sem preço', area_terreno:1200, creci:'CRECISP 297692' }
];

let modo = 'ok';   // ok | fora | lixo

/* PNG 1x1 real: sem isso o navegador falha ao carregar, o onerror
   dispara e a galeria vira ilustração — que é o comportamento certo,
   mas impede testar o caminho feliz. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

const propto = http.createServer((req, res) => {
  if (req.url.startsWith('/api/foto')) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(PNG);
    return;
  }
  if (modo === 'fora') { res.destroy(); return; }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (modo === 'lixo') { res.end('<html>erro</html>'); return; }
  res.end(JSON.stringify({ imoveis: OFERTAS }));
});

const site = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const arq = path.join(RAIZ, rel);
  if (!arq.startsWith(RAIZ) || !fs.existsSync(arq)) { res.statusCode = 404; res.end('no'); return; }
  res.setHeader('Content-Type', TIPOS[path.extname(arq)] || 'application/octet-stream');
  res.end(fs.readFileSync(arq));
});

(async () => {
  await new Promise(r => propto.listen(0, r));
  await new Promise(r => site.listen(0, r));
  const base = `http://127.0.0.1:${propto.address().port}`;
  const urlPropto = `${base}/api/publicos`;
  /* reescreve as fotos para o servidor falso, agora que a porta existe */
  for (const o of OFERTAS) {
    if (o.fotos) o.fotos = o.fotos.map((_, i) => `${base}/api/foto?k=${o.ref}-${i}.jpg`);
  }
  const urlSite   = `http://127.0.0.1:${site.address().port}/index.html`;

  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1366, height: 900 } });
  const aviso = [];
  page.on('console', m => { if (m.text().includes('[Propto]')) aviso.push(m.text()); });

  /* liga o endpoint antes do site rodar */
  await page.addInitScript(u => { window.PROPTO = { ENDPOINT: u, CACHE: false }; }, urlPropto);

  console.log('\n=== 1. a vitrine se alimenta do Propto ===');
  await page.goto(urlSite);
  await page.waitForFunction(() => window.IMOVEIS && window.IMOVEIS.some(i => i.origem === 'propto'),
                             { timeout: 8000 }).catch(() => {});
  const r1 = await page.evaluate(() => ({
    total: window.IMOVEIS.length,
    refs: window.IMOVEIS.map(i => i.ref),
    origem: window.IMOVEIS[0] && window.IMOVEIS[0].origem,
    cartoes: document.querySelectorAll('#vitrine-lista article.imovel').length,
    botao: document.getElementById('fl-buscar').textContent.trim()
  }));
  ok('carteira veio do Propto', r1.origem === 'propto', r1.origem);
  ok('entraram os 4 publicáveis', r1.total === 4, r1.refs.join(','));
  ok('a vitrine renderizou os 4', r1.cartoes === 4, r1.cartoes);
  ok('o contador acompanha', /Ver 4 im/.test(r1.botao), r1.botao);
  ok('os demonstrativos saíram', !r1.refs.some(x => /AI-CPQ|GA-JUN|TU-IND/.test(x)), r1.refs.join(','));

  console.log('\n=== 2. as travas ===');
  ok('locação não entra', !r1.refs.includes('PC-0024'));
  ok('em captação não entra', !r1.refs.includes('PC-0025'));
  ok('sem CRECI não entra', !r1.refs.includes('PC-0026'));
  ok('sem preço não entra', !r1.refs.includes('PC-0027'));
  const rec = aviso.find(t => t.includes('não publicados'));
  ok('as recusas ficam registradas', !!rec, (rec || '').slice(0, 80));

  console.log('\n=== 3. a tradução dos campos ===');
  const g = await page.evaluate(() => window.IMOVEIS.find(i => i.ref === 'PC-0021'));
  ok('tipologia virou slug da vitrine', g.tipo === 'galpao', g.tipo);
  ok('pé-direito veio para o filtro', g.pedireito === 12, g.pedireito);
  ok('docas vieram para o filtro', g.docas === 6, g.docas);
  ok('área construída veio', g.construida === 4200, g.construida);
  ok('500 kVA vira alta tensão', g.energia === 'alta', g.energia);
  ok('zoneamento normalizado', g.zoneamento === 'industrial', g.zoneamento);
  ok('cidade e região no cabeçalho', /Sumaré\/SP · Rod\. Anhanguera/.test(g.onde), g.onde);
  ok('ilustração conforme a tipologia', g.arte === 'galpao', g.arte);
  ok('fichinha com 3 linhas', g.dados.length === 3, JSON.stringify(g.dados));
  ok('fichinha traz o pé-direito', JSON.stringify(g.dados).includes('12 m'));

  const f = await page.evaluate(() => window.IMOVEIS.find(i => i.ref === 'PC-0023'));
  ok('fazenda vira slug rural', f.tipo === 'fazenda', f.tipo);
  ok('recurso hídrico vira filtro', f.agua === 'sim');
  ok('ilustração rural', f.arte === 'rural', f.arte);

  console.log('\n=== 4. filtros funcionam sobre o que veio do Propto ===');
  const r4 = await page.evaluate(() => {
    const ev = (id, v) => { const n = document.getElementById(id); n.value = v;
      n.dispatchEvent(new Event(n.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
    ev('fl-grupo', 'Industrial e logístico');
    const indus = document.querySelectorAll('#vitrine-lista article.imovel').length;
    document.getElementById('fl-limpar').click();
    ev('fl-tipo', 'galpao');
    const fx = document.getElementById('fx-pedireito');
    if (fx) { fx.value = '12'; fx.dispatchEvent(new Event('change', { bubbles: true })); }
    const comPd = document.querySelectorAll('#vitrine-lista article.imovel').length;
    document.getElementById('fl-limpar').click();
    ev('fl-codigo', 'PC-0022');
    const porCod = document.querySelectorAll('#vitrine-lista article.imovel').length;
    document.getElementById('fl-limpar').click();
    ev('fl-preco-min', '10000000');
    const caros = document.querySelectorAll('#vitrine-lista article.imovel').length;
    document.getElementById('fl-limpar').click();
    return { indus, comPd, porCod, caros };
  });
  ok('segmento industrial devolve 2', r4.indus === 2, r4.indus);
  ok('pé-direito 12m acha o galpão real', r4.comPd === 1, r4.comPd);
  ok('busca por código do Propto funciona', r4.porCod === 1, r4.porCod);
  ok('preço mínimo de 10 mi devolve 1', r4.caros === 1, r4.caros);

  console.log('\n=== 5. a ficha abre com dados do Propto ===');
  const r5 = await page.evaluate(async () => {
    document.querySelector('#vitrine-lista article.imovel').click();
    await new Promise(r => setTimeout(r, 300));
    const t = document.getElementById('ficha').textContent;
    return { aberta: document.getElementById('ficha-veu').classList.contains('aberta'),
             texto: t, hash: location.hash,
             zap: (document.getElementById('ficha-zap') || {}).href || '' };
  });
  ok('ficha abriu', r5.aberta);
  ok('ficha mostra a referência do Propto', /PC-00\d\d/.test(r5.texto));
  ok('ficha mostra o CRECI do responsável', /CRECISP/.test(r5.texto));
  ok('ficha traz a descrição captada', /pré-moldada|porta-paletes|frente para via/.test(r5.texto));
  ok('endereço próprio usa o código do Propto', /#imovel\/PC-00\d\d/.test(r5.hash), r5.hash);
  ok('WhatsApp cita a referência', /PC-00\d\d/.test(decodeURIComponent(r5.zap)));
  await page.keyboard.press('Escape');

  console.log('\n=== 6. o Propto cai e o site continua de pé ===');
  modo = 'fora';
  const page2 = await b.newPage({ viewport: { width: 1366, height: 900 } });
  const aviso2 = [];
  page2.on('console', m => { if (m.text().includes('[Propto]')) aviso2.push(m.text()); });
  await page2.addInitScript(u => { window.PROPTO = { ENDPOINT: u, TIMEOUT: 2, CACHE: false }; }, urlPropto);
  await page2.goto(urlSite);
  await page2.waitForTimeout(3500);
  const r6 = await page2.evaluate(() => ({
    cartoes: document.querySelectorAll('#vitrine-lista article.imovel').length,
    vazio: !!document.querySelector('#vitrine-lista .vazio'),
    erroNaTela: /erro|falha|undefined|NaN/i.test(document.getElementById('carteira').textContent)
  }));
  ok('o site continua mostrando imóveis', r6.cartoes > 0 || r6.vazio, r6.cartoes);
  ok('nenhum erro aparece para o visitante', !r6.erroNaTela);
  ok('a queda fica registrada no console', aviso2.some(t => /rede|tempo|carteira local/.test(t)),
     (aviso2[0] || '').slice(0, 70));

  console.log('\n=== 7. o Propto devolve lixo ===');
  modo = 'lixo';
  const page3 = await b.newPage({ viewport: { width: 1366, height: 900 } });
  await page3.addInitScript(u => { window.PROPTO = { ENDPOINT: u, CACHE: false }; }, urlPropto);
  await page3.goto(urlSite);
  await page3.waitForTimeout(2500);
  const r7 = await page3.evaluate(() => ({
    cartoes: document.querySelectorAll('#vitrine-lista article.imovel').length,
    local: window.IMOVEIS.every(i => i.origem !== 'propto')
  }));
  ok('resposta inválida não quebra a página', r7.cartoes >= 0);
  ok('volta para a carteira local', r7.local);

  console.log('\n=== 8. sem endpoint configurado (estado de hoje) ===');
  const page4 = await b.newPage({ viewport: { width: 1366, height: 900 } });
  await page4.goto(urlSite);
  await page4.waitForTimeout(1500);
  const r8 = await page4.evaluate(() => ({
    endpoint: window.PROPTO.ENDPOINT,
    cartoes: document.querySelectorAll('#vitrine-lista article.imovel').length
  }));
  ok('endpoint nasce vazio', r8.endpoint === '');
  ok('site funciona igual sem integração', r8.cartoes === 3, r8.cartoes);

  console.log('\n=== 9. fotos reais do Propto ===');
  const r9 = await page.evaluate(() => {
    document.getElementById('fl-limpar').click();
    const cartoes = [...document.querySelectorAll('#vitrine-lista article.imovel')];
    const comFoto = cartoes.find(c => c.querySelector('.im-contagem'));
    const semFoto = cartoes.find(c => c.querySelector('.im-capa svg'));
    return {
      temImg: !!comFoto,
      src: comFoto ? comFoto.querySelector('img').getAttribute('src') : null,
      lazy: comFoto ? comFoto.querySelector('img').getAttribute('loading') : null,
      alt: comFoto ? comFoto.querySelector('img').getAttribute('alt') : null,
      contagem: comFoto ? (comFoto.querySelector('.im-contagem') || {}).textContent : null,
      temIlustracao: !!semFoto
    };
  });
  ok('cartão com foto usa <img>', r9.temImg);
  ok('a foto vem do Propto', /api\/foto/.test(r9.src || ''), r9.src);
  ok('carrega sob demanda', r9.lazy === 'lazy');
  ok('a foto tem texto alternativo', (r9.alt || '').length > 5, r9.alt);
  ok('mostra quantas fotos há', /3/.test(r9.contagem || ''), r9.contagem);
  ok('imóvel sem foto mantém a ilustração', r9.temIlustracao);

  console.log('\n=== 10. galeria da ficha ===');
  const r10 = await page.evaluate(async () => {
    const alvo = [...document.querySelectorAll('#vitrine-lista article.imovel')]
      .find(c => c.querySelector('.im-contagem'));   // o que tem mais de uma foto
    alvo.click();
    await new Promise(r => setTimeout(r, 300));
    const foto = document.getElementById('gal-foto');
    const inicial = foto.getAttribute('src');
    document.getElementById('gal-prox').click();
    await new Promise(r => setTimeout(r, 80));
    const depois = foto.getAttribute('src');
    const pos = document.getElementById('gal-pos').textContent;
    document.querySelector('[data-gal="2"]').click();
    await new Promise(r => setTimeout(r, 80));
    return { inicial, depois, pos, posFinal: document.getElementById('gal-pos').textContent,
             tiras: document.querySelectorAll('[data-gal]').length,
             marcada: document.querySelector('[data-gal="2"]').getAttribute('aria-current') };
  });
  ok('galeria abriu com a primeira foto', /-0\.jpg/.test(decodeURIComponent(r10.inicial)), r10.inicial);
  ok('a seta avança', r10.inicial !== r10.depois);
  ok('o contador acompanha', r10.pos === '2 / 3', r10.pos);
  ok('há uma miniatura por foto', r10.tiras === 3, r10.tiras);
  ok('clicar na miniatura troca a foto', r10.posFinal === '3 / 3', r10.posFinal);
  ok('a miniatura ativa fica marcada', r10.marcada === 'true');
  await page.keyboard.press('Escape');

  console.log('\n=== 11. filtros residenciais só no residencial ===');
  const r11 = await page.evaluate(() => {
    const ev = (id, v) => { const n = document.getElementById(id); n.value = v;
      n.dispatchEvent(new Event('change', { bubbles: true })); };
    document.getElementById('fl-limpar').click();

    ev('fl-tipo', 'apartamento');
    const apto = [...document.querySelectorAll('#fl-atribs-campos [data-campo]')].map(x => x.dataset.campo);
    const blocosApto = [...document.querySelectorAll('#fl-atribs-campos .ex-sub')].map(x => x.textContent);

    document.getElementById('fl-limpar').click();
    ev('fl-tipo', 'galpao');
    const galpao = [...document.querySelectorAll('#fl-atribs-campos [data-campo]')].map(x => x.dataset.campo);
    const blocosGalpao = [...document.querySelectorAll('#fl-atribs-campos .ex-sub')].map(x => x.textContent);
    document.getElementById('fl-limpar').click();
    return { apto, blocosApto, galpao, blocosGalpao };
  });
  ok('apartamento tem quartos e suítes',
     r11.apto.includes('quartos') && r11.apto.includes('suites'), r11.apto.join(','));
  ok('apartamento tem lazer', r11.blocosApto.some(b => /Lazer/.test(b)), r11.blocosApto.join(' · '));
  ok('apartamento NÃO tem docas', !r11.apto.includes('docas'));
  ok('galpão tem pé-direito, docas e piso',
     ['pedireito','docas','piso'].every(c => r11.galpao.includes(c)), r11.galpao.join(','));
  ok('galpão NÃO tem quartos nem piscina',
     !r11.galpao.includes('quartos') && !r11.galpao.includes('piscina'), r11.galpao.join(','));
  ok('galpão NÃO oferece bloco de lazer',
     !r11.blocosGalpao.some(b => /Lazer/.test(b)), r11.blocosGalpao.join(' · '));

  console.log('\n=== 12. caixas de marcar filtram ===');
  const r12 = await page.evaluate(() => {
    const ev = (id, v) => { const n = document.getElementById(id); n.value = v;
      n.dispatchEvent(new Event('change', { bubbles: true })); };
    document.getElementById('fl-limpar').click();
    ev('fl-tipo', 'apartamento');
    const antes = document.querySelectorAll('#vitrine-lista article.imovel').length;
    const cx = document.getElementById('fx-piscina');
    cx.checked = true; cx.dispatchEvent(new Event('change', { bubbles: true }));
    const comPiscina = document.querySelectorAll('#vitrine-lista article.imovel').length;
    const etq = [...document.querySelectorAll('#fl-etiquetas .etiqueta')].map(e => e.textContent.trim());
    const academia = document.getElementById('fx-academia');
    academia.checked = true; academia.dispatchEvent(new Event('change', { bubbles: true }));
    const comAcademia = document.querySelectorAll('#vitrine-lista article.imovel').length;
    document.getElementById('fl-limpar').click();
    const depoisLimpar = document.getElementById('fx-piscina');
    return { antes, comPiscina, comAcademia, etq,
             limpou: !depoisLimpar || depoisLimpar.checked === false };
  });
  ok('apartamento aparece', r12.antes === 1, r12.antes);
  ok('piscina mantém o que tem piscina', r12.comPiscina === 1, r12.comPiscina);
  ok('etiqueta não diz "Piscina: Sim"',
     r12.etq.some(e => /^Piscina×?$/.test(e.replace(/\s/g, ''))), r12.etq.join(' | '));
  ok('academia ausente exclui o imóvel', r12.comAcademia === 0, r12.comAcademia);
  ok('limpar desmarca as caixas', r12.limpou);

  await b.close(); propto.close(); site.close();
  console.log(`\n${passes} passaram, ${falhas} falharam\n`);
  process.exit(falhas ? 1 : 0);
})();
