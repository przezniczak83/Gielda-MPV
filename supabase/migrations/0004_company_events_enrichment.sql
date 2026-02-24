-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0004_company_events_enrichment.sql
-- Adds event_type, impact_score, content_hash to company_events.
-- content_hash: SHA-256(ticker|title|published_at) for deduplication.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE company_events
  ADD COLUMN IF NOT EXISTS event_type    text,
  ADD COLUMN IF NOT EXISTS impact_score  integer,
  ADD COLUMN IF NOT EXISTS content_hash  text UNIQUE;

CREATE INDEX IF NOT EXISTS company_events_event_type_idx
  ON company_events (event_type);

CREATE INDEX IF NOT EXISTS company_events_impact_score_idx
  ON company_events (impact_score DESC);
