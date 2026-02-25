-- 0023_financials_fcf.sql
-- Add fcf (free cash flow / operating cash flow) column to company_financials

ALTER TABLE company_financials
  ADD COLUMN IF NOT EXISTS fcf numeric;
