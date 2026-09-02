# PrimeCorp — Como o sistema funciona e como colocar no ar

Rodrigo, este é o documento único. Se você ler só um arquivo, leia este.

---

## PARTE 1 — O que existe hoje, pronto

### O site (`web/index.html`)

| Funciona hoje | Detalhe |
|---|---|
| Consulta de faixa de valor | 16 tipologias × 645 municípios de SP (base IBGE) |
| Busca de município | Seletor próprio, funciona no iPhone (o `<datalist>` do HTML não funciona no Safari iOS) |
| Vitrine de imóveis | Cada um exibe o CRECI do responsável — art. 4º do Decreto 81.871/78 |
| Formulário de contato | Valida nome, telefone ou e-mail, e exige autorização de contato (LGPD) |
| Rodapé legal | Declara os dois CRECI PF e a PJ em concessão |

**O que ainda não faz:** enviar o lead. Mostra "Recebido" mas não manda para lugar nenhum até você configurar o destino (Etapa 3).

### O painel (`web/painel.html`)

| Tela | Funciona hoje |
|---|---|
| Entrada | Senha + segundo fator (visual; a validação real é da API) |
| Hoje | Pipeline de comissão bruto e ponderado por estágio, prazos vencendo |
| Captações | Fichas de mandato, **anexar autorização** e **ativar mandato** com as travas legais |
| Ativos | Tabela com busca por cidade e tipo |
| Leads | Fila de contatos |
| **Radar** | Agrupa o mesmo imóvel entre corretores diferentes, reconstrói o endereço por concordância e mede desassistência |
| **Anúncios** | Cola planilha, tira repetidos, cruza com os ativos, aponta o que é novo |
| **Avaliação** | Roda o método comparativo completo e emite o parecer pronto para copiar |
| **Oportunidades** | Fila ordenada por valor esperado de comissão, com decomposição do score |
| Conformidade | Validade dos CRECI e pendências de dados pessoais |

As quatro telas de trabalho **rodam de verdade**, sem depender da API. Você pode abrir o
arquivo no navegador hoje e usar. O que falta é persistência: fechou o navegador, perdeu.

### O backend (pasta `app/`, `db/`, `scripts/`)

Pronto para subir: banco PostgreSQL com PostGIS, login com Argon2id e MFA, sessões
revogáveis, papéis de acesso, trava de CRECI no próprio banco, motor de avaliação,
emissão de PTAM, pipeline de LGPD, backup com teste de restauração.

**169 testes automatizados passando.** Rode `./testes/rodar.sh` a qualquer momento.

---

## PARTE 2 — De onde vêm os anúncios (a pergunta central)

Preciso ser direto: **não existe botão que sai colhendo anúncio dos portais.**
Raspar ZAP, VivaReal, OLX ou Imovelweb viola os termos de uso deles, dá bloqueio de
IP e, em escala, vira problema jurídico. Não construí isso e recomendo que não use.

O que funciona, em ordem de esforço:

### Nível 1 — Já funciona hoje, custo zero

**Pesquisa manual organizada.** Vocês pesquisam a micro-região, jogam numa planilha
(portal, id, url, título, endereço, cidade, área, preço), colam na tela **Anúncios** e
o sistema faz o trabalho pesado: remove o mesmo anúncio republicado, cruza com os
ativos que vocês já mapearam e separa o que é novidade.

Isso já é o suficiente para calibrar preço e montar o PTAM. É por aqui que se começa.

**Fontes públicas para a planilha:** anúncios visíveis dos portais (copiando à mão o
que interessa), placas em campo, indicações, leilões, e os próprios contatos de vocês.

### Nível 2 — Contratar acesso (semanas)

| Fonte | Para quê | Como conseguir |
|---|---|---|
| **Feed licenciado de portal** | Anúncios em volume, legalmente | Contato comercial do portal; produto de dados ou parceria de imobiliária |
| **Google Maps Platform** | Transformar endereço em coordenada; buscar entorno | Conta Google Cloud, cobrança por consulta, tem faixa gratuita mensal |
| **ViaCEP / Correios** | Normalizar CEP e logradouro | Gratuito, API aberta |

### O Radar — como ele localiza o imóvel

A tela **Radar** faz o trabalho que nenhum portal faz, e é uso interno: não aparece no site.

