# PrimeCorp Core V4 — Sprint 1

**Tese:** intermediação imobiliária (corretagem).
**Escopo entregue:** fundação segura, PostgreSQL + PostGIS, correção dos gargalos de escrita, entidades de corretagem e conformidade LGPD/CRECI no nível do banco.

---

## O que mudou em relação à V3/V2

| Antes | Agora |
|---|---|
| Senha única em variável de ambiente, comparada em texto plano | Usuários individuais, Argon2id (m=64 MiB, t=3, p=4), MFA por TOTP |
| Fallback `primecorp` / `change-me-primecorp-v3` se o `.env` não carregasse | **Boot abortado** (exit 78) com segredo ausente, curto ou de exemplo |
| Logout apagava o cookie; o token seguia válido por 12 h | Sessão persistida e revogável; `logout-todas` mata todas de uma vez |
| Rate limit em um `Map` que nunca era expurgado | nginx na borda + lockout por conta com backoff exponencial |
| `leads.json` com read-modify-write sem lock | `INSERT` transacional no Postgres |
| `commit` por linha na importação | Uma transação por lote — **102× mais rápido** (medido) |
| `lat`/`lng` como colunas soltas | `GEOGRAPHY(POINT)` com índice GIST + polígono de parcela |
| Auditoria anônima | `audit_log` com autor, IP e detalhe em JSONB |
| Nenhuma entidade de corretagem | `mandates`, `deals`, `commissions`, com trava de CRECI no banco |
| `lawful_basis` como texto livre opcional | ENUM obrigatório + trilha de origem não-vazia + retenção + opt-out |

### Economia do ataque

**Forja de sessão.** Na V3, com o `APP_SECRET` padrão conhecido, um atacante calculava um cookie válido offline: **zero tentativas, acesso total**. Na V4 o token é aleatório e vive na tabela `sessions` — vazar o `APP_SECRET` **não permite forjar sessão**, porque a sessão precisa existir no banco.

**Força bruta online.** Com 5 tentativas/min no nginx e lockout por conta, uma senha de 12 caracteres exige da ordem de 10¹⁵ anos. Deixa de ser um vetor.

**Força bruta offline**, se o banco inteiro vazar (premissa generosa de 1.000 hashes Argon2id/s em GPU alugada a US$ 0,50/h):

| Senha | Tempo médio | Custo |
|---|---|---|
| 8 caracteres, minúsculas + dígitos | ~45 anos | ~US$ 196 mil |
| 12 caracteres, misto (mínimo do V4) | ~3·10¹¹ anos | inviável |

A V3 não tinha hash algum. Vazamento do ambiente = comprometimento instantâneo, custo zero.

---

## Instalação

```bash
cp .env.example .env

# Gere cada segredo — a aplicação recusa valores de exemplo
python -c "import secrets;print(secrets.token_urlsafe(48))"   # APP_SECRET
python -c "import secrets;print(secrets.token_urlsafe(32))"   # POSTGRES_PASSWORD

docker compose up -d db
docker compose logs -f db     # aguarde os scripts de db/ rodarem

# Migração — sempre com --dry-run primeiro
export DATABASE_URL='postgresql://primecorp:SENHA@localhost:5432/primecorp'
export LIA_VERSION='LIA-2026-01'     # obrigatório se houver contato sob legítimo interesse
python migrate/migrar.py \
  --sqlite ../primecorp_property_intelligence_v2/data/primecorp.db \
  --json   ../primecorp-imoveis-v2/data \
  --dry-run

# Primeiro usuário (não existe conta padrão)
python scripts/criar_usuario.py --email voce@primecorp.com.br \
  --nome "Seu Nome" --papeis admin,corretor \
  --creci 123456 --creci-uf SP --creci-tipo PF --creci-validade 2028-03-31

docker compose up -d
```

O primeiro login exige cadastro de MFA para os papéis `admin`, `corretor` e `juridico`.

---

## Verificação — como saber que funcionou

