-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0002_companies.sql
-- Company reference table — ticker lookup, sector/market metadata.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS companies (
  ticker           text        PRIMARY KEY,
  name             text        NOT NULL,
  sector           text,
  market           text        NOT NULL DEFAULT 'GPW',
  has_subsidiaries boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'companies'
      AND policyname = 'anon_read_companies'
  ) THEN
    CREATE POLICY "anon_read_companies"
      ON companies FOR SELECT TO anon USING (true);
  END IF;
END; $$;

CREATE INDEX IF NOT EXISTS companies_market_idx ON companies (market);
CREATE INDEX IF NOT EXISTS companies_sector_idx ON companies (sector);
