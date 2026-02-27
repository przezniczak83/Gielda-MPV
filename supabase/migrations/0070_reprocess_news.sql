-- 0070_reprocess_news.sql
-- Reset news_items without tickers for re-processing (last 14 days, non-ESPI).
-- This fixes the 78% articles without tickers by running process-news on them again
-- with the improved deterministic matcher (ticker_version=2).

-- Count before (for verification)
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE tickers = '{}'  OR tickers IS NULL) AS empty_tickers,
  COUNT(*) FILTER (WHERE tickers != '{}' AND tickers IS NOT NULL) AS has_tickers,
  ROUND(
    COUNT(*) FILTER (WHERE tickers != '{}' AND tickers IS NOT NULL)::numeric
    / NULLIF(COUNT(*), 0) * 100
  ) AS coverage_pct
FROM news_items
WHERE published_at > NOW() - INTERVAL '14 days'
  AND source != 'espi';

-- Reset articles without tickers in last 14 days (non-ESPI only)
-- ai_processed = false → process-news will pick them up on next run
UPDATE news_items
SET
  ai_processed   = false,
  ai_summary     = NULL,
  key_facts      = '[]'::jsonb,
  tickers        = '{}',
  ticker_confidence = '{}'::jsonb,
  ticker_method  = NULL,
  ticker_evidence = '[]'::jsonb,
  ticker_version = NULL
WHERE
  published_at > NOW() - INTERVAL '14 days'
  AND source NOT IN ('espi')
  AND (
    tickers IS NULL
    OR tickers = '{}'
    OR array_length(tickers, 1) IS NULL
    OR ai_summary IS NULL
  );

-- Count after reset (verify backlog created)
SELECT COUNT(*) AS new_backlog
FROM news_items
WHERE ai_processed = false;
