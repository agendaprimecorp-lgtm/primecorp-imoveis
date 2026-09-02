-- PrimeCorp Core V4 — 003: organização, habilitação e regra de publicidade
--
-- Base normativa embutida neste arquivo:
--   Lei 6.530/1978, art. 6º, §1º  — a PJ inscrita deve ter como sócio gerente
--       ou diretor um Corretor de Imóveis individualmente inscrito.
--   Decreto 81.871/1978, art. 4º  — o número de inscrição consta obrigatoriamente
--       de TODA propaganda e de qualquer impresso da atividade profissional.
--   Decreto 81.871/1978, art. 5º  — só pode anunciar publicamente quem tiver
--       contrato escrito de mediação ou autorização escrita para alienação.
--
-- Enquanto o CRECI-J estiver em concessão, a publicidade roda sob o CRECI PF
-- do responsável. O sistema resolve isso sozinho: ninguém precisa lembrar.

BEGIN;

-- ============================================================
-- 1. Organização e habilitação PJ
-- ============================================================

CREATE TYPE creci_pj_situacao AS ENUM ('inexistente','em_concessao','ativo','suspenso','cancelado');

CREATE TABLE organizacao (
  id                    SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- linha única
  razao_social          TEXT NOT NULL,
  nome_fantasia         TEXT NOT NULL,
  cnpj                  TEXT,
  creci_pj_numero       TEXT,
  creci_pj_uf           CHAR(2),
  creci_pj_situacao     creci_pj_situacao NOT NULL DEFAULT 'inexistente',
  creci_pj_validade     DATE,
  creci_pj_protocolo    TEXT,          -- protocolo do pedido em concessão
  creci_pj_solicitado_em DATE,
  responsavel_tecnico_id BIGINT REFERENCES users(id),
  atualizado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pj_ativo_completo CHECK (
    creci_pj_situacao <> 'ativo'
    OR (creci_pj_numero IS NOT NULL AND creci_pj_uf IS NOT NULL
        AND creci_pj_validade IS NOT NULL AND responsavel_tecnico_id IS NOT NULL)
  )
);

-- Art. 6º, §1º: o responsável técnico precisa ser corretor PF habilitado.
CREATE OR REPLACE FUNCTION trg_resp_tecnico_habilitado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.responsavel_tecnico_id IS NOT NULL
     AND NOT creci_ativo(NEW.responsavel_tecnico_id) THEN
    RAISE EXCEPTION
      'Responsavel tecnico % nao possui CRECI PF valido (Lei 6.530/1978, art. 6o, par. 1o).',
      NEW.responsavel_tecnico_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER resp_tecnico_habilitado
  BEFORE INSERT OR UPDATE ON organizacao
  FOR EACH ROW EXECUTE FUNCTION trg_resp_tecnico_habilitado();

-- ============================================================
-- 2. Art. 4º — qual CRECI deve aparecer no anúncio
-- ============================================================

-- Enquanto a PJ não está ativa, a publicidade sai sob o CRECI PF do
-- responsável pelo mandato. Depois do deferimento, passa a sair sob o
-- CRECI da empresa. A troca é automática: basta atualizar a situação.
CREATE OR REPLACE FUNCTION creci_publicidade(p_mandate_id BIGINT)
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE
  org  organizacao%ROWTYPE;
  u    users%ROWTYPE;
BEGIN
  SELECT * INTO org FROM organizacao WHERE id = 1;

  IF org.creci_pj_situacao = 'ativo' AND org.creci_pj_validade >= CURRENT_DATE THEN
    RETURN format('CRECI%s %s', org.creci_pj_uf, org.creci_pj_numero);
  END IF;

  SELECT u2.* INTO u FROM users u2
   JOIN mandates m ON m.responsible_user_id = u2.id
  WHERE m.id = p_mandate_id;

  IF u.id IS NULL OR NOT creci_ativo(u.id) THEN
    RAISE EXCEPTION
      'Sem inscricao valida para publicidade do mandato % (Decreto 81.871/1978, art. 4o).',
      p_mandate_id;
  END IF;

  RETURN format('CRECI%s %s', u.creci_state, u.creci_number);
