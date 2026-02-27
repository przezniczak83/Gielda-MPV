-- Stored procedure to backfill companies.last_price + change_1d from price_history
-- Called by fetch-prices after bulk upsert.
-- Column name is `close` (NOT close_price).

CREATE OR REPLACE FUNCTION update_companies_prices_from_history()
RETURNS void LANGUAGE sql AS $$
UPDATE companies c
SET
  last_price       = ph_today.close,
  change_1d        = ROUND(
    ((ph_today.close - ph_prev.close) / NULLIF(ph_prev.close, 0) * 100)::numeric, 4
  ),
  price_updated_at = NOW()
FROM (
  SELECT DISTINCT ON (ticker) ticker, close, date
  FROM price_history
  ORDER BY ticker, date DESC
) ph_today
LEFT JOIN (
  SELECT DISTINCT ON (ticker) ticker, close
  FROM price_history p
  WHERE date < (SELECT MAX(date) FROM price_history p2 WHERE p2.ticker = p.ticker)
  ORDER BY ticker, date DESC
) ph_prev ON ph_prev.ticker = ph_today.ticker
WHERE c.ticker = ph_today.ticker
  AND ph_today.date >= CURRENT_DATE - INTERVAL '3 days';
$$;
