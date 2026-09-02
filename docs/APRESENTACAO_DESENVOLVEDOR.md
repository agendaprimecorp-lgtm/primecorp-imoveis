# PrimeCorp Imóveis — Estado do projeto e escopo de finalização

**Documento para apresentação a desenvolvedor.**
Versão do pacote: V4 · Data: 20/08/2026

---

## 1. O que é o produto

Plataforma de intermediação imobiliária (corretagem) para o Estado de São Paulo, com foco
em áreas industriais, galpões, terrenos e imóveis de alto padrão. **Somente venda.**

Três peças que andam juntas:

| Peça | Público | Função |
|---|---|---|
| **Site** | Externo | Captação de proprietários e compradores. Vitrine e consulta de valor. |
| **Painel** | Interno (2 corretores) | Mandatos, avaliação, PTAM, pipeline de comissão, conformidade. |
| **Radar** | Interno, não exposto | Varredura de anúncios, agrupamento entre anunciantes, reconstrução de endereço e detecção de imóvel desassistido. |

**Diferencial do produto.** Não é um CRM de imobiliária. O núcleo é um motor de avaliação
por comparáveis que produz o **PTAM** (Parecer Técnico de Avaliação Mercadológica,
Resolução COFECI 1.066/2007) — o documento que se leva à mesa de captação — e um Radar que
identifica proprietários mal servidos por outros corretores.

**Regra de negócio que inverte o padrão do setor:** o pior mandato não é o imóvel caro, é o
imóvel **acima do mercado**. Ele ocupa inventário, não vende e vence sem resultado. A
priorização é por valor esperado de comissão, e o componente de maior peso (0,30) penaliza
sobrepreço. Um ativo com a maior comissão bruta da carteira pode ficar em terceiro na fila.

---

## 2. Stack

| Camada | Tecnologia | Situação |
|---|---|---|
| Banco | PostgreSQL 16 + PostGIS 3.4 | Schema pronto, não provisionado |
| API | Python 3.12 · FastAPI · psycopg 3 (pool) | 20 rotas implementadas |
| Auth | Argon2id · TOTP · sessões em banco · RBAC | Implementado, sem teste de integração |
| Fila | Redis (declarado no compose) | **Não implementado** |
| Front | HTML/CSS/JS sem framework, sem build | Funcional |
| Proxy | nginx · TLS · rate limit na borda | Config pronta |
| Infra | Docker Compose | Pronto, não testado em servidor real |

**Decisão consciente:** front sem framework e sem etapa de build. São dois arquivos que
sobem por FTP. Trocar por React/Vue é opção do dev, não necessidade — e adiciona pipeline
de build a um time que não tem quem mantenha.

---

## 3. Inventário do que está pronto

### 3.1 Banco de dados — `db/` (750 linhas SQL)

22 tabelas, 6 views operacionais, 11 funções e triggers.

Entidades: `users`, `roles`, `user_roles`, `sessions`, `login_attempts`, `organizacao`,
`assets`, `listings`, `sources`, `price_history`, `import_runs`, `evidence`, `images`,
`contacts`, `asset_contacts`, `data_subject_requests`, `mandates`, `deals`,
`deal_stage_history`, `commissions`, `leads`, `audit_log`.

**Conformidade embutida no banco, não na aplicação:**

| Norma | Implementação |
|---|---|
| Lei 6.530/78, art. 6º §1º | Trigger `resp_tecnico_habilitado` — PJ exige responsável com CRECI PF válido |
| Decreto 81.871/78, art. 4º | Função `creci_publicidade()` — devolve a inscrição que deve constar do anúncio; usa a PF enquanto a PJ está em concessão e troca sozinha no deferimento |
| Decreto 81.871/78, art. 5º | Trigger `divulgacao_exige_mandato` — ativo não entra em divulgação sem autorização escrita vigente |
| LGPD | `contacts.source_ref` não aceita vazio; `lia_version` obrigatória sob legítimo interesse; `retention_until` obrigatório; opt-out propagado |