```bash
# 1. Boot fail-closed: sem APP_SECRET a aplicação NÃO sobe
unset APP_SECRET && python -c "from app.config import carregar_ou_abortar; carregar_ou_abortar()"
# esperado: [BOOT ABORTADO] APP_SECRET não definida.  (exit 78)

# 2. Testes de segurança
python -m pytest tests/ -q          # 28 passed

# 3. Trava de CRECI no banco — deve FALHAR
psql "$DATABASE_URL" -c "
  UPDATE mandates SET status='ativo' WHERE responsible_user_id IN
    (SELECT id FROM users WHERE creci_number IS NULL);"
# esperado: ERROR: Mandato ... sem CRECI valido (Lei 6.530/1978)

# 4. Exclusividade — o segundo mandato exclusivo ativo deve ser rejeitado
# esperado: duplicate key value violates unique constraint "uq_mandato_exclusivo"

# 5. Restauração de backup (semanal, obrigatório)
./scripts/restore_test.sh
```

---

## Estrutura

```
db/001_schema.sql          schema completo (PostGIS, corretagem, LGPD, RBAC)
db/002_seed_and_views.sql  papéis + views operacionais
app/config.py              configuração fail-closed
app/security.py            Argon2id, TOTP, sessões, backoff
app/auth.py                login, MFA, RBAC, revogação
app/db.py                  pool de conexões + auditoria
app/main.py                API: mandatos, pipeline, importação, LGPD
migrate/migrar.py          SQLite + JSON -> Postgres (idempotente, dry-run)
scripts/criar_usuario.py   bootstrap de usuário
scripts/backup.sh          pg_basebackup + WAL archiving (PITR)
scripts/restore_test.sh    validação semanal da restauração
nginx/primecorp.conf       TLS + rate limit na borda
node_patch/                correções do portal público
tests/                     28 testes, sem dependência de banco
```

---

## Decisões de projeto que valem registro

**O portal só publica imóvel com status `Em divulgação`.** Na tese de intermediação isso significa mandato assinado. O portal perde a capacidade técnica de anunciar imóvel sem autorização escrita do proprietário — a regra deixa de depender de disciplina operacional.

**Contato sem base legal não migra.** O script de migração **rejeita e relata** em vez de preencher com um valor plausível. Inventar base legal para dado pessoal é exatamente o que a LGPD proíbe; cada registro rejeitado precisa de decisão humana antes do go-live.

**O `ADMIN_TOKEN` foi eliminado, não rotacionado.** Token estático compartilhado não tem autor. Sem autor não há RBAC nem resposta a incidente.

**Score congelado na descoberta.** `score_frozen_at_discovery` é gravado na migração e nunca alterado. É o que torna possível, no Sprint 2, medir se o score prevê alguma coisa.

---

## Sprint 2 — motor de avaliação (entregue)

O motor não produz "score interno": produz o **PTAM**, o Parecer Técnico de Avaliação
Mercadológica regulamentado pela Resolução COFECI nº 1.066/2007, que todo Corretor de
Imóveis com CRECI ativo pode emitir. É o documento que se leva à mesa de captação.

| Módulo | O que faz |
|---|---|
| `app/comparaveis.py` | Mediana e MAD, corte a 3·MAD, elasticidade de área estimada por regressão log-log, saída em P10/P50/P90, mínimo de 7 elementos |
| `app/captacao.py` | Score de captação e valor esperado de comissão |
| `app/ptam.py` | Emissão do parecer, com as travas normativas |
| `app/imagens.py` | pHash-DCT + dHash, índice LSH por bandas |

### A inversão que define a tese

Na intermediação, o pior mandato **não é o imóvel caro — é o imóvel acima do mercado**.
Ele ocupa inventário, não vende e vence sem resultado. O componente de maior peso do
score (0,30) é a aderência de preço, e ele **penaliza** sobrepreço. Medido com a mesma
avaliação de base:

| Proprietário pede | Comissão bruta | VE da comissão | Destino |
|---|---:|---:|---|
| 5% abaixo do mercado | R$ 720.830 | **R$ 14.417** | Captação |
| 10% acima | R$ 834.646 | R$ 13.354 | Captação |
| 35% acima | R$ 1.024.338 | **R$ 8.195** | Abordagem com PTAM |

Comissão 42% maior, valor esperado 43% menor. O score da V3 colocaria esse mandato em
primeiro lugar na fila.

### Travas do PTAM

- Finalidade judicial, garantia bancária, fiscal ou desapropriação é **recusada**: exige
  laudo ABNT NBR 14.653, que é outro documento e outro profissional.
- Emissor com CRECI vencido é recusado — a Resolução vincula o parecer à pessoa física inscrita.
- Amostra abaixo de 7 elementos devolve "sem base comparável" em vez de inventar número.

### Ajuste de escala de área

