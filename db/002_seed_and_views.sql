BEGIN;

-- ============================================================
-- Papéis RBAC
-- ============================================================
INSERT INTO roles (code, description) VALUES
  ('admin',       'Administração do sistema, usuários e fontes'),
  ('originacao',  'Descoberta e qualificação de ativos'),
  ('corretor',    'Captação, mandatos e negócios — exige CRECI'),
  ('juridico',    'Due diligence, LGPD e conformidade'),
  ('leitura',     'Consulta somente leitura')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- Views operacionais
-- ============================================================

-- Pipeline de comissão: a métrica-mestre da tese de intermediação
CREATE OR REPLACE VIEW v_pipeline_comissao AS
SELECT
  d.id                AS deal_id,
  a.asset_code,
  a.city, a.state, a.asset_type,
  m.mandate_type,
  m.commission_pct,
  d.stage,
  COALESCE(d.closed_price, d.offer_price, m.asking_price) AS valor_referencia,
  ROUND(COALESCE(d.closed_price, d.offer_price, m.asking_price) * m.commission_pct / 100, 2)
                      AS comissao_bruta_estimada,
  u.full_name         AS responsavel,
  m.ends_on           AS mandato_vence_em,
  d.opened_at
FROM deals d
JOIN mandates m ON m.id = d.mandate_id
JOIN assets   a ON a.id = m.asset_id
JOIN users    u ON u.id = m.responsible_user_id
WHERE d.stage NOT IN ('perdido');

-- Mandatos vencendo: perda silenciosa de inventário é o vazamento clássico da corretagem
CREATE OR REPLACE VIEW v_mandatos_vencendo AS
SELECT m.id, a.asset_code, a.title, a.city, m.mandate_type,
       m.ends_on, (m.ends_on - CURRENT_DATE) AS dias_restantes,
       u.full_name AS responsavel, c.name AS proprietario
FROM mandates m
JOIN assets a   ON a.id = m.asset_id
JOIN users  u   ON u.id = m.responsible_user_id
JOIN contacts c ON c.id = m.owner_contact_id
WHERE m.status = 'ativo' AND m.ends_on <= CURRENT_DATE + INTERVAL '45 days'
ORDER BY m.ends_on;

-- Fila LGPD: contatos vencidos que precisam de expurgo
CREATE OR REPLACE VIEW v_lgpd_expurgo_pendente AS
SELECT id, name, basis, source_type, retention_until,
       (CURRENT_DATE - retention_until) AS dias_vencido
FROM contacts
WHERE retention_until < CURRENT_DATE
ORDER BY retention_until;

-- Conformidade CRECI: alerta de habilitação vencendo
CREATE OR REPLACE VIEW v_creci_alerta AS
SELECT u.id, u.full_name, u.creci_number, u.creci_state, u.creci_valid_until,
       (u.creci_valid_until - CURRENT_DATE) AS dias_restantes,
       COUNT(m.id) FILTER (WHERE m.status = 'ativo') AS mandatos_ativos
FROM users u
LEFT JOIN mandates m ON m.responsible_user_id = u.id
WHERE u.is_active AND u.creci_number IS NOT NULL
  AND u.creci_valid_until <= CURRENT_DATE + INTERVAL '60 days'
GROUP BY u.id;

COMMIT;
