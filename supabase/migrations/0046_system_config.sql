-- System configuration table for persisting state between cron runs
CREATE TABLE IF NOT EXISTS system_config (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- Rotating offset for fetch-prices: tracks which batch of tickers to fetch next
INSERT INTO system_config (key, value)
VALUES ('fetch_prices_offset', '0')
ON CONFLICT (key) DO NOTHING;
