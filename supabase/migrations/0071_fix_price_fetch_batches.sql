-- Migration 0071: Fix price_fetch_batches schema
-- Rename tickers_fetched → items_fetched, tickers_failed → items_failed
-- Add missing columns: tickers TEXT[], details JSONB

ALTER TABLE price_fetch_batches
  RENAME COLUMN tickers_fetched TO items_fetched;

ALTER TABLE price_fetch_batches
  RENAME COLUMN tickers_failed TO items_failed;

ALTER TABLE price_fetch_batches
  ADD COLUMN IF NOT EXISTS tickers TEXT[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS details JSONB   DEFAULT '{}';

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'price_fetch_batches'
ORDER BY ordinal_position;
