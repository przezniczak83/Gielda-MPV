-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0008_company_financials.sql
-- Tabela company_financials — dane finansowe z raportów PDF.
-- Wypełniane przez Edge Function extract-pdf (Gemini 2.0 Flash).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_financials (
  id          bigserial    PRIMARY KEY,
  ticker      text         NOT NULL,
  period      text         NOT NULL,         -- np. "Q4 2025", "FY 2025"
  revenue     numeric(18,2),
  net_income  numeric(18,2),
  ebitda      numeric(18,2),
  eps         numeric(10,4),
  net_debt    numeric(18,2),
  currency    text         NOT NULL DEFAULT 'PLN',
  source_url  text,                          -- URL do oryginalnego PDF
  created_at  timestamptz  NOT NULL DEFAULT now(),
  UNIQUE(ticker, period)
);

CREATE INDEX IF NOT EXISTS idx_company_financials_ticker
  ON company_financials(ticker);

ALTER TABLE company_financials ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'company_financials'
      AND policyname = 'anon_read_company_financials'
  ) THEN
    CREATE POLICY "anon_read_company_financials"
      ON company_financials FOR SELECT TO anon USING (true);
  END IF;
END; $$;

-- Weryfikacja:
-- SELECT * FROM company_financials LIMIT 5;
