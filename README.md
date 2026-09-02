# PrimeCorp Imóveis — Plataforma de Intermediação

Plataforma de intermediação imobiliária (corretagem) para o Estado de São Paulo, com foco
em áreas industriais, galpões, terrenos e imóveis de alto padrão. **Somente venda.**

O sistema tem três peças que rodam juntas:

| Peça | Público | Função |
|---|---|---|
| **Site** | Externo | Captação de proprietários e compradores. Vitrine e consulta preliminar de valor. |
| **Painel** | Interno | Mandatos, avaliação, emissão de PTAM, pipeline de comissão e conformidade. |
| **Radar** | Interno, não exposto | Varredura de anúncios, agrupamento do mesmo imóvel entre anunciantes diferentes, reconstrução de endereço e detecção de imóvel desassistido. |

---

## O que o diferencia

Não é um CRM de imobiliária. O núcleo é um **motor de avaliação por comparáveis** que
produz o PTAM — Parecer Técnico de Avaliação Mercadológica, regulamentado pela Resolução
COFECI nº 1.066/2007 — e um **Radar** que identifica proprietários mal servidos por outros
corretores.

**Regra de negócio que inverte o padrão do setor:** o pior mandato não é o imóvel caro, é o
imóvel **acima do mercado**. Ele ocupa inventário, não vende e vence sem resultado. A
priorização é por valor esperado de comissão, e o componente de maior peso (0,30) penaliza
sobrepreço — um ativo com a maior comissão bruta da carteira pode ficar em terceiro na fila.

**Conformidade no banco, não na aplicação.** Regra que vive em consulta é regra que alguém
contorna. Por isso as exigências legais são triggers e constraints do PostgreSQL:

| Norma | Implementação |
|---|---|
| Lei 6.530/78, art. 6º §1º | PJ exige responsável técnico com CRECI PF válido |
| Decreto 81.871/78, art. 4º | Função devolve a inscrição que deve constar de cada anúncio |
| Decreto 81.871/78, art. 5º | Imóvel não entra em divulgação sem autorização escrita vigente |
| LGPD | Contato sem trilha de origem ou base legal é rejeitado na entrada |

---

## Tecnologias

**Backend** — Python 3.12 · FastAPI · psycopg 3 (pool) · Argon2id · pyotp (TOTP) · Pillow
**Banco** — PostgreSQL 16 + PostGIS 3.4 + pg_trgm + pgcrypto
**Frontend** — HTML, CSS e JavaScript sem framework e sem etapa de build
**Infraestrutura** — Docker Compose · nginx (TLS e rate limit na borda) · Redis (previsto)
**Testes** — pytest (backend) · jsdom (telas e motor)
**Documentos** — WeasyPrint (geração de PDF)

O front não usa framework por decisão: são arquivos estáticos que sobem por FTP, sem
pipeline de build para manter. Trocar por React ou Vue é opção, não necessidade.

---

## Instalação

Requisitos: Docker e Docker Compose. Para rodar os testes, Python 3.12 e Node 18+.

```bash
git clone https://github.com/SEU-USUARIO/primecorp-imoveis.git
cd primecorp-imoveis
cp .env.example .env
```

Preencha o `.env` (seção abaixo) e suba:

```bash
docker compose up -d db
docker compose logs -f db      # aguarde os scripts de db/ rodarem
docker compose up -d
curl http://localhost:8000/api/health
```

Cadastro do primeiro usuário — **não existe conta padrão embutida no código**:

```bash
export DATABASE_URL='postgresql://primecorp:SUA_SENHA@localhost:5432/primecorp'
python3 scripts/cadastrar_equipe.py
```

MFA é obrigatório para os papéis `admin`, `corretor` e `juridico`. Tenha um aplicativo
autenticador no celular antes do primeiro login.

---

## Variáveis de ambiente

Copie de `.env.example`. **Nenhum valor real vai para o repositório.**

| Variável | Obrigatória | Descrição |
|---|---|---|
| `AMBIENTE` | sim | `producao`, `homologacao` ou `desenvolvimento` |
| `APP_SECRET` | sim | Segredo da aplicação, mínimo 32 caracteres |
| `POSTGRES_PASSWORD` | sim | Senha do banco |
| `DATABASE_URL` | sim | String de conexão; em produção precisa declarar `sslmode` |
| `COOKIE_SECURE` | sim | `1` em produção; `0` é recusado no boot |
| `SESSION_HORAS` | não | Validade da sessão, padrão 8 |
| `MAX_LOGIN_ATTEMPTS` | não | Tentativas antes do bloqueio, padrão 5 |
| `LOCKOUT_MINUTES` | não | Bloqueio inicial, padrão 15, com backoff até 24 h |
| `LOGIN_RATE_PER_IP` | não | Limite por IP na janela de 15 minutos |
| `MFA_OBRIGATORIO_PARA` | não | Papéis que exigem segundo fator |
| `LIA_VERSION` | condicional | Versão do LIA; obrigatória se houver contato sob legítimo interesse |
| `GOOGLE_MAPS_API_KEY` | não | Geocodificação |
| `ALLOW_PRIVATE_FEEDS` | não | Sempre `0` em produção (proteção contra SSRF) |

