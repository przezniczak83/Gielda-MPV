-- Migration 0059: Add relevance_score to news_items
-- relevance_score: 0.0–1.0 float indicating investor-relevance of the article
-- 0.0 = irrelevant (macro commentary, international news, general market noise)
-- 1.0 = highly relevant (direct company news, earnings, ESPI, breaking)
-- Default 0.5 (neutral/unknown) for existing rows

ALTER TABLE news_items
  ADD COLUMN IF NOT EXISTS relevance_score float DEFAULT 0.5;

-- Index for filtering low-relevance articles
CREATE INDEX IF NOT EXISTS idx_news_relevance
  ON news_items(relevance_score);

-- Composite index for the most common query pattern (processed + recent + relevant)
CREATE INDEX IF NOT EXISTS idx_news_processed_relevance
  ON news_items(ai_processed, published_at DESC, relevance_score)
  WHERE ai_processed = true;

-- ESPI articles are always highly relevant
UPDATE news_items
  SET relevance_score = 1.0
  WHERE source = 'espi' AND relevance_score = 0.5;

-- Breaking news is highly relevant
UPDATE news_items
  SET relevance_score = 0.9
  WHERE is_breaking = true AND relevance_score = 0.5;

-- Articles with tickers and high impact are relevant
UPDATE news_items
  SET relevance_score = 0.8
  WHERE array_length(tickers, 1) > 0
    AND impact_score >= 7
    AND relevance_score = 0.5;

-- Articles with tickers but lower impact are moderately relevant
UPDATE news_items
  SET relevance_score = 0.6
  WHERE array_length(tickers, 1) > 0
    AND relevance_score = 0.5;
