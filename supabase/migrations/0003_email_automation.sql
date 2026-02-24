-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0003_email_automation.sql
-- Checkpoint 3.6: pg_cron job for fetch-email Edge Function.
--
-- PRZED URUCHOMIENIEM zastąp placeholder SERVICE_ROLE_KEY_HERE
-- prawdziwym kluczem service_role (Settings → API → service_role key).
--
-- Bezpieczny deploy (zastąpienie przez sed + push):
--   export SERVICE_ROLE_KEY="eyJ..."
--   sed "s/SERVICE_ROLE_KEY_HERE/$SERVICE_ROLE_KEY/" \
--       supabase/migrations/0003_email_automation.sql \
--     | supabase db execute --project-ref pftgmorsthoezhmojjpg
--
-- Lub ręcznie wklej do Supabase Dashboard → SQL Editor → New query.
-- NIE commituj pliku z prawdziwym kluczem.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Extensions ────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net;   -- HTTP calls from pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;  -- Scheduler

-- ── Idempotent cron job: fetch-email ─────────────────────────────────────────
-- Usuwa stary job jeśli istnieje (bezpieczny re-run migracji).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fetch-email-every-15min') THEN
    PERFORM cron.unschedule('fetch-email-every-15min');
  END IF;
END;
$$;

-- Utwórz cron job: co 15 minut wywołuje fetch-email Edge Function.
-- Używamy $cron_body$ zamiast $$ aby uniknąć konfliktu dollar-quote.

SELECT cron.schedule(
  'fetch-email-every-15min',
  '*/15 * * * *',
  $cron_body$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/fetch-email',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer SERVICE_ROLE_KEY_HERE'
    ),
    body    := '{}'::jsonb
  );
  $cron_body$
);

-- ── Weryfikacja ───────────────────────────────────────────────────────────────
-- Po wykonaniu sprawdź:
--   SELECT jobid, jobname, schedule, active FROM cron.job
--   WHERE jobname = 'fetch-email-every-15min';
-- Oczekiwany output: 1 wiersz, active = true.
