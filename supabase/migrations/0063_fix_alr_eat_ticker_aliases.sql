-- Fix: ALR (Alior Bank) had AmRest brand aliases — move them to EAT (AmRest Holdings SE)

-- Step 1: Remove wrong AmRest aliases from ALR
DELETE FROM ticker_aliases
WHERE ticker = 'ALR'
  AND alias IN ('amrest', 'am rest', 'amrest holdings');

-- Step 2: Insert correct AmRest aliases for EAT
INSERT INTO ticker_aliases (ticker, alias, alias_type, language)
VALUES
  ('EAT', 'amrest',          'brand', 'pl'),
  ('EAT', 'am rest',         'brand', 'pl'),
  ('EAT', 'amrest holdings', 'brand', 'pl')
ON CONFLICT (alias) DO UPDATE SET ticker = EXCLUDED.ticker, alias_type = EXCLUDED.alias_type;

-- Step 3: Clean bad article id=2785 — Ailleron article incorrectly tagged with ALR
UPDATE news_items
SET
  tickers            = ARRAY_REMOVE(tickers, 'ALR'),
  ticker_confidence  = ticker_confidence - 'ALR'
WHERE title ILIKE '%ailleron%'
  AND 'ALR' = ANY(tickers);

-- Step 4: Also fix any other articles where ALR appears but content is clearly about AmRest
-- (AmRest aliases → ALR false positives)
UPDATE news_items
SET
  ai_processed       = false,
  ai_summary         = null,
  key_facts          = '[]'::jsonb,
  tickers            = ARRAY_REMOVE(tickers, 'ALR'),
  ticker_confidence  = ticker_confidence - 'ALR'
WHERE 'ALR' = ANY(tickers)
  AND (
    title ILIKE '%amrest%'
    OR ai_summary ILIKE '%amrest%'
  );

-- Step 5: Verify
SELECT ticker, COUNT(*) AS alias_count
FROM ticker_aliases
WHERE ticker IN ('ALR', 'EAT', 'ALL')
GROUP BY ticker
ORDER BY ticker;
