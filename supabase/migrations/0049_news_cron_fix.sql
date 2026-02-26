-- 0049_news_cron_fix.sql
-- Fix news pipeline cron jobs: reschedule with vault.secrets (no key placeholder needed).
-- Vault reads the service role key at runtime from Supabase's built-in vault.
-- Pattern from 0038_populate_calendar_cron.sql

-- ── fetch-news: every 15 minutes ─────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fetch-news-15m') THEN
    PERFORM cron.unschedule('fetch-news-15m');
  END IF;
END;
$$;

SELECT cron.schedule(
  'fetch-news-15m',
  '*/15 * * * *',
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

-- ── process-news: every 15 minutes, offset 5 min ─────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-news-15m') THEN
    PERFORM cron.unschedule('process-news-15m');
  END IF;
END;
$$;

SELECT cron.schedule(
  'process-news-15m',
  '5-59/15 * * * *',
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

-- ── send-news-alerts: every 10 minutes ───────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-news-alerts-10m') THEN
    PERFORM cron.unschedule('send-news-alerts-10m');
  END IF;
END;
$$;

SELECT cron.schedule(
  'send-news-alerts-10m',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/send-news-alerts',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM vault.secrets WHERE name = 'supabase_anon_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
