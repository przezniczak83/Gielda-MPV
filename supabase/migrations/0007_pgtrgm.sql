-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0007_pgtrgm.sql
-- pg_trgm extension + helper function dla fuzzy dedup w process-raw.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index na title dla szybkich similarity queries
CREATE INDEX IF NOT EXISTS idx_company_events_title_trgm
  ON company_events USING gin (title gin_trgm_ops);

-- Helper function: sprawdź czy istnieje event z podobnym tytułem
-- (same ticker, same date, similarity > threshold)
-- Używane przez process-raw Edge Function przez supabase.rpc()
CREATE OR REPLACE FUNCTION find_fuzzy_duplicate(
  p_ticker         text,
  p_published_date date,
  p_title          text,
  p_threshold      float DEFAULT 0.8
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS(
    SELECT 1
    FROM   company_events
    WHERE  ticker          = p_ticker
      AND  published_at IS NOT NULL
      AND  published_at::date = p_published_date
      AND  similarity(title, p_title) > p_threshold
  );
$$;

-- Weryfikacja:
-- SELECT find_fuzzy_duplicate('PKN', '2026-02-24', 'Wyniki finansowe za Q4 2025');
