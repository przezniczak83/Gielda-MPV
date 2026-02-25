-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0011_early_recommendations.sql
-- Tabela early_recommendations — rekomendacje od domów maklerskich.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS early_recommendations (
  id             bigserial PRIMARY KEY,
  ticker         text NOT NULL,
  recommendation text NOT NULL,
  target_price   numeric(10,2),
  source_email   text,
  received_at    timestamptz DEFAULT now(),
  alerted_at     timestamptz,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_early_recommendations_ticker
  ON early_recommendations(ticker);

CREATE INDEX IF NOT EXISTS idx_early_recommendations_received
  ON early_recommendations(received_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE early_recommendations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'early_recommendations'
      AND policyname = 'anon_read_early_recommendations'
  ) THEN
    CREATE POLICY "anon_read_early_recommendations"
      ON early_recommendations FOR SELECT TO anon USING (true);
  END IF;
END; $$;
