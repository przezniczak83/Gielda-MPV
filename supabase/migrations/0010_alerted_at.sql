-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0010_alerted_at.sql
-- Dodaje kolumnę alerted_at do company_events (idempotentne alerty Telegram).
-- Tworzy cron job send-alerts-5min.
--
-- Deploy:
--   export SERVICE_ROLE_KEY="eyJ..."
--   sed "s/SERVICE_ROLE_KEY_HERE/$SERVICE_ROLE_KEY/" \
--       supabase/migrations/0010_alerted_at.sql \
--     | supabase db push --linked
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Column ────────────────────────────────────────────────────────────────────

ALTER TABLE company_events ADD COLUMN IF NOT EXISTS alerted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_company_events_alerted_at
  ON company_events(alerted_at)
  WHERE alerted_at IS NOT NULL;

-- ── Extensions ────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── Cron job: send-alerts ────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-alerts-5min') THEN
    PERFORM cron.unschedule('send-alerts-5min');
  END IF;
END;
$$;

SELECT cron.schedule(
  'send-alerts-5min',
  '*/5 * * * *',
  $cron_body$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/send-alerts',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer SERVICE_ROLE_KEY_HERE'
    ),
    body    := '{}'::jsonb
  );
  $cron_body$
);