Isso é decisão de arquitetura: **regra que vive em consulta é regra que alguém contorna.**
O dev deve preservar esse padrão.

### 3.2 API — `app/` (2.190 linhas Python)

| Módulo | Responsabilidade |
|---|---|
| `config.py` | Configuração fail-closed. Aborta o boot (exit 78) com segredo ausente, curto ou de exemplo conhecido |
| `security.py` | Argon2id (m=64 MiB, t=3, p=4), TOTP, tokens de sessão com HMAC, lockout com backoff exponencial até 24 h |
| `auth.py` | Login, MFA, RBAC por papel, revogação de sessão, `exigir_creci` |
| `db.py` | Pool de conexões, transação por unidade de trabalho, auditoria com autor |
| `comparaveis.py` | Motor de avaliação: mediana e MAD, corte a 3·MAD, elasticidade de área por regressão log-log, saída P10/P50/P90 |
| `captacao.py` | Score de captação e valor esperado de comissão |
| `ptam.py` | Emissão do parecer com as travas normativas |
| `imagens.py` | pHash-DCT + dHash, índice LSH por bandas |
| `avaliacao_api.py` | Rotas de avaliação, PTAM e fila de captação |
| `main.py` | Cabeçalhos de segurança, mandatos, importação em lote, LGPD |

**20 rotas.** Autenticação, MFA, mandatos, pipeline, importação CSV, avaliação, PTAM,
captação, LGPD, conformidade.

### 3.3 Front — `web/` (2.425 linhas + 645 no motor)

**Site (`index.html`).** 16 tipologias × 645 municípios de SP (base IBGE, com código
municipal). Seletor de município próprio — o `<datalist>` do HTML não funciona no Safari do
iOS e o campo ficava mudo no iPhone. Vitrine com CRECI por imóvel. Formulário com validação
e consentimento LGPD. Rodapé legal. Schema.org `RealEstateAgent`.

**Painel (`painel.html`).** Nove telas: Hoje, Captações, Ativos, Leads, Radar, Anúncios,
Avaliação, Oportunidades, Conformidade.

**Motor (`assets/motor.js`).** Porte JavaScript de `comparaveis.py` e `captacao.py`, mais o
Radar. Permite o painel operar antes da API existir. Verificado contra os mesmos casos de
teste do Python — se divergirem, o painel mente para o corretor.

### 3.4 Radar — o módulo diferencial

Pipeline, em ordem:

1. **Filtro de finalidade.** Locação é descartada na entrada.
2. **Deduplicação.** Impressão do anúncio (portal + id + caminho da URL + título + endereço
   + área). Ignora parâmetro de rastreio, então o mesmo anúncio vindo por e-mail não duplica.
3. **Agrupamento entre anunciantes.** A chave é a **metragem**, não o endereço nem o preço.
   Decisão deliberada: preço e endereço são exatamente os campos que o corretor desalinhado
   erra. Exigi-los como confirmação fazia o radar perder o caso que existe para encontrar —
   testado com três anúncios do mesmo terreno de 18.400 m² com preços variando 19% e três
   endereços diferentes; a versão anterior criava dois imóveis distintos.
4. **Triangulação de endereço.** Frequência dos termos entre anunciantes; o repetido vence.
   Saída classificada em convergente / parcial / divergente / anunciante único.
5. **Índice de desassistência (0–100).** Meses no mercado, ausência de foto, descrição
   vazia, preço não informado, metragem ausente, **divergência de preço entre corretores**
   e divergência de endereço.

Índice alto = proprietário mal servido = alvo de captação.

### 3.5 Qualidade

**193 testes automatizados, todos passando.** `./testes/rodar.sh`

