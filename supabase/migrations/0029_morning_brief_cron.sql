-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0029_morning_brief_cron.sql
-- Schedules morning-brief Edge Function at 7:00 on weekdays (Mon–Fri).
--
-- Deploy:
--   sed "s/SERVICE_ROLE_KEY_HERE/$SERVICE_ROLE_KEY/" \
--     supabase/migrations/0029_morning_brief_cron.sql \
--     | supabase db push --linked --yes
-- ─────────────────────────────────────────────────────────────────────────────

-- Unschedule if exists (idempotent re-run)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'morning-brief-7am') THEN
    PERFORM cron.unschedule('morning-brief-7am');
  END IF;
END;
$$;

SELECT cron.schedule(
  'morning-brief-7am',
  '0 7 * * 1-5',
  $cron_body$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/morning-brief',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer SERVICE_ROLE_KEY_HERE'
    ),
    body    := '{}'::jsonb
  );
  $cron_body$
);
