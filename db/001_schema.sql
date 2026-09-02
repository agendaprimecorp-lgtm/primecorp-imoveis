-- PrimeCorp Core V4 — schema unificado
-- Tese: INTERMEDIAÇÃO IMOBILIÁRIA (corretagem)
-- Requer PostgreSQL 16+ com PostGIS 3.4+

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- busca textual por similaridade
CREATE EXTENSION IF NOT EXISTS citext;       -- e-mail case-insensitive
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. IDENTIDADE, RBAC E CRECI
-- ============================================================

CREATE TABLE roles (
  id          SMALLSERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE users (
  id                 BIGSERIAL PRIMARY KEY,
  email              CITEXT UNIQUE NOT NULL,
  full_name          TEXT NOT NULL,
  password_hash      TEXT NOT NULL,              -- Argon2id
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- MFA
  mfa_secret         TEXT,                        -- TOTP base32
  mfa_enabled        BOOLEAN NOT NULL DEFAULT false,
  mfa_enrolled_at    TIMESTAMPTZ,
  -- CRECI: obrigatório para quem intermedia
  creci_number       TEXT,
  creci_state        CHAR(2),
  creci_type         TEXT CHECK (creci_type IN ('PF','PJ')),
  creci_valid_until  DATE,
  -- controle de acesso
  is_active          BOOLEAN NOT NULL DEFAULT true,
  failed_attempts    INT NOT NULL DEFAULT 0,
  locked_until       TIMESTAMPTZ,
  last_login_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT creci_completo CHECK (
    creci_number IS NULL
    OR (creci_state IS NOT NULL AND creci_type IS NOT NULL AND creci_valid_until IS NOT NULL)
  )
);

-- CRECI ativo = número presente E dentro da validade. Usado nas constraints de mandato.
CREATE OR REPLACE FUNCTION creci_ativo(u_id BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT creci_number IS NOT NULL AND creci_valid_until >= CURRENT_DATE AND is_active
     FROM users WHERE id = u_id), false);
$$;

CREATE TABLE user_roles (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by BIGINT REFERENCES users(id),
  PRIMARY KEY (user_id, role_id)
);

-- Sessões no servidor: logout revoga de verdade (corrige P1-3)
CREATE TABLE sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT UNIQUE NOT NULL,     -- SHA-256 do token; o token cru nunca é persistido
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip           INET,
  user_agent   TEXT
);
CREATE INDEX idx_sessions_user  ON sessions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_sessions_purge ON sessions(expires_at);