END $$;

-- ============================================================
-- 3. Art. 5º — anúncio exige autorização escrita
-- ============================================================

-- A regra estava só na consulta do portal. Regra que vive em consulta
-- é regra que alguém contorna. Agora ela vive no banco.
CREATE OR REPLACE FUNCTION trg_divulgacao_exige_mandato() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  IF NEW.status = 'Em divulgação' THEN
    SELECT count(*) INTO n FROM mandates m
     WHERE m.asset_id = NEW.id AND m.status = 'ativo'
       AND m.signed_at IS NOT NULL AND m.signed_doc_key IS NOT NULL
       AND CURRENT_DATE BETWEEN m.starts_on AND m.ends_on;
    IF n = 0 THEN
      RAISE EXCEPTION
        'Ativo % nao pode ir para divulgacao sem autorizacao escrita vigente (Decreto 81.871/1978, art. 5o).',
        NEW.asset_code;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER divulgacao_exige_mandato
  BEFORE INSERT OR UPDATE OF status ON assets
  FOR EACH ROW EXECUTE FUNCTION trg_divulgacao_exige_mandato();

-- Mandato vencido derruba a divulgação: expira sozinho, sem depender de rotina manual.
CREATE OR REPLACE FUNCTION expirar_mandatos_vencidos() RETURNS TABLE(ativo TEXT, mandato BIGINT)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH vencidos AS (
    UPDATE mandates SET status = 'vencido'
     WHERE status = 'ativo' AND ends_on < CURRENT_DATE
    RETURNING id, asset_id
  ), despublicados AS (
    UPDATE assets a SET status = 'Qualificado'
     FROM vencidos v WHERE a.id = v.asset_id AND a.status = 'Em divulgação'
    RETURNING a.asset_code, v.id
  )
  SELECT d.asset_code, d.id FROM despublicados d;
END $$;

-- ============================================================
-- 4. View de publicidade — o que o portal consome
-- ============================================================

CREATE OR REPLACE VIEW v_publicacao_autorizada AS
SELECT
  a.id, a.asset_code, a.title, a.asset_type, a.city, a.state,
  a.land_area, a.built_area, m.asking_price,
  ST_Y(a.geom::geometry) AS lat, ST_X(a.geom::geometry) AS lng,
  creci_publicidade(m.id) AS creci_obrigatorio_no_anuncio,   -- art. 4o
  u.full_name AS corretor_responsavel,
  m.id AS mandate_id, m.ends_on AS autorizacao_ate
FROM assets a
JOIN mandates m ON m.asset_id = a.id AND m.status = 'ativo'
JOIN users u    ON u.id = m.responsible_user_id
WHERE a.status = 'Em divulgação'
  AND CURRENT_DATE BETWEEN m.starts_on AND m.ends_on;

-- ============================================================
-- 5. Painel de habilitação
-- ============================================================

CREATE OR REPLACE VIEW v_habilitacao AS
SELECT 'PJ' AS escopo,
       o.nome_fantasia AS titular,
       o.creci_pj_numero AS inscricao,
       o.creci_pj_situacao::TEXT AS situacao,
       o.creci_pj_validade AS validade,
       (o.creci_pj_validade - CURRENT_DATE) AS dias_restantes,
       0::BIGINT AS mandatos_ativos
FROM organizacao o
UNION ALL
SELECT 'PF', u.full_name,
       format('CRECI%s %s', u.creci_state, u.creci_number),
       CASE WHEN creci_ativo(u.id) THEN 'ativo' ELSE 'irregular' END,
       u.creci_valid_until,
       (u.creci_valid_until - CURRENT_DATE),
       count(m.id) FILTER (WHERE m.status = 'ativo')
FROM users u LEFT JOIN mandates m ON m.responsible_user_id = u.id
WHERE u.creci_number IS NOT NULL AND u.is_active
GROUP BY u.id;

COMMIT;