| Bateria | Escopo | Testes |
|---|---|---|
| `tests/` (pytest) | Segurança, avaliação, captação, imagens, PTAM | 64 |
| `testes/motor.test.js` (jsdom) | Porte JS: estatística, avaliação, captação, cruzamento, radar, CSV | 50 |
| `testes/site.test.js` (jsdom) | Seletor de município, consulta de faixa, formulário, marca | 27 |
| `testes/painel.test.js` (jsdom) | Login, radar, anúncios, avaliação, oportunidades, ativação de mandato | 52 |

Os testes de tela rodam em DOM real e já capturaram seis defeitos que revisão de código não
pegaria: `<datalist>` inoperante no iOS; exceção em `scrollIntoView` derrubando navegação por
teclado; ordenação alfabética trazendo Campina do Monte Alegre antes de Campinas; herança de
`color:#fff` deixando texto de campo branco sobre fundo claro; aritmética do cruzamento que
não fechava na tela; e o agrupamento do radar descrito acima.

### 3.6 Infraestrutura e operação

`docker-compose.yml` (PostGIS, API, Redis, nginx), `Dockerfile` (usuário não-root,
healthcheck), `nginx/primecorp.conf` (TLS 1.2/1.3, rate limit de 5/min no login),
`scripts/backup.sh` (pg_basebackup + WAL archiving para PITR),
`scripts/restore_test.sh` (restaura em container descartável e valida — roda semanal),
`migrate/migrar.py` (SQLite V3 + JSON V2 → Postgres, idempotente, com `--dry-run`).

---

## 4. O que falta

### 4.1 Bloqueadores de ativação — sem isso não vai ao ar

| # | Item | Esforço | Observação |
|---|---|---|---|
| B1 | **Endpoint de recebimento de leads** | 2 h | O formulário valida e mostra "Recebido", mas `ENDPOINT` está vazio. Hoje o site não gera nada. |
| B2 | **Provisionar VPS + subir stack Docker** | 3 h | 2 GB de RAM mínimo. Hospedagem compartilhada não roda Postgres + Python. |
| B3 | **DNS, subdomínio `painel` e certificados** | 2 h | Site na Locaweb, painel na VPS. Certbot já previsto no guia. |
| B4 | **Cron de backup + teste de restauração** | 1 h | Scripts prontos, falta agendar. |
| B5 | **Não publicar `painel.html` na hospedagem do site** | — | Em `www.primecorpimoveis.com.br/painel.html` qualquer pessoa abre o pipeline. Decisão de deploy, não de código. |

### 4.2 Desenvolvimento — para o painel virar sistema

| # | Item | Esforço | Observação |
|---|---|---|---|
| D1 | **Ligar o painel à API** | 16 h | Hoje o painel opera com dados em memória e perde tudo ao fechar. Substituir chamadas do `Motor` por `fetch`; entrada e saída já são idênticas às da API. |
| D2 | **Persistir a varredura do Radar** | 12 h | Tabelas de anúncio e grupo, histórico de varredura, evolução do índice de desassistência ao longo do tempo. |
| D3 | **CRUD completo de ativos, contatos e negócios** | 20 h | A API tem mandatos, importação e avaliação. Falta o resto do ciclo. |
| D4 | **Fila assíncrona (Redis + worker)** | 8 h | Declarada no compose, não implementada. Geocodificação, hash de imagem e importação grande precisam sair do ciclo de requisição. |
| D5 | **Upload e armazenamento de imagens** | 8 h | `images` prevê `object_key` em object storage. Falta o upload e o bucket. |
| D6 | **Índice de imagem no pgvector** | 6 h | `imagens.py` tem pHash-DCT e LSH em memória. Em produção precisa de HNSW no banco. |
| D7 | **Exportação do PTAM em PDF** | 6 h | Hoje sai em texto para copiar. Falta o documento assinável, com a marca. |
| D8 | **Painel responsivo revisado** | 6 h | Funciona no celular, mas tabelas largas exigem rolagem horizontal. |