1. **Descarta locação.** Só venda entra.
2. **Tira o mesmo anúncio republicado** pela impressão do anúncio.
3. **Agrupa o mesmo imóvel entre corretores diferentes.** A chave é a **metragem**, não o
   endereço nem o preço — porque preço e endereço são justamente o que o corretor
   desalinhado erra. Exigir que eles batessem faria o radar perder o caso que ele existe
   para encontrar.
4. **Triangula o endereço.** Cada anunciante informa uma versão; o termo que se repete
   entre eles tem a maior chance de ser o verdadeiro. O resultado sai classificado:
   *convergente*, *parcial*, *divergente* ou *anunciante único*.
5. **Mede a desassistência** de 0 a 100: meses no mercado, ausência de foto, descrição
   vazia, preço não informado, e **divergência de preço entre corretores** — sinal de que
   ninguém alinhou com o proprietário.

**Como ler o resultado.** Índice alto significa proprietário mal servido. Endereço
divergente significa que nem os corretores sabem onde o imóvel fica — e quem chegar com
a matrícula na mão chega na frente. Índice baixo com anúncio bem feito significa
captação difícil: alguém já está fazendo o trabalho.

**O que o Radar não faz.** Ele não vai à rua. A reconstrução do endereço é uma
hipótese forte, não uma certeza. A confirmação é matrícula (ONR) ou visita — e é por
isso que o cartão diz "confirmar com matrícula antes de abordar".

### Nível 3 — O que realmente localiza o imóvel (o diferencial)

Anúncio de portal **esconde o endereço exato de propósito**. Quem resolve isso é o
registro público, não o portal:

| Fonte | O que entrega | Acesso necessário |
|---|---|---|
| **ONR / SREI** — visualização de matrícula | Área real, titularidade, ônus, histórico | Cadastro no portal do ONR; paga-se por consulta pela tabela de custas do estado |
| **ONR — pesquisa de bens** | Imóveis de um CPF/CNPJ | Mesmo cadastro |
| **ONR — monitor registral** | Aviso quando a matrícula se mexe | Mesmo cadastro |
| **CNIB** | Indisponibilidade de bens | Consulta pública |
| **SIGEF / INCRA** | Polígono georreferenciado de imóvel rural | Conta gov.br nível prata ou ouro |
| **CAR** | Restrição ambiental de imóvel rural | Conta gov.br |
| **Prefeitura — IPTU / ITBI / planta genérica** | Valor venal e, em alguns municípios, transações reais | Varia por município; alguns publicam dados abertos, outros exigem protocolo |

**Como o sistema junta tudo para achar o endereço exato:**

1. O anúncio traz bairro, área e preço, mas não o número.
2. O cruzamento junta anúncios do mesmo imóvel em portais diferentes — cada um vaza um
   pedaço diferente (um dá a esquina, outro dá a foto da fachada, outro a metragem exata).
3. A metragem confere contra a área da matrícula, que é o dado que não mente.
4. A pesquisa de bens no ONR, a partir do CPF/CNPJ do proprietário, fecha o vínculo.
5. Visita em campo confirma.

**Não existe atalho para o passo 5.** Qualquer sistema que prometa endereço exato só com
dado de portal está adivinhando.

**Aviso de LGPD:** dado de proprietário é dado pessoal. O contato precisa de base legal
documentada (legítimo interesse com o teste de balanceamento da ANPD), origem registrada
e opt-out funcionando. O sistema já obriga isso — o campo de origem não aceita vazio.

---

## PARTE 3 — Colocar no ar, passo a passo

### Etapa 1 — Site no ar (1 hora, faz hoje)

1. No painel da Locaweb, abra **Hospedagem → Gerenciador de arquivos**.
2. Entre na pasta pública (`public_html` ou `www`) e apague o `index.html` de construção.
3. Envie, mantendo a estrutura:
   ```
   public_html/
   ├── index.html
   ├── .htaccess          (conteúdo na Etapa 2)
   └── assets/            (a pasta inteira)
   ```
   **Não envie o `painel.html` ainda** — Etapa 4 explica por quê.
4. Abra `https://www.primecorpimoveis.com.br`. Deve aparecer o site.

### Etapa 2 — Domínio e cadeado (30 min + propagação)

