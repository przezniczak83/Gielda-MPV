-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0026_macro_indicators.sql
-- Macro economic indicators table.
-- Filled by fetch-macro Edge Function every 6 hours.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS macro_indicators (
  id          bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text         NOT NULL,           -- e.g. 'EUR/PLN', 'USD/PLN'
  value       numeric      NOT NULL,
  prev_value  numeric      NULL,               -- previous reading
  change_pct  numeric      NULL,               -- percentage change
  source      text         NOT NULL DEFAULT 'NBP',
  fetched_at  timestamptz  NOT NULL DEFAULT now(),
  period      text         NULL                -- e.g. '2025-01'
);

CREATE INDEX IF NOT EXISTS idx_macro_indicators_name_fetched
  ON macro_indicators(name, fetched_at DESC);

ALTER TABLE macro_indicators ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'macro_indicators' AND policyname = 'anon_read_macro_indicators'
  ) THEN
    CREATE POLICY "anon_read_macro_indicators"
      ON macro_indicators FOR SELECT TO anon USING (true);
  END IF;
END; $$;

-- ── Cron: fetch macro data every 6 hours ─────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fetch-macro-6h') THEN
    PERFORM cron.unschedule('fetch-macro-6h');
  END IF;
END;
$$;

SELECT cron.schedule(
  'fetch-macro-6h',
  '0 */6 * * *',
  $cron_body$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/fetch-macro',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer SERVICE_ROLE_KEY_HERE"}'::jsonb,
    body    := '{}'::jsonb
  );
  $cron_body$
);
