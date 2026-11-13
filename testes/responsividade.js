/* Auditoria de enquadramento. Mede o que o olho não pega:
   vazamento horizontal, alvo de toque pequeno, texto miúdo,
   linha longa demais e elemento espremido. */
const { chromium } = require('playwright');
const URL = 'file://' + require('path').join(__dirname,'..','web','index.html');
const LARGURAS = [
  [360,800,'Android pequeno'], [390,844,'iPhone'], [430,932,'iPhone Max'],
  [768,1024,'Tablet retrato'], [1024,768,'Tablet paisagem'],
  [1280,800,'Notebook'], [1440,900,'Desktop'], [1920,1080,'Monitor grande']
];

(async () => {
  const b = await chromium.launch();
  for (const [w,h,nome] of LARGURAS) {
    const p = await b.newPage({ viewport:{width:w,height:h} });
    await p.goto(URL); await p.waitForTimeout(900);
    const r = await p.evaluate(() => {
      const vw = window.innerWidth;
      const out = { overflow: document.documentElement.scrollWidth - vw, vazando:[], toque:[], miudo:[], linhaLonga:[], espremido:[] };
      const visivel = el => { const s = getComputedStyle(el); return s.display!=="none" && s.visibility!=="hidden" && el.offsetParent!==null; };
      const nomear = el => el.id ? "#"+el.id : el.tagName.toLowerCase()+(el.className && typeof el.className==="string" ? "."+el.className.trim().split(/\s+/)[0] : "");

      document.querySelectorAll("body *").forEach(el => {
        if (!visivel(el)) return;
        const b = el.getBoundingClientRect();
        if (b.width === 0) return;
        if (b.right > vw + 1 || b.left < -1) out.vazando.push({ el:nomear(el), left:Math.round(b.left), right:Math.round(b.right) });
        const s = getComputedStyle(el);
        const fs = parseFloat(s.fontSize);
        // alvos de toque
        if (/^(A|BUTTON|SELECT|INPUT|TEXTAREA)$/.test(el.tagName) && (b.height < 40 || b.width < 40)) {
          const pai = el.closest("footer,.menu,.legenda");
          if (!pai) out.toque.push({ el:nomear(el), w:Math.round(b.width), h:Math.round(b.height) });
        }
        // texto miúdo em corpo
        if (el.children.length === 0 && el.textContent.trim().length > 25 && fs < 13 && !/mono/i.test(s.fontFamily))
          out.miudo.push({ el:nomear(el), px:fs.toFixed(1) });
        // linha de leitura longa
        if (el.children.length === 0 && el.textContent.trim().length > 120) {
          const chars = b.width / (fs * 0.5);
          if (chars > 95) out.linhaLonga.push({ el:nomear(el), ch:Math.round(chars) });
        }
      });
      // colunas espremidas
      document.querySelectorAll(".seg,.etapa,.bloco,.porta,.imovel,.campos>div,.tres>div").forEach(el => {
        if (!visivel(el)) return;
        const b = el.getBoundingClientRect();
        if (b.width > 0 && b.width < 165) out.espremido.push({ el:nomear(el), w:Math.round(b.width) });
      });
      // alturas úteis
      out.capaAltura = Math.round(document.querySelector(".capa").getBoundingClientRect().height);
      out.h1 = parseFloat(getComputedStyle(document.querySelector("h1")).fontSize).toFixed(1);
      const portas = document.querySelector(".portas").getBoundingClientRect();
      out.portasFim = Math.round(portas.bottom);
      out.viewportH = window.innerHeight;
      return out;
    });
    const uniq = a => [...new Map(a.map(x=>[x.el,x])).values()];
    console.log(`\n### ${w}×${h} — ${nome}`);
    console.log(`  overflow horizontal: ${r.overflow}px | h1 ${r.h1}px | capa ${r.capaAltura}px | portas terminam em ${r.portasFim} (tela ${r.viewportH})`);
    const mostra = (rot, arr) => { const u = uniq(arr); if (u.length) console.log(`  ${rot}: ` + u.slice(0,6).map(x=>JSON.stringify(x)).join(" ")); };
    mostra("VAZANDO", r.vazando);
    mostra("alvo de toque <40px", r.toque);
    mostra("texto <13px", r.miudo);
    mostra("linha >95ch", r.linhaLonga);
    mostra("coluna <165px", r.espremido);
    await p.close();
  }
  await b.close();
})();
