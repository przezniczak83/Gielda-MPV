-- 0055_clean_false_positive_tickers.sql
-- Remove false-positive ticker assignments from historical news_items.
-- Keeps only tickers that exist in the companies table.
-- Articles whose tickers array changed are marked ai_processed=false
-- so they get reprocessed by the next cron run.

-- Step 1: Update news_items — filter tickers to only valid companies
-- Then mark as unprocessed if the tickers array actually changed
UPDATE news_items
SET
  tickers = ARRAY(
    SELECT t
    FROM UNNEST(tickers) AS t
    WHERE t IN (SELECT ticker FROM companies)
  ),
  ai_processed = CASE
    WHEN tickers IS DISTINCT FROM ARRAY(
      SELECT t
      FROM UNNEST(tickers) AS t
      WHERE t IN (SELECT ticker FROM companies)
    ) THEN false   -- changed → reprocess
    ELSE ai_processed
  END
WHERE
  tickers IS NOT NULL
  AND tickers <> '{}'
  AND EXISTS (
    SELECT 1
    FROM UNNEST(tickers) AS t
    WHERE t NOT IN (SELECT ticker FROM companies)
  );

-- Step 2: Report how many articles were affected
DO $$
DECLARE
  cnt integer;
BEGIN
  SELECT COUNT(*) INTO cnt
  FROM news_items
  WHERE ai_processed = false
    AND tickers = '{}';
  RAISE NOTICE 'Items with empty tickers marked for reprocessing: %', cnt;
END;
$$;
