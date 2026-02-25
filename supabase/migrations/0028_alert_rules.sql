-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0028_alert_rules.sql
-- Configurable alert rules — replaces hardcoded impact_score >= 7.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alert_rules (
  id                 bigserial    PRIMARY KEY,
  rule_name          text         NOT NULL,
  rule_type          text         NOT NULL CHECK (rule_type IN (
    'impact_score', 'price_change', 'health_score',
    'red_flags', 'insider_buy', 'new_recommendation'
  )),
  threshold_value    numeric(10,4) NULL,
  threshold_operator text          NULL CHECK (threshold_operator IN ('>', '<', '>=', '<=', '=')),
  ticker             text          NULL REFERENCES companies(ticker) ON DELETE CASCADE, -- NULL = all companies
  is_active          boolean       NOT NULL DEFAULT true,
  telegram_enabled   boolean       NOT NULL DEFAULT true,
  created_at         timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'alert_rules' AND policyname = 'anon_read_alert_rules'
  ) THEN
    CREATE POLICY "anon_read_alert_rules"
      ON alert_rules FOR SELECT TO anon USING (true);
  END IF;
END; $$;

-- Default rules (migrating hardcoded values)
INSERT INTO alert_rules (rule_name, rule_type, threshold_value, threshold_operator, is_active, telegram_enabled)
VALUES
  ('High Impact Event',        'impact_score',       7,      '>=', true,  true),
  ('Large Insider Buy',        'insider_buy',        100000, '>=', true,  true),
  ('Health Score Drop',        'health_score',       4,      '<=', true,  false),
  ('Multiple Red Flags',       'red_flags',          3,      '>=', true,  false),
  ('New BUY Recommendation',   'new_recommendation', NULL,   NULL, true,  false)
ON CONFLICT DO NOTHING;