Um terreno de 3.000 m² a R$ 800/m² não implica que um de 18.000 m² valha R$ 800/m².
Sem homogeneizar por área, avaliar ativo grande com comparável pequeno superestima o
valor de forma sistemática — o erro mais caro do setor. A elasticidade é estimada da
própria amostra quando há 12+ elementos e o resultado cai em faixa plausível; senão,
usa-se a referência da tipologia.

## Testes

```bash
./testes/rodar.sh
```

| Bateria | O quê | Quantos |
|---|---|---|
| `tests/` (pytest) | segurança, avaliação, captação, imagens, PTAM | 64 |
| `testes/motor.test.js` (jsdom) | porte JS: estatística, avaliação, captação, cruzamento, CSV | 32 |
| `testes/site.test.js` (jsdom) | seletor de município, consulta de faixa, formulário, marca | 27 |
| `testes/painel.test.js` (jsdom) | login com MFA, anúncios, avaliação, oportunidades, ativação | 46 |

Os testes de tela rodam em DOM real e já pegaram cinco defeitos que a leitura do
código não pegaria: o `<datalist>` que o Safari do iOS não implementa; uma exceção
em `scrollIntoView` que derrubava a navegação por teclado; a ordenação que trazia
Campina do Monte Alegre antes de Campinas; o cartão da consulta de faixa herdando
`color:#fff` da capa, o que deixava o texto do select branco sobre fundo claro; e
a aritmética do cruzamento de anúncios que não fechava na tela.

`testes/motor.test.js` compara o porte JavaScript contra os mesmos casos da suíte
Python. Se os dois divergirem, o painel mente para o corretor.

Para rodar os de tela é preciso `npm install jsdom` uma vez.

## Telas

`web/primecorp-console.html` — console interno: entrada com MFA, Hoje, Captações,
Ativos, Leads e Conformidade. A faixa de habilitação fica fixa no topo porque é o
único item que pode parar a operação inteira.

`web/primecorp-site.html` — site público: consulta de faixa de valor, vitrine e
captação de leads. Todo imóvel exibe o CRECI do responsável (art. 4º do Decreto
81.871/1978) e o rodapé declara a situação da PJ em concessão.

## O que ainda NÃO está entregue

- **Integração ONR/SIGEF (Sprint 3).** Depende de credencial institucional e conta
  gov.br nível prata ou ouro. Só faz sentido construir com o acesso em mãos.
- **Telas ligadas à API.** Os HTML acima usam dados de demonstração; a ligação aos
  endpoints é trabalho de integração, não de desenho.
- **Calibração dos limiares de imagem com fotos reais dos portais.** Os valores atuais
  vieram de cenas sintéticas e estão anotados no código para revisão.
- **Calibração de P(fechamento).** As taxas por estágio são conservadoras e fixas até
  haver 50+ negócios encerrados em `deal_stage_history`.

## Habilitação — situação atual

Operação habilitada por duas inscrições PF no CRECI-SP, ambas válidas até **20/09/2026**. O CRECI-J está em concessão; a responsável técnica indicada é sócia e corretora inscrita, o que atende diretamente o art. 6º, §1º da Lei 6.530/1978.

Três regras normativas passaram a viver no banco (`db/003_organizacao_e_publicidade.sql`):

| Norma | O que o banco faz |
|---|---|
| Lei 6.530/78, art. 6º, §1º | Responsável técnico da PJ precisa ter CRECI PF válido — trigger `resp_tecnico_habilitado` |
| Decreto 81.871/78, art. 4º | `creci_publicidade()` devolve o número que deve constar do anúncio; usa o PF do responsável enquanto a PJ não está ativa e troca sozinho após o deferimento |
| Decreto 81.871/78, art. 5º | Trigger `divulgacao_exige_mandato` impede status `Em divulgação` sem autorização escrita vigente |

`expirar_mandatos_vencidos()` despublica automaticamente o ativo quando a autorização vence — o anúncio não sobrevive ao mandato.

### Alerta com data

A trigger `mandato_exige_creci` bloqueia a **ativação** de mandatos a partir do vencimento da inscrição. Com validade em 20/09/2026, a renovação precisa estar concluída antes dessa data, ou a operação trava na captação. `v_habilitacao` mostra o prazo restante de PF e PJ em uma consulta.

---

*Testes de segurança executados e aprovados. Os testes de integração com Postgres dependem de uma instância real e devem rodar no ambiente de homologação.*
