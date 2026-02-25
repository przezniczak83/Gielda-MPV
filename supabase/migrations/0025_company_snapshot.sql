-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0025_company_snapshot.sql
-- Precomputed per-company snapshot (denormalized cache).
-- Filled by compute-snapshot Edge Function every 30 min.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_snapshot (
  ticker      text         PRIMARY KEY REFERENCES companies(ticker) ON DELETE CASCADE,
  snapshot    jsonb        NOT NULL DEFAULT '{}',
  computed_at timestamptz  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_snapshot_computed
  ON company_snapshot(computed_at DESC);

ALTER TABLE company_snapshot ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'company_snapshot' AND policyname = 'anon_read_company_snapshot'
  ) THEN
    CREATE POLICY "anon_read_company_snapshot"
      ON company_snapshot FOR SELECT TO anon USING (true);
  END IF;
END; $$;

-- ── Cron: compute all snapshots every 30 min ─────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'compute-snapshots-30min') THEN
    PERFORM cron.unschedule('compute-snapshots-30min');
  END IF;
END;
$$;

SELECT cron.schedule(
  'compute-snapshots-30min',
  '*/30 * * * *',
  $cron_body$
  SELECT net.http_post(
    url     := 'https://pftgmorsthoezhmojjpg.supabase.co/functions/v1/compute-snapshot',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer SERVICE_ROLE_KEY_HERE"}'::jsonb,
    body    := '{}'::jsonb
  );
  $cron_body$
);
