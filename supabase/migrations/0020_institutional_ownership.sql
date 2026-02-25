-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0020_institutional_ownership.sql
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS institutional_ownership (
  id               bigserial  PRIMARY KEY,
  ticker           text       NOT NULL REFERENCES companies(ticker),
  institution_name text       NOT NULL,
  shares_held      bigint,
  ownership_pct    numeric(8,4),
  change_shares    bigint,
  change_pct       numeric(8,4),
  report_date      date       NOT NULL,
  source           text       DEFAULT 'espi',
  created_at       timestamptz DEFAULT now(),
  UNIQUE(ticker, institution_name, report_date)
);

CREATE INDEX IF NOT EXISTS idx_institutional_ownership_ticker ON institutional_ownership(ticker);

ALTER TABLE institutional_ownership ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'institutional_ownership' AND policyname = 'anon_read_institutional_ownership') THEN
    CREATE POLICY "anon_read_institutional_ownership"
      ON institutional_ownership FOR SELECT TO anon USING (true);
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'institutional_ownership' AND policyname = 'service_role_all_institutional_ownership') THEN
    CREATE POLICY "service_role_all_institutional_ownership"
      ON institutional_ownership FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END; $$;
