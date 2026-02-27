-- Step 1: Reset all ESPI from last 30 days (re-process with new ticker logic)
UPDATE news_items
SET
  tickers = '{}',
  ticker_confidence = '{}'::jsonb,
  ai_processed = false,
  ai_summary = null,
  key_facts = '[]'::jsonb
WHERE source = 'espi'
  AND published_at > NOW() - INTERVAL '30 days';

-- Step 2: Reset repeated summaries (hallucinations: same summary > 3 times)
WITH repeated AS (
  SELECT ai_summary
  FROM news_items
  WHERE ai_processed = true
    AND ai_summary IS NOT NULL
    AND published_at > NOW() - INTERVAL '30 days'
  GROUP BY ai_summary
  HAVING COUNT(*) > 3
)
UPDATE news_items
SET
  ai_processed = false,
  ai_summary = null,
  key_facts = '[]'::jsonb,
  tickers = '{}',
  ticker_confidence = '{}'::jsonb
WHERE ai_summary IN (SELECT ai_summary FROM repeated)
  AND published_at > NOW() - INTERVAL '30 days';

-- Step 3: Report pending count
SELECT COUNT(*) AS pending_reprocess FROM news_items WHERE ai_processed = false;
