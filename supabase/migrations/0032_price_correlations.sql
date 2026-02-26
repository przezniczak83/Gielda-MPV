-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0032_price_correlations.sql
-- Pairwise price-return correlations, computed by calc-correlations EF.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS price_correlations (
  ticker_a    text    NOT NULL,
  ticker_b    text    NOT NULL,
  correlation numeric(6,4) NOT NULL,  -- Pearson r  (-1 to 1)
  sample_size integer NOT NULL,       -- overlapping days used
  period_days integer NOT NULL DEFAULT 90,
  computed_at timestamptz DEFAULT now(),
  PRIMARY KEY (ticker_a, ticker_b)
);

CREATE INDEX IF NOT EXISTS idx_price_corr_a ON price_correlations(ticker_a);
CREATE INDEX IF NOT EXISTS idx_price_corr_b ON price_correlations(ticker_b);

ALTER TABLE price_correlations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'price_correlations' AND policyname = 'anon_read_price_correlations'
  ) THEN
    CREATE POLICY "anon_read_price_correlations"
      ON price_correlations FOR SELECT TO anon USING (true);
  END IF;
END; $$;
