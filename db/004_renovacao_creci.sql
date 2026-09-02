-- PrimeCorp Core V4 — 004: acompanhamento de renovação de inscrição
--
-- A trava permanece intacta: `mandato_exige_creci` continua bloqueando a
-- ativação de mandato com inscrição vencida. Renovação protocolada não é
-- renovação deferida, e o sistema não deve fingir que é.
-- O que muda é apenas a leitura do alerta.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS creci_renovacao_protocolada_em DATE,
  ADD COLUMN IF NOT EXISTS creci_renovacao_protocolo TEXT;

-- Painel de habilitação com o estado da renovação
CREATE OR REPLACE VIEW v_creci_alerta AS
SELECT
  u.id,
  u.full_name,
  format('CRECI%s %s', u.creci_state, u.creci_number) AS inscricao,
  u.creci_valid_until AS validade,
  (u.creci_valid_until - CURRENT_DATE) AS dias_restantes,
  count(m.id) FILTER (WHERE m.status = 'ativo') AS mandatos_ativos,
  CASE
    WHEN u.creci_valid_until < CURRENT_DATE
      THEN 'VENCIDO — captação bloqueada'
    WHEN u.creci_renovacao_protocolada_em IS NOT NULL
      THEN format('renovação protocolada em %s', to_char(u.creci_renovacao_protocolada_em, 'DD/MM/YYYY'))
    WHEN (u.creci_valid_until - CURRENT_DATE) <= 30
      THEN 'VENCE EM BREVE — sem renovação registrada'
    ELSE 'atenção — janela de 60 dias'
  END AS situacao,
  u.creci_renovacao_protocolo AS protocolo
FROM users u
LEFT JOIN mandates m ON m.responsible_user_id = u.id
WHERE u.is_active AND u.creci_number IS NOT NULL
  AND u.creci_valid_until <= CURRENT_DATE + INTERVAL '60 days'
GROUP BY u.id;

-- Registrar o protocolo de renovação:
--   UPDATE users SET creci_renovacao_protocolada_em = CURRENT_DATE,
--                    creci_renovacao_protocolo = '<numero>'
--    WHERE creci_number IN ('300760','297692');
--
-- Quando o deferimento sair, a única coisa a fazer é atualizar a validade:
--   UPDATE users SET creci_valid_until = 'AAAA-MM-DD',
--                    creci_renovacao_protocolada_em = NULL,
--                    creci_renovacao_protocolo = NULL
--    WHERE creci_number IN ('300760','297692');

COMMIT;
