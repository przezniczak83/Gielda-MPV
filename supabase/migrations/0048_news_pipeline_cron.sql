-- 0048_news_pipeline_cron.sql
-- Cron jobs for the news pipeline:
--   fetch-news      — every 15 minutes (RSS aggregator)
--   process-news    — every 15 minutes, offset 5 min (AI analysis)
--   send-news-alerts— every 10 minutes (Telegram alerts)
--
-- Deploy (replace SERVICE_ROLE_KEY_HERE with actual key):
--   export SRK=$(supabase secrets list --json | jq -r '.[] | select(.name=="SERVICE_ROLE_KEY") | .value')
--   sed "s/SERVICE_ROLE_KEY_HERE/$SRK/" supabase/migrations/0048_news_pipeline_cron.sql | supabase db push --linked

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
  $cron_body$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/fetch-news',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer SERVICE_ROLE_KEY_HERE'
    ),
    body    := '{}'::jsonb
  );
  $cron_body$
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
  $cron_body$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/process-news',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer SERVICE_ROLE_KEY_HERE'
    ),
    body    := '{}'::jsonb
  );
  $cron_body$
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
  $cron_body$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/send-news-alerts',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer SERVICE_ROLE_KEY_HERE'
    ),
    body    := '{}'::jsonb
  );
  $cron_body$
);
