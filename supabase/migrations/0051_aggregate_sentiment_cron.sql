-- 0051_aggregate_sentiment_cron.sql
-- Hourly cron: aggregate news_items → sentiment_daily per ticker per day.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aggregate-sentiment-hourly') THEN
    PERFORM cron.unschedule('aggregate-sentiment-hourly');
  END IF;
END;
$$;

SELECT cron.schedule(
  'aggregate-sentiment-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/aggregate-sentiment',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM vault.secrets WHERE name = 'supabase_anon_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