Gere cada segredo com:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

**A aplicação recusa iniciar** (exit 78) com segredo ausente, curto ou igual a um valor de
exemplo conhecido. Isso é proposital: a versão anterior subia com credencial padrão
publicada, e qualquer pessoa podia forjar sessão.

---

## Executar em desenvolvimento

```bash
# banco em contêiner, API no host
docker compose up -d db
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Documentação interativa da API em `http://localhost:8000/docs`.

O front é estático — abra `web/index.html` e `web/painel.html` direto no navegador, ou
sirva a pasta:

```bash
python3 -m http.server 5500 --directory web
```

### Testes

```bash
./testes/rodar.sh
```

| Bateria | Escopo | Testes |
|---|---|---|
| `tests/` (pytest) | Segurança, avaliação, captação, imagens, PTAM | 64 |
| `testes/motor.test.js` | Porte JS: estatística, avaliação, captação, radar, CSV | 50 |
| `testes/site.test.js` | Seletor de município, consulta de faixa, formulário | 27 |
| `testes/painel.test.js` | Login, radar, anúncios, avaliação, ativação de mandato | 52 |

Para os testes de tela, uma vez: `npm install jsdom`.

`testes/motor.test.js` compara o porte JavaScript contra os mesmos casos da suíte Python.
Se os dois divergirem, o painel mente para o corretor.

---

## Build

**Front:** não há etapa de build. Os arquivos de `web/` são o artefato final e sobem como
estão. Para produção, envie `index.html` e a pasta `assets/` para a hospedagem.
**Não publique `painel.html` junto com o site** — ele vai no subdomínio protegido.

**API:**

```bash
docker compose build
docker compose up -d
```

**Documento de apresentação em PDF:**

```bash
python3 scripts/gerar_apresentacao_pdf.py
```

---

## Estrutura

```
.
├── app/                    API FastAPI
│   ├── config.py           configuração fail-closed
│   ├── security.py         Argon2id, TOTP, sessões, backoff
│   ├── auth.py             login, MFA, RBAC, revogação
│   ├── db.py               pool de conexões e auditoria
│   ├── comparaveis.py      motor de avaliação (mediana, MAD, elasticidade)
│   ├── captacao.py         score de captação e valor esperado
│   ├── ptam.py             emissão do parecer com travas normativas
│   ├── imagens.py          pHash-DCT, dHash e índice LSH
│   ├── avaliacao_api.py    rotas de avaliação, PTAM e fila
│   └── main.py             mandatos, importação, LGPD, cabeçalhos
├── db/                     schema, views, triggers e seeds
├── migrate/                migração SQLite/JSON para PostgreSQL
├── scripts/                usuários, backup, teste de restauração, PDF
├── nginx/                  TLS e rate limit na borda
├── web/                    site, painel e assets
│   ├── index.html          site público
│   ├── painel.html         console interno
│   └── assets/             marca, motor.js, municípios, calibração
├── tests/                  suíte pytest
├── testes/                 suítes jsdom e rodar.sh
├── node_patch/             correções do portal Node anterior
└── docs/                   guias de operação, deploy e arquitetura
```

---

## Documentação

| Arquivo | Para quê |
|---|---|
| `docs/COMECE_AQUI.md` | Guia de operação e publicação, passo a passo |
| `docs/APRESENTACAO_DESENVOLVEDOR.md` | Estado do projeto, escopo de finalização e critérios de aceite |
| `docs/DEPLOY.md` | Detalhamento técnico do deploy |
| `docs/ARQUITETURA.md` | Decisões de projeto e histórico dos defeitos corrigidos |

---

## Restrições que não são negociáveis

**Raspagem de portal.** ZAP, VivaReal, OLX e Imovelweb proíbem em contrato. Além do bloqueio
técnico, em escala vira exposição jurídica. A ingestão é por feed licenciado, arquivo ou
pesquisa manual. Não há scraper neste repositório, por decisão.

**Travas de publicidade.** O art. 4º do Decreto 81.871/78 exige o número do CRECI em toda
propaganda; o art. 5º só permite anunciar com autorização escrita. Ambos são triggers do
banco. Removê-los para "facilitar o cadastro" transfere risco regulatório para a operação.

---

## Licença

Projeto proprietário. Todos os direitos reservados à PrimeCorp Imóveis.