1. **DNS:** no Registro.br, em *Alterar servidores DNS*, aponte para os servidores que a
   Locaweb informa. Leva de 15 minutos a 24 horas.
2. **SSL:** no painel Locaweb, ative o certificado gratuito para o domínio **e** para o `www`.
3. Crie o arquivo `.htaccess` na pasta pública (se já existir um, **acrescente** ao final):

```apache
RewriteEngine On
RewriteCond %{HTTPS} !=on
RewriteRule ^(.*)$ https://%{HTTP_HOST}/$1 [R=301,L]
RewriteCond %{HTTP_HOST} ^primecorpimoveis\.com\.br$ [NC]
RewriteRule ^(.*)$ https://www.primecorpimoveis.com.br/$1 [R=301,L]

<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
</IfModule>
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType image/png "access plus 1 month"
  ExpiresByType application/javascript "access plus 1 week"
</IfModule>
```

### Etapa 3 — Fazer o lead chegar (20 min) ⚠️ **sem isso o site não gera nada**

Escolha **um** caminho.

**Caminho rápido (recomendado para hoje):** crie conta em um serviço de formulário
(Formspree, Web3Forms ou similar), pegue a URL do endpoint e, no `index.html`, procure:

```js
const ENDPOINT = "";
```

Coloque a URL entre as aspas. **Depois envie um lead de teste e confirme que chegou no
e-mail de vocês.** Não pule esse teste.

**Caminho definitivo:** quando a API estiver no ar (Etapa 4), aponte para
`https://painel.primecorpimoveis.com.br/api/publico/leads`. O lead cai direto no banco,
sem terceiro no meio — melhor para LGPD.

**Enquanto isso, deixe o WhatsApp visível.** Lead que não chega é comissão perdida.

### Etapa 4 — Painel e banco (2 a 3 horas)

**Por que não pode subir o `painel.html` junto com o site:** em
`www.primecorpimoveis.com.br/painel.html` qualquer pessoa abre e vê seu pipeline. Ele
precisa ficar atrás de login, num subdomínio separado.

**Hospedagem compartilhada não roda isso.** Você precisa de uma VPS com 2 GB de RAM:

| Onde | Custo aproximado |
|---|---|
| Locaweb Cloud | a partir de ~R$ 60/mês |
| DigitalOcean / Vultr | a partir de US$ 6/mês |
| Hetzner | a partir de € 4/mês |

Na VPS, com Docker instalado:

```bash
# 1. envie a pasta v4/ e entre nela
cd primecorp
cp .env.example .env

# 2. gere os segredos — a aplicação RECUSA subir com valor fraco, isso é proposital
python3 -c "import secrets;print(secrets.token_urlsafe(48))"   # cole em APP_SECRET
python3 -c "import secrets;print(secrets.token_urlsafe(32))"   # cole em POSTGRES_PASSWORD
nano .env    # preencha também LIA_VERSION, ex: LIA-2026-01

# 3. suba o banco e aguarde os scripts de db/ rodarem
docker compose up -d db
docker compose logs -f db      # Ctrl+C quando parar de escrever

# 4. cadastre vocês dois (tenha o Google Authenticator no celular)
export DATABASE_URL='postgresql://primecorp:SUA_SENHA@localhost:5432/primecorp'
python3 scripts/cadastrar_equipe.py

# 5. suba tudo e confira
docker compose up -d
curl http://localhost:8000/api/health
```

**Subdomínio:** no DNS, crie um registro **A** chamado `painel` apontando para o IP da
VPS. Ajuste `server_name` em `nginx/primecorp.conf` e emita o certificado:

```bash
docker run --rm -v $(pwd)/certs:/etc/letsencrypt -p 80:80 certbot/certbot certonly \
  --standalone -d painel.primecorpimoveis.com.br --agree-tos -m seu@email.com
docker compose restart proxy
```

### Etapa 5 — Backup (15 min, antes de existir dado que importa)

```bash
crontab -e
```
```cron
0 3 * * *  cd /caminho/primecorp && ./scripts/backup.sh   >> /var/log/pc-backup.log 2>&1
0 4 * * 0  cd /caminho/primecorp && ./scripts/restore_test.sh >> /var/log/pc-restore.log 2>&1
```

