-- Add last_price, change_1d, price_updated_at columns to companies
-- Used by TickerTape, TopMovers and other components for fast price access
-- Updated by fetch-prices after each upsert

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS last_price         numeric(12, 4),
  ADD COLUMN IF NOT EXISTS change_1d          numeric(10, 4),
  ADD COLUMN IF NOT EXISTS price_updated_at   timestamptz;

-- Backfill change_1d from existing price_history
-- NOTE: column is `close` (not close_price)
UPDATE companies c
SET
  last_price       = today.close,
  change_1d        = ROUND(
    ((today.close - yesterday.close) / yesterday.close * 100)::numeric, 4
  ),
  price_updated_at = NOW()
FROM (
  SELECT DISTINCT ON (ticker) ticker, close, date
  FROM price_history
  ORDER BY ticker, date DESC
) today
JOIN (
  SELECT DISTINCT ON (ticker) ticker, close
  FROM price_history p2
  WHERE date < (
    SELECT MAX(date) FROM price_history p3 WHERE p3.ticker = p2.ticker
  )
  ORDER BY ticker, date DESC
) yesterday ON yesterday.ticker = today.ticker
WHERE c.ticker = today.ticker
  AND yesterday.close > 0;

-- Verify
SELECT COUNT(*) FILTER (WHERE change_1d IS NOT NULL) AS with_change,
       COUNT(*) FILTER (WHERE change_1d IS NULL)     AS without_change,
       COUNT(*)                                       AS total
FROM companies;