### 4.3 Integrações — dependem de acesso contratado, não de código

| # | Fonte | Para quê | Pendência |
|---|---|---|---|
| I1 | **Feed licenciado de portal** | Ingestão de anúncios em volume | **Contrato comercial.** Raspagem de ZAP/VivaReal/OLX viola os termos, dá bloqueio e não foi implementada por decisão. |
| I2 | **ONR / SREI** | Matrícula, pesquisa de bens, monitor registral | Cadastro institucional. Cobrança por consulta, tabela de custas estadual. Exige controle de custo por gatilho de score. |
| I3 | **CNIB** | Indisponibilidade de bens | Consulta pública, falta o conector. |
| I4 | **SIGEF / INCRA e CAR** | Polígono georreferenciado de imóvel rural; restrição ambiental | Conta gov.br nível prata ou ouro. Webservices OGC (WMS/WFS). |
| I5 | **Google Maps Platform** | Geocodificação e entorno | Conta Google Cloud, chave e orçamento. |
| I6 | **Dados abertos municipais (IPTU/ITBI)** | Preço de transação real, superior a preço de oferta | Levantamento município a município. |

**I1 e I2 são os que mais mudam o produto.** Sem eles o Radar depende de pesquisa manual —
o que funciona, mas não escala.

### 4.4 Análise e decisão — precisam de dado real, não de código

| # | Item | Depende de |
|---|---|---|
| A1 | **Calibrar `web/assets/calibracao.js`** | Pesquisa própria por município e tipologia. Está vazio de propósito: publicar R$/m² inventado sob o CRECI dos sócios é exposição real. Enquanto vazio, o site convida a pedir o parecer — e converte. |
| A2 | **Recalibrar limiares de deduplicação de imagem** | Fotos reais dos portais. Os valores atuais (pHash 38%, dHash 36%) vieram de cenas sintéticas e estão anotados no código. |
| A3 | **Calibrar P(fechamento) por estágio** | 50+ negócios encerrados em `deal_stage_history`. Hoje são taxas conservadoras fixas. |
| A4 | **Backtesting do score de captação** | O score é congelado na descoberta (`score_frozen_at_discovery`) justamente para permitir isso. Sem componente circular, é testável por AUC. |
| A5 | **Validar elasticidades de área por tipologia** | Amostra local. Hoje usa referência quando há menos de 12 comparáveis. |

### 4.5 Correções e riscos conhecidos

| # | Item | Gravidade |
|---|---|---|
| C1 | **Sem teste de integração contra Postgres real** | Alta. As 64 provas do backend são unitárias; triggers e constraints nunca rodaram em banco de verdade. Primeira tarefa do dev. |
| C2 | **Marca em bitmap, não vetor** | Média. Suficiente para web; para gráfica é preciso o AI/EPS/SVG do designer. |
| C3 | **Fotos dos imóveis são ilustrações SVG** | Média. Recurso temporário. Foto de imóvel vende. |
| C4 | **Sem monitoramento nem alerta** | Média. Nada avisa se a API cair. |
| C5 | **Sem ambiente de homologação** | Média. Hoje seria deploy direto em produção. |
| C6 | **Migração rejeita contatos sem base legal** | Baixa, por decisão. Registros rejeitados exigem decisão humana antes do go-live — inventar base legal é o que a LGPD proíbe. |

---

## 5. Sequência recomendada

| Fase | Conteúdo | Prazo |
|---|---|---|
| **Fase 0 — Site no ar** | B1, B3 (parcial), B5 | 1 dia |
| **Fase 1 — Fundação** | B2, B4, C1 | 3 dias |
| **Fase 2 — Painel real** | D1, D3 | 2 semanas |
| **Fase 3 — Radar persistente** | D2, D4, D5, D6 | 2 semanas |
| **Fase 4 — Dados proprietários** | I2, I3, I4, I5 | 3 semanas, condicionado ao acesso |
| **Fase 5 — Calibração** | A1 a A5, D7 | contínuo |

