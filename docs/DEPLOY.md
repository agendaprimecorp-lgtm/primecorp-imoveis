# Colocar no ar — www.primecorpimoveis.com.br

Guia para você executar sozinho. Leia inteiro antes de começar: a ordem importa.

Tempo estimado: **site no ar em 1 hora**. Painel com banco, mais 2 a 3 horas.

---

## Antes de tudo: duas coisas que precisam estar resolvidas

**1. Preencher a calibração ou aceitar o comportamento padrão.**
Abra `web/assets/calibracao.js`. Hoje o bloco `MERCADO` está vazio de propósito — a
consulta de faixa convida o visitante a pedir o parecer em vez de exibir número.
Isso **funciona e converte**. Só preencha um município quando vocês tiverem pesquisa
própria que consigam defender numa conversa com o proprietário. O número que aparece
ali é uma afirmação de mercado feita sob o CRECI de vocês.

**2. Confirmar o texto legal do rodapé com a contabilidade/jurídico.**
O rodapé declara a PJ em concessão e identifica os corretores PF. Enquanto o CRECI-J
não sair, essa redação é o que sustenta a legalidade do site.

---

## Etapa 1 — Publicar o site (Locaweb, hospedagem compartilhada)

Você já tem Locaweb (vi o webmail na sua barra). Serve.

**1.1** No painel Locaweb, vá em **Hospedagem → Gerenciar → Gerenciador de arquivos**
(ou use FTP com FileZilla, o que for mais confortável).

**1.2** Entre na pasta pública. Na Locaweb costuma ser `public_html` ou `www`.
Se houver um `index.html` de "site em construção", apague.

**1.3** Envie, mantendo a estrutura exata:

```
public_html/
├── index.html                  ← página inicial
├── painel.html                 ← NÃO subir ainda (ver etapa 4)
└── assets/
    ├── municipios-sp.js
    ├── calibracao.js
    ├── motor.js                        ← motor de avaliação usado pelo painel
    ├── marca-300.png                   ← lockup empilhado (BROKERS · CONSULTORIA)
    ├── marca-600.png
    ├── marca-1200.png                  ← usado no compartilhamento em redes
    ├── marca-negativa-300.png
    ├── marca-negativa-600.png
    ├── marca-horizontal-300.png        ← lockup horizontal (IMÓVEIS), usado no topo
    ├── marca-horizontal-600.png
    ├── marca-horizontal-negativa-600.png
    ├── marca-simbolo-64.png
    ├── marca-simbolo-128.png
    ├── marca-simbolo-512.png
    ├── favicon.png
    └── favicon-32.png
```

Os arquivos de marca vieram do `Logotipo_PrimeCorp.jpg` original: só receberam fundo
transparente, recorte e redimensionamento. Nenhum traço foi redesenhado.

**1.4** Abra `https://www.primecorpimoveis.com.br`. O site deve aparecer.
Se aparecer lista de arquivos, falta o `index.html` na raiz da pasta pública.

---

## Etapa 2 — DNS e HTTPS

**2.1 DNS.** Se o domínio está registrado no Registro.br e a hospedagem é Locaweb,
os servidores DNS do domínio precisam apontar para a Locaweb. No Registro.br, em
**Alterar servidores DNS**, use os que a Locaweb informa no painel dela.
Propagação leva de 15 minutos a 24 horas.

