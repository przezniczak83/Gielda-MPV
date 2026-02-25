-- 0022_sec_cron.sql
-- Scheduled job: fetch SEC EDGAR fundamentals for USA stocks
-- Runs weekdays at 20:00 UTC (after US market close)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fetch-sec-fundamentals') THEN
    PERFORM cron.unschedule('fetch-sec-fundamentals');
  END IF;
END;
$$;

SELECT cron.schedule(
  'fetch-sec-fundamentals',
  '0 20 * * 1-5',
  $cron_body$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/fetch-sec',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer SERVICE_ROLE_KEY_HERE'
    ),
    body := '{}'::jsonb
  );
  $cron_body$
);
