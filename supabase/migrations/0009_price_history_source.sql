-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0009_price_history_source.sql
-- Dodaje kolumnę source do price_history — śledzi które API dostarczyło dane.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE price_history ADD COLUMN IF NOT EXISTS source text DEFAULT 'unknown';

-- Index pomocniczy do diagnostyki
CREATE INDEX IF NOT EXISTS idx_price_history_source
  ON price_history(source);
