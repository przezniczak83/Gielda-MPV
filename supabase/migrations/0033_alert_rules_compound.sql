-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0033_alert_rules_compound.sql
-- Add cooldown_hours and conditions JSONB to alert_rules for smart/compound
-- alert logic in the send-alerts Edge Function.
-- ─────────────────────────────────────────────────────────────────────────────

-- Add new columns
ALTER TABLE alert_rules
  ADD COLUMN IF NOT EXISTS cooldown_hours  integer DEFAULT 24,
  ADD COLUMN IF NOT EXISTS conditions      jsonb   DEFAULT '[]';

-- Set sensible defaults for existing rules
UPDATE alert_rules SET cooldown_hours = 24  WHERE rule_type = 'impact_score'       AND cooldown_hours IS NULL;
UPDATE alert_rules SET cooldown_hours = 48  WHERE rule_type = 'insider_buy'        AND cooldown_hours IS NULL;
UPDATE alert_rules SET cooldown_hours = 72  WHERE rule_type = 'health_score'       AND cooldown_hours IS NULL;
UPDATE alert_rules SET cooldown_hours = 72  WHERE rule_type = 'red_flags'          AND cooldown_hours IS NULL;
UPDATE alert_rules SET cooldown_hours = 24  WHERE rule_type = 'new_recommendation' AND cooldown_hours IS NULL;
UPDATE alert_rules SET cooldown_hours = 24  WHERE rule_type = 'price_change'       AND cooldown_hours IS NULL;

-- Add an example compound rule: high impact earnings only
INSERT INTO alert_rules (
  rule_name, rule_type, threshold_value, threshold_operator,
  is_active, telegram_enabled, cooldown_hours, conditions
) VALUES (
  'High Impact Earnings',
  'impact_score', 6, '>=',
  false, true, 48,
  '[{"field":"event_type","op":"=","value":"earnings"}]'
) ON CONFLICT DO NOTHING;
