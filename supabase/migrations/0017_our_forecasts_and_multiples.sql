-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0017_our_forecasts_and_multiples.sql
-- our_forecasts — prognozy AI, valuation_multiples — mnożniki wyceny.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS our_forecasts (
  id                   bigserial   PRIMARY KEY,
  ticker               text        NOT NULL,
  scenario             text        NOT NULL CHECK (scenario IN ('base','bull','bear')),
  revenue_growth_pct   numeric(8,4),
  ebitda_margin_pct    numeric(8,4),
  eps                  numeric(12,4),
  price_target         numeric(12,4),
  rationale            text,
  confidence           int,
  key_assumptions      text[],
  generated_at         timestamptz DEFAULT now(),
  UNIQUE(ticker, scenario)
);

CREATE INDEX IF NOT EXISTS idx_our_forecasts_ticker ON our_forecasts(ticker);

ALTER TABLE our_forecasts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'our_forecasts' AND policyname = 'anon_read_our_forecasts') THEN
    CREATE POLICY "anon_read_our_forecasts" ON our_forecasts FOR SELECT TO anon USING (true);
  END IF;
END; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- valuation_multiples
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS valuation_multiples (
  id                bigserial   PRIMARY KEY,
  ticker            text        NOT NULL,
  pe_ratio          numeric(12,4),
  pb_ratio          numeric(12,4),
  ps_ratio          numeric(12,4),
  ev_ebitda         numeric(12,4),
  ev_revenue        numeric(12,4),
  market_cap        numeric(20,4),
  enterprise_value  numeric(20,4),
  calculated_at     timestamptz DEFAULT now(),
  UNIQUE(ticker)
);

CREATE INDEX IF NOT EXISTS idx_valuation_multiples_ticker ON valuation_multiples(ticker);

ALTER TABLE valuation_multiples ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'valuation_multiples' AND policyname = 'anon_read_valuation_multiples') THEN
    CREATE POLICY "anon_read_valuation_multiples" ON valuation_multiples FOR SELECT TO anon USING (true);
  END IF;
END; $$;

-- Cron: calc-multiples every weekday at 19:05 (after fetch-prices at 18:xx)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'calc-multiples') THEN
    PERFORM cron.unschedule('calc-multiples');
  END IF;
END;
$$;

SELECT cron.schedule(
  'calc-multiples',
  '5 19 * * 1-5',
  $cron_body$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/calc-multiples',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer SERVICE_ROLE_KEY_HERE"}'::jsonb,
    body    := '{}'::jsonb
  );
  $cron_body$
);
