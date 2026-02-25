-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0016_analyst_forecasts.sql
-- Tabela analyst_forecasts — rekomendacje i prognozy domów maklerskich.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS analyst_forecasts (
  id                bigserial  PRIMARY KEY,
  ticker            text       NOT NULL,
  institution       text,
  analyst_name      text,
  recommendation    text       CHECK (recommendation IN ('BUY','HOLD','SELL','NEUTRAL','OVERWEIGHT','UNDERWEIGHT')),
  price_target      numeric(12,4),
  currency          text       NOT NULL DEFAULT 'PLN',
  horizon_months    int,
  revenue_forecast  numeric(20,4),
  ebitda_forecast   numeric(20,4),
  eps_forecast      numeric(12,4),
  upside_pct        numeric(8,4),
  source_type       text       DEFAULT 'email',
  source_url        text,
  published_at      timestamptz,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analyst_forecasts_ticker
  ON analyst_forecasts(ticker);
CREATE INDEX IF NOT EXISTS idx_analyst_forecasts_published
  ON analyst_forecasts(published_at DESC);

ALTER TABLE analyst_forecasts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'analyst_forecasts' AND policyname = 'anon_read_analyst_forecasts') THEN
    CREATE POLICY "anon_read_analyst_forecasts"
      ON analyst_forecasts FOR SELECT TO anon USING (true);
  END IF;
END; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0016b: dm_reports
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dm_reports (
  id               bigserial  PRIMARY KEY,
  ticker           text       NOT NULL,
  institution      text,
  report_date      date,
  report_url       text,
  recommendation   text,
  price_target     numeric(12,4),
  summary          text,
  page_references  text,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dm_reports_ticker ON dm_reports(ticker);

ALTER TABLE dm_reports ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dm_reports' AND policyname = 'anon_read_dm_reports') THEN
    CREATE POLICY "anon_read_dm_reports" ON dm_reports FOR SELECT TO anon USING (true);
  END IF;
END; $$;
