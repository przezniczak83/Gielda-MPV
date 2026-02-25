-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0014_company_kpis.sql
-- Tabela company_kpis — przechowuje obliczone KPI dla spółek.
-- Używana przez: analyze-health (health_score), detect-flags (red_flags).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_kpis (
  id            bigserial    PRIMARY KEY,
  ticker        text         NOT NULL,
  kpi_type      text         NOT NULL,   -- 'health_score', 'red_flags', etc.
  value         numeric(10,2),           -- główna wartość (np. 7.4 dla health score)
  metadata      jsonb,                   -- szczegóły: komponenty, komentarze, etc.
  calculated_at timestamptz  NOT NULL DEFAULT now(),
  UNIQUE(ticker, kpi_type)
);

CREATE INDEX IF NOT EXISTS idx_company_kpis_ticker
  ON company_kpis(ticker);

CREATE INDEX IF NOT EXISTS idx_company_kpis_type
  ON company_kpis(kpi_type);

ALTER TABLE company_kpis ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'company_kpis'
      AND policyname = 'anon_read_company_kpis'
  ) THEN
    CREATE POLICY "anon_read_company_kpis"
      ON company_kpis FOR SELECT TO anon USING (true);
  END IF;
END; $$;
