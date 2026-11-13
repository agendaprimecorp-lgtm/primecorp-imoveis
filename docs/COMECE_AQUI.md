# PrimeCorp Imóveis — site

Site estático. Não precisa de servidor, banco nem build. Sobe em
qualquer hospedagem de arquivos (Netlify, Vercel, GitHub Pages,
Hostinger) arrastando esta pasta.

---

## Os três arquivos que você edita

Nenhum deles é o `index.html`. Você não precisa abrir o HTML.

| Arquivo | O que controla |
|---|---|
| `assets/contato.js` | Telefone, WhatsApp, e-mails, horário e para onde vai o lead |
| `assets/carteira.js` | Os imóveis publicados e as tipologias disponíveis |
| `assets/calibracao.js` | Base de preço por m² da consulta de faixa |

---

## 1. Antes de publicar — três coisas obrigatórias

**a) Tire os imóveis demonstrativos.**
Os três de `assets/carteira.js` são inventados. Imóvel fictício no ar
sob o seu CRECI é exposição real, não detalhe. Substitua por imóveis
com autorização escrita assinada, ou deixe `window.IMOVEIS = [];` —
a seção se adapta sozinha e vira captação de mandato de busca.

**b) Confira o contato.**
Abra `assets/contato.js` e verifique telefone e e-mails. O WhatsApp
tem que estar só com dígitos, com 55 e DDD: `5519999194447`.

**c) Decida o destino do lead.**
Já vem em `destino: "whatsapp"`. Nesse modo o formulário abre o
WhatsApp com a mensagem pronta — nome, telefone, tipo, cidade, área e
observações. Funciona hoje, sem servidor e sem custo.

Quando tiver backend, troque para `"endpoint"` e preencha `ENDPOINT`.
Se o servidor cair, o site volta sozinho para o WhatsApp: o lead não
se perde porque a API ficou fora do ar.

---

## 2. Publicar (Netlify, o mesmo da consultoria)

1. Entre em app.netlify.com
2. **Add new site → Deploy manually**
3. Arraste esta pasta inteira para a área indicada
4. **Domain settings → Add custom domain** → `www.primecorpimoveis.com.br`
5. No seu registrador de domínio, aponte conforme o Netlify indicar
6. **HTTPS → Verify DNS configuration** e depois **Provision certificate**

O certificado leva de alguns minutos a algumas horas. Enquanto isso o
site já responde pela URL provisória do Netlify.

---

## 3. Cadastrar um imóvel

Abra `assets/carteira.js` e copie um bloco existente. Obrigatórios:

```js
{
  ref:"GA-CPQ-004",              // código seu; vai na URL compartilhável
  tipo:"galpao",                 // um dos slugs de window.TIPOS
  titulo:"Galpão com pátio para carreta",
  cidade:"Campinas", uf:"SP",
  onde:"Campinas/SP · Jardim Santa Genebra",
  preco:4200000, area:5000,
  creci:"CRECISP 297692",        // quem responde por ESTE anúncio
  arte:"galpao",                 // industrial | galpao | terreno | rural | predio | residencial
  dados:[["Terreno","5.000 m²"],["Construído","2.100 m²"],["Pé-direito","9 m"]],
  descricao:"Texto corrido da ficha.",
  // opcionais — é por eles que o imóvel aparece nos filtros:
  construida:2100, pedireito:9, docas:4
}
```

Cada imóvel ganha endereço próprio: `...#imovel/GA-CPQ-004`. É esse
link que você manda no WhatsApp — abre direto na ficha.

---

## 4. Calibrar a consulta de faixa

`assets/calibracao.js` está **vazio de propósito**. Enquanto estiver
assim, a consulta devolve um convite para o parecer técnico em vez de
um número. Isso é intencional: publicar R$/m² inventado sob o CRECI de
vocês é exposição.

Para ligar um município, use valores apurados de verdade:

```js
window.CALIBRACAO.MERCADO = {
  "campinas-sp": { "galpao": [1850, 5000] }   // [R$/m² de referência, área de referência]
};
```

O slug sai de `assets/municipios-br.js` e sempre carrega a UF, porque
232 nomes de cidade se repetem entre estados.

---

## 5. O que ainda falta (em ordem)

1. **Privacidade** — página própria. O rodapé já informa o canal e o
   prazo do art. 19 da LGPD, mas política publicada é exigência.
2. **Fotos** — as ilustrações são placeholder. Em imóvel de ticket
   alto, foto é o ativo.
3. **Páginas internas** — sobre, contato e `/imovel/{ref}` com URL
   real, para o Google indexar cada imóvel.
4. **Prova** — um caso real, mesmo anonimizado, prova a tese do site.

---

## Conformidade embutida

- Número do CRECI em cada anúncio e na ficha (art. 4º, Decreto 81.871/1978)
- Declaração de autorização escrita do proprietário (art. 5º do mesmo decreto)
- Abrangência nacional redigida na forma do art. 5º da Resolução COFECI 327/1992
- Consentimento explícito nos dois formulários, com canal e prazo de exclusão (LGPD)
- Ressalva de que a consulta de faixa não é parecer técnico (Resolução COFECI 1.066/2007)
- Nenhuma menção a locação como serviço

**Pendência societária:** o CRECI-J está em concessão. Até sair, os
anúncios respondem pela inscrição PF dos corretores. E atenção ao art.
6º, parágrafo único, da Resolução 327/1992 — pessoa jurídica não pode
ter inscrição secundária; atuação continuada fora de SP exigiria filial.