**2.2 HTTPS.** No painel Locaweb, ative o **certificado SSL gratuito (Let's Encrypt)**
para o domínio e para o `www`. Sem cadeado, o Chrome marca "não seguro" e o formulário
perde conversão.

**2.3 Redirecionar para uma versão só.** Crie um arquivo `.htaccess` na pasta pública:

```apache
RewriteEngine On

# força HTTPS
RewriteCond %{HTTPS} !=on
RewriteRule ^(.*)$ https://%{HTTP_HOST}/$1 [R=301,L]

# força www
RewriteCond %{HTTP_HOST} ^primecorpimoveis\.com\.br$ [NC]
RewriteRule ^(.*)$ https://www.primecorpimoveis.com.br/$1 [R=301,L]

# cabeçalhos de segurança
<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
</IfModule>

# cache dos assets
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType image/svg+xml "access plus 1 month"
  ExpiresByType application/javascript "access plus 1 week"
</IfModule>
```

**Cuidado:** se a Locaweb já colocou um `.htaccess` lá, **acrescente** as linhas em vez
de sobrescrever o arquivo.

---

## Etapa 3 — Fazer o formulário chegar em vocês

Hoje o formulário mostra "Recebido" mas **não envia nada**. Escolha um caminho.

### Caminho A — rápido, sem servidor (recomendado para hoje)

Use um serviço de formulário (Formspree, Web3Forms ou similar). Crie a conta, pegue
o endpoint, e em `index.html` procure por:

```js
const ENDPOINT = "";
```

e coloque a URL que o serviço fornecer. Teste enviando um lead de verdade e confirme
que chegou no e-mail.

### Caminho B — definitivo, com o painel no ar

Quando a Etapa 4 estiver pronta, aponte para o seu próprio servidor:

```js
const ENDPOINT = "https://painel.primecorpimoveis.com.br/api/publico/leads";
```

O lead cai direto na tabela `leads` do Postgres, sem passar por terceiro — melhor para
LGPD e para o funil.

**Enquanto o formulário não estiver ligado, coloque o WhatsApp em destaque.** Lead que
não chega é comissão perdida.

---

## Etapa 4 — Painel interno

O painel já **funciona de verdade** em quatro frentes, sem depender da API:

| Tela | O que faz agora |
|---|---|
| Anúncios | Cola planilha, remove repetidos pela impressão do anúncio, cruza com os ativos e diz quais são novos |
| Avaliação | Roda o método comparativo (mediana, corte por 3·MAD, homogeneização por área) e emite o parecer pronto para copiar |
| Oportunidades | Ordena a fila por valor esperado de comissão e mostra a decomposição do score |
| Captações | Anexar autorização e **ativar mandato**, com as mesmas travas do banco |

Os dados de partida são de demonstração; a lógica é a mesma do backend
(`assets/motor.js` é o porte de `app/comparaveis.py` e `app/captacao.py`, verificado
contra os mesmos casos de teste). Trocar demonstração por dado real é substituir as
chamadas do motor por `fetch` nos endpoints — entrada e saída são idênticas.

**Isso significa que vocês podem começar a usar o painel já**, rodando localmente,
enquanto a API não sobe. O que não existe ainda é persistência: fechou o navegador,
perdeu. Por isso o banco continua sendo a Etapa 4. **Não deixe ele acessível em
`www.primecorpimoveis.com.br/painel.html`** — qualquer pessoa abre. Duas opções:

**Opção simples (hoje):** não suba o `painel.html` para a hospedagem. Use localmente
enquanto o backend não está pronto.

**Opção correta (esta semana):** o painel roda junto com a API, num servidor separado.

### Onde hospedar a API

Hospedagem compartilhada da Locaweb **não roda** Python com Postgres. Você precisa de
uma VPS. Opções que funcionam bem no Brasil:

| Onde | Custo aproximado | Observação |
|---|---|---|
| Locaweb Cloud / VPS | a partir de ~R$ 60/mês | mantém tudo no mesmo fornecedor |
| Hetzner (Alemanha) | a partir de ~€ 4/mês | mais barato, latência maior |
| DigitalOcean / Vultr | a partir de US$ 6/mês | documentação farta em português |

Escolha a menor máquina com **2 GB de RAM**. Menos que isso, o Postgres sofre.

### Subir a API

Na VPS, com Docker instalado:

```bash
git clone <seu-repositorio> primecorp   # ou envie a pasta v4/ por SCP
cd primecorp

cp .env.example .env
nano .env
```

Gere cada segredo de verdade — a aplicação **recusa iniciar** com valor fraco ou de
exemplo, e isso é proposital:

```bash
python3 -c "import secrets;print(secrets.token_urlsafe(48))"   # APP_SECRET
python3 -c "import secrets;print(secrets.token_urlsafe(32))"   # POSTGRES_PASSWORD
```

Preencha também `LIA_VERSION` (ex.: `LIA-2026-01`) — é a versão do documento de
legítimo interesse que ampara o contato com proprietário.

```bash
docker compose up -d db
docker compose logs -f db      # aguarde os scripts de db/ rodarem, Ctrl+C quando parar

# criar vocês dois como usuários
export DATABASE_URL='postgresql://primecorp:SUA_SENHA@localhost:5432/primecorp'
python3 scripts/cadastrar_equipe.py

docker compose up -d
curl http://localhost:8000/api/health
```

No primeiro login o sistema exige cadastro de MFA — instale o Google Authenticator ou
o Authy no celular antes.

### Apontar um subdomínio

No DNS do domínio, crie um registro **A** para `painel` apontando para o IP da VPS.
Ajuste `server_name` em `nginx/primecorp.conf` para `painel.primecorpimoveis.com.br`
e emita o certificado:

```bash
docker run --rm -v $(pwd)/certs:/etc/letsencrypt -p 80:80 certbot/certbot certonly \
  --standalone -d painel.primecorpimoveis.com.br --agree-tos -m seu@email.com
docker compose restart proxy
```

---

## Etapa 5 — Backup, antes de existir dado que importa

Backup que nunca foi restaurado não é backup. Configure os dois:

```bash
crontab -e
```

```cron
0 3 * * *  cd /caminho/primecorp && ./scripts/backup.sh >> /var/log/pc-backup.log 2>&1
0 4 * * 0  cd /caminho/primecorp && ./scripts/restore_test.sh >> /var/log/pc-restore.log 2>&1
```

O segundo restaura o backup mais recente num container descartável e valida.
**Se ele falhar, trate como incidente no mesmo dia.**

---

## Etapa 6 — Checklist antes de divulgar o endereço

- [ ] Site abre em `https://www.primecorpimoveis.com.br` com cadeado
- [ ] `primecorpimoveis.com.br` (sem www) redireciona para o www
- [ ] Consulta de faixa responde em município com e sem calibração
- [ ] Formulário envia e **o lead chegou** (teste com dado real)
- [ ] Os dois CRECI aparecem na capa e no rodapé
- [ ] Rodapé declara a PJ em concessão
- [ ] Abre bem no celular (teste no seu próprio aparelho)
- [ ] `painel.html` **não** está acessível publicamente
- [ ] Backup rodando e restauração testada
- [ ] Vocês dois com MFA cadastrado

---

## Etapa 7 — Primeira semana no ar

**Google Business Profile.** Cadastre a PrimeCorp. Para imobiliária, é a maior fonte
de contato local — costuma render mais que qualquer anúncio pago no começo.

**Google Search Console.** Cadastre o domínio e envie a URL para indexação. Sem isso,
o site pode levar semanas para aparecer na busca.

**Analytics.** Se for usar, escolha um que respeite a LGPD e declare no rodapé.
Sem consentimento, evite qualquer coisa que use cookie para rastrear.

---

## Onde pedir ajuda quando travar

| Sintoma | Provável causa |
|---|---|
| Site não abre, dá erro de DNS | DNS ainda propagando ou apontado para o lugar errado |
| Abre sem estilo, tudo desalinhado | pasta `assets/` não subiu ou subiu com outro nome |
| Consulta de faixa não faz nada | `municipios-sp.js` não carregou — confira o caminho |
| API não sobe, sai `[BOOT ABORTADO]` | segredo faltando ou fraco no `.env` — é proteção, leia a mensagem |
| Login diz "MFA obrigatório" | cadastre em `POST /api/auth/mfa/setup` no primeiro acesso |
| Mandato não ativa | responsável sem CRECI válido, ou falta anexar a autorização assinada |

---

## O que ainda depende de vocês, não de código

1. **Calibrar os municípios** onde forem operar de fato. Comece por Campinas e pelos
   três ou quatro vizinhos onde já têm histórico.
2. **CRECI-J.** O contrato social em ajuste é o que destrava. Assim que sair, um comando
   atualiza a organização e todos os anúncios passam a exibir o número da empresa.
3. **Renovação das inscrições PF** antes de 20/09/2026.
4. **Fotos reais dos imóveis.** As ilustrações do site são um recurso temporário digno,
   mas foto de imóvel vende; ilustração não.