**A Fase 0 pode sair hoje** e já começa a gerar lead. Não depende das demais.

---

## 6. Critérios de aceite

**Fase 0**
- Site abre em `https://www.primecorpimoveis.com.br` com certificado válido
- Sem `www` redireciona para com `www`
- Lead de teste enviado pelo formulário chega no e-mail da equipe
- Seletor de município abre e busca no Safari do iOS
- Os dois CRECI aparecem na capa e no rodapé
- `painel.html` retorna 404 no domínio do site

**Fase 1**
- `docker compose up -d` sobe banco, API e proxy
- `GET /api/health` responde 200 com a versão do PostGIS
- Boot aborta com exit 78 se `APP_SECRET` estiver ausente ou fraco
- Login exige MFA para papéis admin, corretor e jurídico
- `UPDATE mandates SET status='ativo'` com responsável sem CRECI válido **falha** com a mensagem da Lei 6.530
- Segundo mandato exclusivo ativo no mesmo ativo **falha** por unique constraint
- `./scripts/restore_test.sh` conclui com "RESTORE VALIDADO"
- `./testes/rodar.sh` verde

**Fase 2**
- Fechar e reabrir o navegador preserva mandatos, avaliações e leads
- PTAM emitido fica registrado em `audit_log` com autor e número sequencial
- Ativo sem mandato assinado não entra em `Em divulgação` — erro do banco, não do front

**Fase 3**
- Varredura do Radar persiste e o índice de desassistência tem série histórica
- Importação de 10 mil anúncios não bloqueia a interface

---

## 7. O que o desenvolvedor precisa receber

**Acessos**
- Painel da hospedagem (Locaweb) e FTP
- Registro.br, para DNS
- Provedor de VPS, quando contratado
- Repositório Git (o pacote ainda não está versionado — criar é a primeira tarefa)

**Informações**
- Razão social e CNPJ, para `scripts/cadastrar_equipe.py`
- E-mail de destino dos leads
- Se há feed de portal contratado (muda toda a Fase 4)
- Versão vetorial da marca, se existir

**Arquivos do pacote**
```
README.md                            visão geral, instalação e execução
docs/COMECE_AQUI.md                  guia de operação e publicação, passo a passo
docs/DEPLOY.md                       detalhamento técnico do deploy
docs/ARQUITETURA.md                  decisões de projeto e defeitos corrigidos
docs/APRESENTACAO_DESENVOLVEDOR.md   este documento
app/  db/  migrate/  scripts/  nginx/  tests/  testes/  web/
```

---

## 8. Duas restrições que não são negociáveis

**Raspagem de portal.** ZAP, VivaReal, OLX e Imovelweb proíbem em contrato. Além do bloqueio
técnico, em escala vira exposição jurídica — e inviabiliza vender o produto a investidor
institucional. A ingestão é por feed licenciado, arquivo ou pesquisa manual. Se o dev propuser
scraper, é decisão de negócio, não técnica.

**Publicidade sem inscrição e sem mandato.** O art. 4º do Decreto 81.871/78 exige o número do
CRECI em toda propaganda; o art. 5º só permite anunciar com autorização escrita. Ambos estão
travados no banco por trigger. Remover essas travas para "facilitar o cadastro" transfere um
risco regulatório para a operação. Não devem ser removidas.

---

## 9. Situação regulatória atual

- Dois corretores PF ativos no CRECI-SP, inscrições **300760** e **297692**
- Validade **20/09/2026**, renovação protocolada
- **CRECI-J em concessão** — contrato social em ajuste para nomear a responsável técnica
- Enquanto a PJ não sai, a publicidade roda sob o CRECI PF do responsável por cada mandato.
  A troca para o número da empresa é automática: basta atualizar a situação na tabela
  `organizacao` e todos os anúncios passam a exibir a inscrição nova.
