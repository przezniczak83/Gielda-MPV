-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0038_populate_calendar_cron.sql
-- Schedule populate-calendar EF to run weekly (Monday 06:00 UTC)
-- ─────────────────────────────────────────────────────────────────────────────

-- Ensure source column exists (it's in 0021 definition but guard just in case)
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';

-- cron: run populate-calendar every Monday at 06:00 UTC
SELECT cron.schedule(
  'populate-calendar-weekly',
  '0 6 * * 1',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM vault.secrets WHERE name = 'supabase_functions_url') || '/populate-calendar',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM vault.secrets WHERE name = 'supabase_anon_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
