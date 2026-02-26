-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0006_price_history.sql
-- Tabela price_history + cron job fetch-prices (dni robocze 18:00).
--
-- Deploy:
--   export SERVICE_ROLE_KEY="eyJ..."
--   sed "s/SERVICE_ROLE_KEY_HERE/$SERVICE_ROLE_KEY/" \
--       supabase/migrations/0006_price_history.sql \
--     | supabase db push --linked
--
-- Lub ręcznie przez: supabase db push --linked (po dodaniu do migrations/)
-- NIE commituj pliku z prawdziwym kluczem.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Tabela price_history ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS price_history (
  id          bigserial PRIMARY KEY,
  ticker      text NOT NULL,
  date        date NOT NULL,
  open        numeric(12,4),
  high        numeric(12,4),
  low         numeric(12,4),
  close       numeric(12,4),
  volume      bigint,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(ticker, date)
);

CREATE INDEX IF NOT EXISTS idx_price_history_ticker_date
  ON price_history(ticker, date DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'price_history'
      AND policyname = 'anon_read_price_history'
  ) THEN
    CREATE POLICY "anon_read_price_history"
      ON price_history FOR SELECT TO anon USING (true);
  END IF;
END; $$;

-- ── Extensions ────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── Cron job: fetch-prices ────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fetch-prices-daily') THEN
    PERFORM cron.unschedule('fetch-prices-daily');
  END IF;
END;
$$;

SELECT cron.schedule(
  'fetch-prices-daily',
  '0 18 * * 1-5',
  $cron_body$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/fetch-prices',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer SERVICE_ROLE_KEY_HERE'
    ),
    body    := '{}'::jsonb
  );
  $cron_body$
);

-- ── Weryfikacja ───────────────────────────────────────────────────────────────
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'fetch-prices-daily';
-- SELECT ticker, date, close FROM price_history ORDER BY date DESC LIMIT 10;
