-- Add RS (Relative Strength) score columns to companies
-- rs_score  = ticker_price / WIG20_price * 100 (normalized to 100 at start of period)
-- rs_trend  = direction of RS over last 5 days: 'up' | 'down' | 'flat'
-- Updated by fetch-prices after each upsert

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS rs_score      numeric(10, 4),
  ADD COLUMN IF NOT EXISTS rs_trend      text CHECK (rs_trend IN ('up', 'down', 'flat')),
  ADD COLUMN IF NOT EXISTS rs_updated_at timestamptz;

-- Verify
SELECT COUNT(*) FILTER (WHERE rs_score IS NOT NULL) AS with_rs,
       COUNT(*) AS total
FROM companies;
