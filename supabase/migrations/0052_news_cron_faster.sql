-- 0052_news_cron_faster.sql
-- Reschedule news pipeline crons for faster processing:
--   fetch-news:       15m → 5m
--   process-news:     15m → 2m
--   send-news-alerts: 10m → 3m

-- ── fetch-news: 15m → 5m ──────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fetch-news-15m') THEN
    PERFORM cron.unschedule('fetch-news-15m');
  END IF;
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

-- ── process-news: 15m → 2m ───────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-news-15m') THEN
    PERFORM cron.unschedule('process-news-15m');
  END IF;
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

-- ── send-news-alerts: 10m → 3m ───────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-news-alerts-10m') THEN
    PERFORM cron.unschedule('send-news-alerts-10m');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-news-alerts-3m') THEN
    PERFORM cron.unschedule('send-news-alerts-3m');
  END IF;
END;
$$;

SELECT cron.schedule(
  'send-news-alerts-3m',
  '*/3 * * * *',
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
