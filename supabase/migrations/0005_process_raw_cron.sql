-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0005_process_raw_cron.sql
-- Cron job: process-raw co 30 minut.
--
-- Deploy (zastąpienie przez sed + execute):
--   export SERVICE_ROLE_KEY="eyJ..."
--   sed "s/SERVICE_ROLE_KEY_HERE/$SERVICE_ROLE_KEY/" \
--       supabase/migrations/0005_process_raw_cron.sql \
--     | supabase db execute --project-ref pftgmorsthoezhmojjpg
--
-- Lub ręcznie wklej do Supabase Dashboard → SQL Editor → New query.
-- NIE commituj pliku z prawdziwym kluczem.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Extensions ────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_net;   -- HTTP calls from pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;  -- Scheduler

-- ── Idempotent cron job: process-raw ─────────────────────────────────────────
-- Usuwa stary job jeśli istnieje (bezpieczny re-run migracji).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-raw-30min') THEN
    PERFORM cron.unschedule('process-raw-30min');
  END IF;
END;
$$;

-- Utwórz cron job: co 30 minut wywołuje process-raw Edge Function.

SELECT cron.schedule(
  'process-raw-30min',
  '*/30 * * * *',
  $cron_body$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/process-raw',
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
--   WHERE jobname = 'process-raw-30min';
-- Oczekiwany output: 1 wiersz, active = true.
