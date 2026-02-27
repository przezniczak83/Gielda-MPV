-- Add ticker matching metadata columns to news_items
-- ticker_method: how tickers were identified
-- ticker_evidence: which aliases/positions triggered the match
-- ticker_version: algorithm version (increment when logic changes)

ALTER TABLE news_items
  ADD COLUMN IF NOT EXISTS ticker_method   TEXT
    CHECK (ticker_method IN ('deterministic', 'ai', 'espi_url', 'manual')),
  ADD COLUMN IF NOT EXISTS ticker_evidence JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ticker_version  INT   DEFAULT 1;

-- Backfill existing ESPI items as espi_url method (they were matched by URL/title)
UPDATE news_items
SET ticker_method = 'espi_url'
WHERE source = 'espi'
  AND tickers IS NOT NULL
  AND array_length(tickers, 1) > 0
  AND ticker_method IS NULL;

-- Backfill processed non-ESPI items as 'ai'
UPDATE news_items
SET ticker_method = 'ai'
WHERE ai_processed = true
  AND source != 'espi'
  AND ticker_method IS NULL;

-- Verify
SELECT ticker_method, COUNT(*) FROM news_items GROUP BY ticker_method ORDER BY COUNT(*) DESC;
