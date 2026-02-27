-- 0069_fix_cron_jobs.sql
-- Add missing cron jobs: fetch-espi (every 10 min) and fetch-prices (every 10 min, 16-19 UTC mon-fri)
-- Also re-register all news pipeline crons to ensure they're active with correct schedules.
-- Uses vault.secrets pattern (reads key at runtime, no plaintext in SQL).

-- ── Helper: get base URL and key ─────────────────────────────────────────────
-- All existing crons use 'supabase_anon_key' — anon key is sufficient for
-- calling Edge Functions (the EFs use their own service_role env secret internally).

-- ── 1. fetch-espi: every 10 minutes ─────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fetch-espi-10m') THEN
    PERFORM cron.unschedule('fetch-espi-10m');
  END IF;
END;
$$;

SELECT cron.schedule(
  'fetch-espi-10m',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/fetch-espi',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM vault.secrets WHERE name = 'supabase_anon_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── 2. fetch-prices: every 10 min during trading hours (16-19 UTC = 17-20 PL), mon-fri ──

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fetch-prices-10m') THEN
    PERFORM cron.unschedule('fetch-prices-10m');
  END IF;
  -- Also clean up any old name
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fetch-prices-cron') THEN
    PERFORM cron.unschedule('fetch-prices-cron');
  END IF;
END;
$$;

SELECT cron.schedule(
  'fetch-prices-10m',
  '*/10 16-19 * * 1-5',
  $$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/fetch-prices',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM vault.secrets WHERE name = 'supabase_anon_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── 3. Re-register fetch-news-5m (safety: ensure it's active) ───────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fetch-news-5m') THEN
    PERFORM cron.unschedule('fetch-news-5m');
  END IF;
END;
$$;

SELECT cron.schedule(
  'fetch-news-5m',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/fetch-news',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM vault.secrets WHERE name = 'supabase_anon_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── 4. Re-register process-news-2m (safety: ensure it's active) ─────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-news-2m') THEN
    PERFORM cron.unschedule('process-news-2m');
  END IF;
END;
$$;

SELECT cron.schedule(
  'process-news-2m',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/process-news',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM vault.secrets WHERE name = 'supabase_anon_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── Verification ─────────────────────────────────────────────────────────────
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
