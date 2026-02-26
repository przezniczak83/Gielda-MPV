-- 0057_ticker_confidence_and_groups.sql
-- KROK 1B: ticker_confidence — per-ticker confidence score from AI/heuristic
-- KROK 2A: event_group_id  — groups articles covering the same event
--
-- ticker_confidence format: {"PKN": 0.9, "ALE": 0.3}
--   1.0 = official document (ESPI/regulatory) for this company
--   0.8 = heuristic alias 8+ chars found in text
--   0.7 = heuristic alias 6-7 chars
--   0.6 = heuristic alias 4-5 chars (below display threshold)
--   AI-returned confidence passed through directly
--   Display threshold: > 0.6
--
-- event_group_id: articles about the same event share one UUID
--   Null = not yet grouped / single-source article

ALTER TABLE news_items
  ADD COLUMN IF NOT EXISTS ticker_confidence jsonb DEFAULT '{}'::jsonb;

ALTER TABLE news_items
  ADD COLUMN IF NOT EXISTS event_group_id uuid DEFAULT NULL;

-- Index for fast grouping queries
CREATE INDEX IF NOT EXISTS idx_news_items_event_group_id
  ON news_items (event_group_id)
  WHERE event_group_id IS NOT NULL;

-- Index for confidence-filtered ticker queries (GIN on JSONB)
CREATE INDEX IF NOT EXISTS idx_news_items_ticker_confidence
  ON news_items USING GIN (ticker_confidence);
