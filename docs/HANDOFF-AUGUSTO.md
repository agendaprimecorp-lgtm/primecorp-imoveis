# Passagem para o Augusto: site PrimeCorp Imóveis e integração Propto

Atualizado em 15/11/2026.

Este documento diz o que já está pronto, onde está cada parte e o que falta. Ele acompanha o repositório, para a continuidade não depender de conversa.

## Onde está o código

- **Site PrimeCorp Imóveis** (público): github.com/agendaprimecorp-lgtm/primecorp-imoveis, branch `main`.
- **Backend Propto** (público desde 15/11/2026): github.com/agendaprimecorp-lgtm/primecorp-brokers-galpoes, branch `main`.
- **Planilha de códigos** "Códigos dos imóveis PrimeCorp": abas Prefixos, Cidades e Regras. É a referência oficial das siglas.

## O que já está pronto

**Site**
- Seção "Onde atuamos": base em Sumaré, atuação em todo o estado de SP, dia a dia na RMC.
- Cards de segmento (casas, comercial e industrial, galpões, terrenos, fazendas): clicar leva à carteira e não pré-seleciona tipos. O cliente escolhe.
- Logomarca do cabeçalho igual à do rodapé: PRIMECORP em preto (branco no rodapé) e IMÓVEIS em vermelho.
- Trilha "Da conversa à escritura, em quatro etapas" com a linha ligando do 01 ao 04.
- Código aparece em cada cartão de imóvel.
- Vitrine de produção vazia. Imóveis demonstrativos só aparecem com `window.CARTEIRA_DEMO = true`, usado apenas em testes.
- Regra de autorização por escrito do proprietário removida do sistema; é tratada internamente.
- Botão "Fale com um dos nossos corretores" levando ao WhatsApp principal, (19) 99919-4447.
- Campos de CRECI preparados: Rodrigo Franca Viana (297692) e Josélia Junqueira Viana (300760). CRECI e CNPJ da empresa ainda pendentes.

**Código dos imóveis**
- Formato PREFIXO-CIDADE-NÚMERO, por exemplo `AI-CAM-001`.
- Prefixo de 2 letras para cada um dos 30 tipos.
- Sigla de 3 letras por cidade: Campinas CAM, Jundiaí JUN, Sumaré SUM, Hortolândia HOR, Indaiatuba IDT, Paulínia PAU, Valinhos VAL, Vinhedo VIN, Cotia COT.
- Número sequencial global, com 3 dígitos. O vendedor não escolhe o código.
- Função `gerarCodigo(tipo, cidade, numero)` em `shared/codigo-imovel.mjs` (backend Propto), espelhada em `web/assets/carteira.js` (site).

**Integração Propto → site**
- Função Netlify `netlify/functions/vitrine-imoveis.mts`, rota `/vitrine/imoveis`.
- Lê a coleção `registros_conta` (anuncios). Filtra status ativo, operação venda, CRECI, tipo e preço (campo `valores`, lista de pares [rótulo, valor]).
- Devolve `{ imoveis: [...] }` com `codigo`, `tipo`, `preco`, `creci` e `fotos` (rota `/i/<id>/f/<n>.jpg`).
- O site consome pelo módulo `web/assets/propto.js` (`window.PROPTO`: ENDPOINT, TIMEOUT, CACHE, CACHE_HORAS).
- Tipo desconhecido é recusado, nunca classificado por palpite.
- Diagnóstico público (`?diag=1`) removido do endpoint.

**Testes**
- `node testes/site.test.js`: 181 verificações (jsdom).
- `node testes/propto.test.js`: 66 verificações (Playwright). Sem integração, a vitrine deve estar vazia.
- `node test/codigo-imovel.mjs` (no repositório Propto): regra de código.

## O que falta

1. Testar o endpoint em produção: https://propto.com.br/vitrine/imoveis. Não foi possível confirmar a partir do ambiente de desenvolvimento.
2. Gerar o código na aprovação do anúncio: criar a sequência global no banco e chamar `gerarCodigo`. Hoje o código ainda não é gravado no registro.
3. Mapear área e características. O endpoint ainda não envia esses campos. Fechar com o primeiro anúncio real.
4. Alinhar o formato do registro. O template JSON da extensão (PROPOSTO) tem campos nulos e formato de locação. O endpoint espera `valores` como lista de pares.
5. Apontar `window.PROPTO.ENDPOINT` para produção no site e revisar `CACHE_HORAS`.
6. Confirmar CORS para o domínio do site.
7. Manter a trava: só anúncio com status "publicado" entra na vitrine.

## Pendências de negócio

- CRECI e CNPJ da empresa (com o cliente).
- Primeiro anúncio real de venda, criado pelo Rodrigo. Ele avisa quando estiver publicado, para validarmos o ponta a ponta.
