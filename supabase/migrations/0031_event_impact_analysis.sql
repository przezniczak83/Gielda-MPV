-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0031_event_impact_analysis.sql
-- Aggregated impact statistics per event type, computed by analyze-impact EF.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_impact_analysis (
  event_type       text        PRIMARY KEY,
  sample_count     integer     NOT NULL DEFAULT 0,
  avg_impact_score numeric(5,2),
  median_impact    numeric(5,2),
  positive_pct     numeric(5,2),   -- % events with impact_score > 0
  high_impact_pct  numeric(5,2),   -- % events with impact_score >= 7
  top_tickers      jsonb,          -- [{ticker, count, avg_score}]
  computed_at      timestamptz     DEFAULT now()
);

ALTER TABLE event_impact_analysis ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'event_impact_analysis' AND policyname = 'anon_read_event_impact'
  ) THEN
    CREATE POLICY "anon_read_event_impact"
      ON event_impact_analysis FOR SELECT TO anon USING (true);
  END IF;
END; $$;

-- Cron: recompute impact analysis every 6 hours
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'analyze-impact-6h') THEN
    PERFORM cron.unschedule('analyze-impact-6h');
  END IF;
END;
$$;

SELECT cron.schedule(
  'analyze-impact-6h',
  '0 */6 * * *',
  $cron_body$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/analyze-impact',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer SERVICE_ROLE_KEY_HERE"}'::jsonb,
    body    := '{}'::jsonb
  );
  $cron_body$
);
