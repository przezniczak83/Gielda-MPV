-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0012_insider_transactions.sql
-- Tabela insider_transactions + cron job fetch-insider (co godzinę).
--
-- Deploy:
--   export SERVICE_ROLE_KEY="eyJ..."
--   sed "s/SERVICE_ROLE_KEY_HERE/$SERVICE_ROLE_KEY/" \
--       supabase/migrations/0012_insider_transactions.sql \
--     | supabase db push --linked
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS insider_transactions (
  id               bigserial PRIMARY KEY,
  ticker           text NOT NULL,
  person_name      text,
  role             text,
  transaction_type text NOT NULL,     -- BUY | SELL
  shares_count     bigint,
  value_pln        numeric(15,2),
  transaction_date date,
  source           text DEFAULT 'espi',
  event_id         uuid,               -- reference to company_events.id
  alerted_at       timestamptz,
  created_at       timestamptz DEFAULT now()
);

-- Deduplicate: same ticker + date + type + person (NULL-safe)
CREATE UNIQUE INDEX IF NOT EXISTS idx_insider_unique
  ON insider_transactions(ticker, transaction_date, transaction_type, COALESCE(person_name, ''));

CREATE INDEX IF NOT EXISTS idx_insider_transactions_ticker
  ON insider_transactions(ticker);

CREATE INDEX IF NOT EXISTS idx_insider_transactions_date
  ON insider_transactions(transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_insider_transactions_type
  ON insider_transactions(transaction_type);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE insider_transactions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'insider_transactions'
      AND policyname = 'anon_read_insider_transactions'
  ) THEN
    CREATE POLICY "anon_read_insider_transactions"
      ON insider_transactions FOR SELECT TO anon USING (true);
  END IF;
END; $$;

-- ── Extensions ────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── Cron job: fetch-insider ───────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fetch-insider-hourly') THEN
    PERFORM cron.unschedule('fetch-insider-hourly');
  END IF;
END;
$$;

SELECT cron.schedule(
  'fetch-insider-hourly',
  '0 * * * *',
  $cron_body$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/fetch-insider',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer SERVICE_ROLE_KEY_HERE'
    ),
    body    := '{}'::jsonb
  );
  $cron_body$
);
