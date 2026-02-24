-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0001_init.sql
-- Staging table for raw ESPI/email ingest + processed company_events.
-- Apply manually in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- NIE uruchamiaj destrukcyjnych komend (DROP) bez zgody.
-- ─────────────────────────────────────────────────────────────────────────────

-- Ensure pgcrypto for gen_random_uuid() on older Supabase projects
-- (Supabase 2.x uses pg_catalog.gen_random_uuid() built-in, but belt-and-suspenders):
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── raw_ingest ────────────────────────────────────────────────────────────────
-- Staging: każdy rekord = jeden fetch z zewnętrznego źródła (ESPI, email, etc.)
-- Przetwarzanie asynchroniczne → processed_at ustawiane po parsowaniu do company_events.

CREATE TABLE IF NOT EXISTS raw_ingest (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text        NOT NULL,                -- 'espi' | 'email' | 'manual'
  payload      jsonb       NOT NULL,                -- surowy JSON z zewnętrznego źródła
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL                     -- null = oczekuje na przetworzenie
);

CREATE INDEX IF NOT EXISTS raw_ingest_source_idx       ON raw_ingest (source);
CREATE INDEX IF NOT EXISTS raw_ingest_fetched_at_idx   ON raw_ingest (fetched_at DESC);
CREATE INDEX IF NOT EXISTS raw_ingest_unprocessed_idx  ON raw_ingest (fetched_at DESC)
  WHERE processed_at IS NULL;                        -- szybkie pobieranie kolejki

-- ── company_events ────────────────────────────────────────────────────────────
-- Przetworzone zdarzenia korporacyjne (ESPI, wyniki, dywidendy, etc.)
-- Minimalna tabela MVP — rozszerz o impact_score, category gdy LLM gotowy.

CREATE TABLE IF NOT EXISTS company_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker       text        NOT NULL,
  title        text        NOT NULL,
  url          text        UNIQUE NULL,              -- dedupe po URL
  published_at timestamptz NULL,
  source       text        NOT NULL DEFAULT 'espi',
  raw_id       uuid        REFERENCES raw_ingest(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_events_ticker_idx      ON company_events (ticker);
CREATE INDEX IF NOT EXISTS company_events_published_at_idx ON company_events (published_at DESC);
CREATE INDEX IF NOT EXISTS company_events_created_at_idx  ON company_events (created_at DESC);

-- ── RLS (Row Level Security) ──────────────────────────────────────────────────
-- Odczyt publiczny przez anon key (Next.js frontend).
-- Zapis tylko przez service_role key (Edge Functions).

ALTER TABLE raw_ingest     ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_events ENABLE ROW LEVEL SECURITY;

-- Anon może czytać company_events (frontend)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'company_events'
      AND policyname = 'anon_read_company_events'
  ) THEN
    CREATE POLICY "anon_read_company_events"
      ON company_events FOR SELECT TO anon USING (true);
  END IF;
END; $$;

-- Anon NIE może czytać raw_ingest (staging, wewnętrzny)
-- (brak polityki SELECT dla anon = brak dostępu)

-- service_role ma pełny dostęp (bypass RLS domyślnie w Supabase)

-- ── Weryfikacja ───────────────────────────────────────────────────────────────
-- Po wykonaniu sprawdź:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name IN ('raw_ingest','company_events');
-- Oczekiwany output: 2 wiersze.