CREATE TABLE login_attempts (
  id         BIGSERIAL PRIMARY KEY,
  email      CITEXT,
  ip         INET,
  success    BOOLEAN NOT NULL,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_attempts_win ON login_attempts(ip, created_at DESC);
CREATE INDEX idx_login_attempts_email ON login_attempts(email, created_at DESC);

-- ============================================================
-- 2. ATIVO PERMANENTE  (modelagem da V3 preservada — estava certa)
-- ============================================================

CREATE TYPE asset_status AS ENUM (
  'Descoberto','Triagem','Qualificado','Proprietário localizado',
  'Captação em andamento','Mandato assinado','Em divulgação',
  'Proposta recebida','Em negociação','Due diligence','Fechado','Descartado'
);

CREATE TYPE location_class AS ENUM ('INCONCLUSIVO','PROVÁVEL','ALTA CONFIANÇA','CONFIRMADO');

CREATE TABLE assets (
  id               BIGSERIAL PRIMARY KEY,
  asset_code       TEXT UNIQUE NOT NULL,
  asset_type       TEXT NOT NULL,
  title            TEXT NOT NULL DEFAULT '',
  city             TEXT,
  state            CHAR(2),
  neighborhood     TEXT,
  address          TEXT,
  postal_code      TEXT,
  geom             GEOGRAPHY(POINT, 4326),          -- substitui lat/lng cru
  parcel_geom      GEOGRAPHY(POLYGON, 4326),        -- polígono SIGEF/CAR quando houver
  land_area        NUMERIC(14,2),
  built_area       NUMERIC(14,2),
  asking_price     NUMERIC(16,2),
  status           asset_status NOT NULL DEFAULT 'Descoberto',
  location_score   SMALLINT NOT NULL DEFAULT 0 CHECK (location_score BETWEEN 0 AND 100),
  location_class   location_class NOT NULL DEFAULT 'INCONCLUSIVO',
  opportunity_score SMALLINT NOT NULL DEFAULT 0 CHECK (opportunity_score BETWEEN 0 AND 100),
  score_frozen_at_discovery SMALLINT,               -- congelado p/ backtesting (seção 4.3)
  thesis           TEXT NOT NULL DEFAULT '',
  assigned_to      BIGINT REFERENCES users(id),
  next_action      TEXT NOT NULL DEFAULT '',
  next_action_at   TIMESTAMPTZ,
  -- registro imobiliário
  matricula_number TEXT,
  matricula_cartorio TEXT,
  matricula_checked_at TIMESTAMPTZ,
  has_liens        BOOLEAN,                          -- ônus/indisponibilidade (CNIB)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_assets_geom   ON assets USING GIST (geom);
CREATE INDEX idx_assets_parcel ON assets USING GIST (parcel_geom);
CREATE INDEX idx_assets_city   ON assets(state, city);
CREATE INDEX idx_assets_status ON assets(status);
CREATE INDEX idx_assets_type_area ON assets(asset_type, land_area);   -- blocking do auto-link
CREATE INDEX idx_assets_title_trgm ON assets USING GIN (title gin_trgm_ops);

-- ============================================================
-- 3. ANÚNCIOS OBSERVADOS  (inteligência de mercado)
-- ============================================================

CREATE TABLE sources (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT UNIQUE NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('json','csv','api','manual')),
  url          TEXT,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- governança: só entra fonte com permissão declarada
  legal_basis  TEXT NOT NULL,
  contract_ref TEXT,
  last_run_at  TIMESTAMPTZ,
  last_status  TEXT,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE listings (
  id             BIGSERIAL PRIMARY KEY,
  asset_id       BIGINT REFERENCES assets(id) ON DELETE SET NULL,
  source_id      BIGINT REFERENCES sources(id),
  portal         TEXT NOT NULL DEFAULT '',
  external_id    TEXT NOT NULL DEFAULT '',
  url            TEXT,
  title          TEXT NOT NULL DEFAULT '',
  price          NUMERIC(16,2),
  raw_address    TEXT,
  raw_area       NUMERIC(14,2),
  raw_built_area NUMERIC(14,2),
  description    TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  fingerprint    TEXT NOT NULL,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  link_confidence SMALLINT,
  link_method    TEXT CHECK (link_method IN ('manual','auto','image','import')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_listings_url      ON listings(url) WHERE url IS NOT NULL;
CREATE UNIQUE INDEX uq_listings_external ON listings(portal, external_id)
  WHERE portal <> '' AND external_id <> '';
CREATE UNIQUE INDEX uq_listings_fp       ON listings(fingerprint);
CREATE INDEX idx_listings_asset  ON listings(asset_id);
CREATE INDEX idx_listings_active ON listings(is_active, last_seen_at DESC);

CREATE TABLE price_history (
  id          BIGSERIAL PRIMARY KEY,
  listing_id  BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  asset_id    BIGINT REFERENCES assets(id) ON DELETE SET NULL,
  price       NUMERIC(16,2) NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_price_listing ON price_history(listing_id, observed_at);
CREATE INDEX idx_price_asset   ON price_history(asset_id, observed_at);   -- corrige P2-3

CREATE TABLE import_runs (
  id            BIGSERIAL PRIMARY KEY,
  source_id     BIGINT REFERENCES sources(id),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'running',
  items_seen    INT NOT NULL DEFAULT 0,
  items_new     INT NOT NULL DEFAULT 0,
  items_updated INT NOT NULL DEFAULT 0,
  error         TEXT,
  triggered_by  BIGINT REFERENCES users(id)
);

-- ============================================================
-- 4. EVIDÊNCIA E IMAGENS
-- ============================================================

CREATE TABLE evidence (
  id            BIGSERIAL PRIMARY KEY,
  asset_id      BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL,
  value         TEXT NOT NULL,
  weight        SMALLINT NOT NULL DEFAULT 0,
  verified      BOOLEAN NOT NULL DEFAULT false,
  verified_by   BIGINT REFERENCES users(id),
  verified_at   TIMESTAMPTZ,
  source        TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_evidence_asset ON evidence(asset_id);

CREATE TABLE images (
  id          BIGSERIAL PRIMARY KEY,
  asset_id    BIGINT REFERENCES assets(id) ON DELETE CASCADE,
  listing_id  BIGINT REFERENCES listings(id) ON DELETE SET NULL,
  object_key  TEXT NOT NULL,              -- chave no object storage, não caminho local
  phash       BIT(64),                    -- pHash-DCT (Sprint 2)
  dhash       BIT(64),                    -- segundo canal
  ahash_legacy TEXT,                      -- preserva hash da V3 durante a transição
  kind        TEXT NOT NULL DEFAULT 'listing',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_images_asset ON images(asset_id);

-- ============================================================
-- 5. PESSOAS, LGPD E CONSENTIMENTO
-- ============================================================

CREATE TYPE lawful_basis AS ENUM (
  'consentimento','execucao_contrato','obrigacao_legal',
  'legitimo_interesse','exercicio_direitos','protecao_credito'
);

CREATE TABLE contacts (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT '',   -- proprietário, procurador, inventariante...
  phone         TEXT,
  email         CITEXT,
  document      TEXT,                        -- CPF/CNPJ (dado pessoal, nunca sensível)
  -- LGPD: trilha de origem obrigatória (corrige P1-4)
  basis         lawful_basis NOT NULL,
  source_type   TEXT NOT NULL CHECK (source_type IN
                  ('formulario_site','indicacao','matricula_onr','fonte_publica',
                   'anuncio_publico','contato_ativo_titular','feed_licenciado')),
  source_ref    TEXT NOT NULL,               -- URL/documento/protocolo — não pode ser vazio
  lia_version   TEXT,                        -- versão do LIA que ampara (quando legitimo_interesse)
  first_contact_notice_at TIMESTAMPTZ,        -- quando o aviso de origem/finalidade foi dado
  opt_out       BOOLEAN NOT NULL DEFAULT false,
  opt_out_at    TIMESTAMPTZ,
  retention_until DATE NOT NULL,              -- expurgo automático
  notes         TEXT NOT NULL DEFAULT '',
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT source_ref_nao_vazio CHECK (length(btrim(source_ref)) > 0),
  CONSTRAINT lia_obrigatorio CHECK (basis <> 'legitimo_interesse' OR lia_version IS NOT NULL)
);
CREATE INDEX idx_contacts_optout ON contacts(opt_out) WHERE opt_out = true;
CREATE INDEX idx_contacts_retention ON contacts(retention_until);

CREATE TABLE asset_contacts (
  asset_id   BIGINT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  relation   TEXT NOT NULL DEFAULT 'proprietário',
  PRIMARY KEY (asset_id, contact_id)
);

CREATE TABLE data_subject_requests (
  id           BIGSERIAL PRIMARY KEY,
  contact_id   BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  request_type TEXT NOT NULL CHECK (request_type IN
                 ('acesso','correcao','anonimizacao','eliminacao','portabilidade','revogacao','oposicao')),
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at       TIMESTAMPTZ NOT NULL,
  resolved_at  TIMESTAMPTZ,
  resolution   TEXT,
  handled_by   BIGINT REFERENCES users(id)
);

-- ============================================================
-- 6. CORRETAGEM — mandato, negócio e comissão
--    (não existia em nenhum dos dois sistemas)
-- ============================================================

CREATE TYPE mandate_type   AS ENUM ('exclusiva','simples','opcao_compra');
CREATE TYPE mandate_status AS ENUM ('rascunho','ativo','vencido','cancelado','cumprido');

CREATE TABLE mandates (
  id                 BIGSERIAL PRIMARY KEY,
  asset_id           BIGINT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  owner_contact_id   BIGINT NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  -- CRECI: a intermediação só existe com responsável habilitado
  responsible_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  mandate_type       mandate_type NOT NULL,
  status             mandate_status NOT NULL DEFAULT 'rascunho',
  asking_price       NUMERIC(16,2) NOT NULL CHECK (asking_price > 0),
  commission_pct     NUMERIC(5,3) NOT NULL CHECK (commission_pct > 0 AND commission_pct <= 20),
  starts_on          DATE NOT NULL,
  ends_on            DATE NOT NULL,
  signed_at          TIMESTAMPTZ,
  signed_doc_key     TEXT,                     -- autorização escrita arquivada
  created_by         BIGINT NOT NULL REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT prazo_valido CHECK (ends_on > starts_on),
  -- mandato ativo exige documento assinado
  CONSTRAINT ativo_exige_assinatura CHECK (
    status <> 'ativo' OR (signed_at IS NOT NULL AND signed_doc_key IS NOT NULL))
);
-- exclusividade: no máximo um mandato exclusivo ativo por ativo
CREATE UNIQUE INDEX uq_mandato_exclusivo ON mandates(asset_id)
  WHERE mandate_type = 'exclusiva' AND status = 'ativo';
CREATE INDEX idx_mandates_status ON mandates(status, ends_on);

-- Trava de CRECI no banco: nenhum mandato ativo sem responsável habilitado.
CREATE OR REPLACE FUNCTION trg_mandato_exige_creci() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'ativo' AND NOT creci_ativo(NEW.responsible_user_id) THEN
    RAISE EXCEPTION
      'Mandato % nao pode ficar ativo: responsavel % sem CRECI valido (Lei 6.530/1978).',
      NEW.id, NEW.responsible_user_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER mandato_exige_creci
  BEFORE INSERT OR UPDATE ON mandates
  FOR EACH ROW EXECUTE FUNCTION trg_mandato_exige_creci();

CREATE TYPE deal_stage AS ENUM (
  'proposta','contraproposta','aceita','contrato','due_diligence','escritura','concluido','perdido'
);

CREATE TABLE deals (
  id               BIGSERIAL PRIMARY KEY,
  mandate_id       BIGINT NOT NULL REFERENCES mandates(id) ON DELETE RESTRICT,
  buyer_contact_id BIGINT REFERENCES contacts(id),
  stage            deal_stage NOT NULL DEFAULT 'proposta',
  offer_price      NUMERIC(16,2) CHECK (offer_price > 0),
  closed_price     NUMERIC(16,2),
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at        TIMESTAMPTZ,
  lost_reason      TEXT,
  owner_user_id    BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_deals_stage ON deals(stage, opened_at DESC);

-- Histórico de transição de estágio — insumo da calibração de P(fechamento)
CREATE TABLE deal_stage_history (
  id         BIGSERIAL PRIMARY KEY,
  deal_id    BIGINT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage deal_stage,
  to_stage   deal_stage NOT NULL,
  changed_by BIGINT REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stage_hist ON deal_stage_history(deal_id, changed_at);

CREATE TABLE commissions (
  id            BIGSERIAL PRIMARY KEY,
  deal_id       BIGINT NOT NULL REFERENCES deals(id) ON DELETE RESTRICT,
  gross_amount  NUMERIC(16,2) NOT NULL CHECK (gross_amount >= 0),
  splits        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- rateio entre corretores/parceiros
  due_at        DATE,
  received_at   DATE,
  invoice_ref   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_commissions_open ON commissions(received_at) WHERE received_at IS NULL;

-- ============================================================
-- 7. LEADS DO PORTAL  (migra o leads.json — corrige P0-2)
-- ============================================================

CREATE TABLE leads (
  id          BIGSERIAL PRIMARY KEY,
  stage       TEXT NOT NULL DEFAULT 'Novo',
  purpose     TEXT,                    -- comprador / vendedor / investidor
  name        TEXT NOT NULL,
  phone       TEXT,
  email       CITEXT,
  location    TEXT,
  message     TEXT,
  asset_id    BIGINT REFERENCES assets(id) ON DELETE SET NULL,
  contact_id  BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  source      TEXT NOT NULL DEFAULT 'site',
  utm         JSONB NOT NULL DEFAULT '{}'::jsonb,
  assigned_to BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contato_minimo CHECK (phone IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX idx_leads_stage ON leads(stage, created_at DESC);

-- ============================================================
-- 8. AUDITORIA  (agora com autor — antes era anônima)
-- ============================================================

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    BIGINT REFERENCES users(id),
  entity      TEXT NOT NULL,
  entity_id   BIGINT,
  action      TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip          INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id, created_at DESC);
CREATE INDEX idx_audit_actor  ON audit_log(actor_id, created_at DESC);

-- ============================================================
-- 9. updated_at automático
-- ============================================================

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','assets','mandates','leads'] LOOP
    EXECUTE format(
      'CREATE TRIGGER touch_%1$s BEFORE UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t);
  END LOOP;
END $$;

COMMIT;
