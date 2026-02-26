-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0035_weekly_reports.sql
-- Stores AI-generated weekly market reports (sent every Friday 18:00).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS weekly_reports (
  id             bigserial   PRIMARY KEY,
  week_start     date        NOT NULL,  -- Monday of the covered week
  week_end       date        NOT NULL,  -- Friday of the covered week
  content        text        NOT NULL,  -- full report markdown
  summary        text,                  -- short 2-3 sentence summary
  event_count    integer     DEFAULT 0,
  high_impact    integer     DEFAULT 0, -- events with score >= 7
  top_tickers    jsonb,                 -- [{ticker, event_count, avg_score}]
  sent_telegram  boolean     NOT NULL DEFAULT false,
  generated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (week_start)
);

ALTER TABLE weekly_reports ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'weekly_reports' AND policyname = 'anon_read_weekly_reports'
  ) THEN
    CREATE POLICY "anon_read_weekly_reports"
      ON weekly_reports FOR SELECT TO anon USING (true);
  END IF;
END; $$;

-- Cron: every Friday at 18:00 Warsaw time (17:00 UTC in winter, 16:00 UTC in summer)
-- Using 16:00 UTC as approximate (valid for CET+1 summer)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-report-friday') THEN
    PERFORM cron.unschedule('weekly-report-friday');
  END IF;
END;
$$;

SELECT cron.schedule(
  'weekly-report-friday',
  '0 16 * * 5',
  $cron_body$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/weekly-report',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer SERVICE_ROLE_KEY_HERE"}'::jsonb,
    body    := '{}'::jsonb
  );
  $cron_body$
);