O segundo restaura o backup mais recente num container descartável e valida.
**Se ele falhar, trate como incidente no mesmo dia.** Backup que nunca foi restaurado
não é backup.

---

## PARTE 4 — A rotina de trabalho, na prática

**Segunda de manhã — 10 minutos.**
Abra o painel em **Hoje**. Veja o pipeline ponderado (é a cifra que serve para planejar
caixa, não a bruta) e os prazos. Mandato vencendo é a perda silenciosa mais comum da
corretagem.

**Quando aparece um imóvel para captar.**
1. **Avaliação** → tipologia, município, área, pretensão do proprietário.
2. Cole os comparáveis que você pesquisou. Menos de 7, o sistema recusa — e está certo:
   parecer com base fraca é pior que nenhum parecer.
3. Leia o resultado. Se a pretensão estiver acima do mercado, **não assine o mandato
   antes de alinhar o preço.** Mandato caro ocupa inventário e vence sem vender.
4. **Emitir parecer** → copie → leve impresso para a conversa. É o argumento de captação.

**Quando você pesquisa uma região.**
Planilha → tela **Anúncios** → cruzar. O sistema tira repetidos e mostra o que é novo.
O que ficou "Ativo novo" entra na fila de qualificação.

**Quando você quer saber quem ligar.**
**Oportunidades**. A fila é ordenada por valor esperado de comissão, não por preço do
imóvel. No exemplo que está lá, o galpão de Vinhedo tem a **maior comissão da lista**
(R$ 495.000) e está em terceiro — porque a pretensão está 39% acima do mercado.
Clique na linha para ver por quê.

**Quando o proprietário assina.**
**Captações** → *Anexar autorização* → *Ativar mandato*. Sem o documento assinado o
sistema recusa e cita o art. 5º. Só depois de ativado o imóvel pode ir ao site.

---

## PARTE 5 — Checklist antes de divulgar o endereço

- [ ] Site abre em `https://www.primecorpimoveis.com.br` com cadeado
- [ ] Sem `www` redireciona para com `www`
- [ ] Consulta de faixa responde e o seletor de município abre no celular
- [ ] **Formulário enviado de teste chegou no e-mail** ← o mais importante
- [ ] Os dois CRECI aparecem na capa e no rodapé
- [ ] Abre bem no seu próprio celular
- [ ] `painel.html` **não** está em `www.primecorpimoveis.com.br`
- [ ] Backup rodando e restauração testada
- [ ] Vocês dois com MFA cadastrado

---

## PARTE 6 — O que depende de vocês, não de código

1. **Renovar as inscrições PF antes de 20/09/2026.** A trava do banco impede ativar
   mandato com CRECI vencido. É o comportamento correto, mas trava a captação.
2. **CRECI-J.** O contrato social em ajuste é o que destrava. Quando sair, um comando
   atualiza a organização e **todos os anúncios passam a exibir o número da empresa
   automaticamente**.
3. **Calibrar municípios.** O arquivo `web/assets/calibracao.js` está vazio de propósito.
   Enquanto estiver assim, o site convida a pedir o parecer em vez de exibir número —
   e isso converte bem. Preencha só onde tiverem pesquisa que consigam defender.
4. **Fotos reais.** As ilustrações do site são um recurso temporário digno. Foto de
   imóvel vende; ilustração não.
5. **Vetor da marca.** O que tenho é JPG/PNG. Para placa, adesivo e gráfica, peça o
   AI/EPS/SVG ao designer e guarde junto do projeto.

---

## Se travar

| Sintoma | Causa provável |
|---|---|
| Site não abre, erro de DNS | DNS propagando ou apontado errado |
| Abre sem estilo | a pasta `assets/` não subiu ou subiu com outro nome |
| Consulta de faixa não responde | `assets/municipios-sp.js` não carregou |
| Lead não chega | `ENDPOINT` vazio no `index.html` — Etapa 3 |
| API não sobe, `[BOOT ABORTADO]` | segredo faltando ou fraco no `.env`. É proteção: leia a mensagem, ela diz qual |
| Login pede MFA | cadastre no primeiro acesso, em `/api/auth/mfa/setup` |
| Mandato não ativa | falta a autorização assinada, ou o responsável está com CRECI vencido |
