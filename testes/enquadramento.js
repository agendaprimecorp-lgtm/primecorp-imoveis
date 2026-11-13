/* Mede seção a seção: cabe na tela? a âncora para no lugar certo? */
const { chromium } = require('playwright');
const URL = 'file://' + require('path').join(__dirname,'..','web','index.html');
const TELAS=[[1366,768,'notebook 14" HD'],[1512,982,'MacBook Air 14"'],[1920,1080,'monitor'],[390,844,'iPhone']];
(async()=>{
  const b=await chromium.launch();
  for(const [w,h,nome] of TELAS){
    const p=await b.newPage({viewport:{width:w,height:h}});
    await p.goto(URL); await p.waitForTimeout(900);
    const r=await p.evaluate(()=>{
      const hdr=document.querySelector('.topo').getBoundingClientRect().height;
      const util=window.innerHeight-hdr;
      const secs=[...document.querySelectorAll('.capa, main section')].map(s=>({
        id:s.id||s.className.split(' ')[0],
        alt:Math.round(s.getBoundingClientRect().height),
        cabe:s.getBoundingClientRect().height<=util
      }));
      // âncoras: o topo da seção some sob o header?
      const ancoras=[...document.querySelectorAll('.menu a[href^="#"]')].map(a=>{
        const alvo=document.querySelector(a.getAttribute('href'));
        if(!alvo)return{href:a.getAttribute('href'),alvo:'AUSENTE'};
        const sm=getComputedStyle(alvo).scrollMarginTop;
        return{href:a.getAttribute('href'),scrollMargin:sm};
      });
      return{hdr:Math.round(hdr),util:Math.round(util),secs,ancoras,
             total:Math.round(document.body.scrollHeight)};
    });
    console.log(`\n### ${w}×${h} — ${nome}   header ${r.hdr}px · área útil ${r.util}px · página ${r.total}px`);
    r.secs.forEach(s=>console.log(`   ${s.cabe?'cabe ':'ESTOURA'} ${String(s.alt).padStart(5)}px  ${s.id}${s.cabe?'':'  (+'+(s.alt-r.util)+'px)'}`));
    if(w===1366) console.log('   âncoras:', JSON.stringify(r.ancoras));
    await p.close();
  }
  await b.close();
})();
