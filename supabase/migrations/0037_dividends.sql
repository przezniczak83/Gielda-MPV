-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0037_dividends.sql
-- dividends table — historical dividend payments per ticker
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dividends (
  id             bigserial    PRIMARY KEY,
  ticker         text         NOT NULL REFERENCES companies(ticker) ON DELETE CASCADE,
  ex_date        date         NOT NULL,
  payment_date   date,
  declaration_date date,
  amount         numeric(12, 4) NOT NULL,
  currency       text         NOT NULL DEFAULT 'PLN',
  type           text         DEFAULT 'Cash',    -- Cash / Stock / Special
  source         text         DEFAULT 'EODHD',
  fetched_at     timestamptz  DEFAULT now(),
  UNIQUE(ticker, ex_date)
);

CREATE INDEX IF NOT EXISTS idx_dividends_ticker    ON dividends(ticker);
CREATE INDEX IF NOT EXISTS idx_dividends_ex_date   ON dividends(ex_date DESC);

ALTER TABLE dividends ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'dividends' AND policyname = 'anon_read_dividends'
  ) THEN
    CREATE POLICY "anon_read_dividends" ON dividends FOR SELECT TO anon USING (true);
  END IF;
END; $$;

-- cron: fetch dividends every Sunday at 21:00 UTC
SELECT cron.schedule(
  'fetch-dividends-weekly',
  '0 21 * * 0',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM vault.secrets WHERE name = 'supabase_functions_url') || '/fetch-dividends',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM vault.secrets WHERE name = 'supabase_anon_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
