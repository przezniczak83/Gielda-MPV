-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0030_remove_portfolio_and_rename_ccc.sql
-- 1. Drop portfolio tables (feature removed — unnecessary complexity)
-- 2. Rename CCC → MDV (Modivo SA)
--    company_snapshot has a FK REFERENCES companies(ticker) without ON UPDATE CASCADE
--    so we must drop the FK, do all updates, then re-add it.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop portfolio tables
DROP TABLE IF EXISTS portfolio_transactions CASCADE;
DROP TABLE IF EXISTS portfolio_positions CASCADE;

-- Temporarily drop FK constraint that blocks the rename
ALTER TABLE company_snapshot DROP CONSTRAINT IF EXISTS company_snapshot_ticker_fkey;

-- Update child tables individually (each with its own exception handler for
-- tables that may not exist in all environments)
DO $$ BEGIN UPDATE company_events         SET ticker = 'MDV' WHERE ticker = 'CCC'; EXCEPTION WHEN OTHERS THEN NULL; END; $$;
DO $$ BEGIN UPDATE price_history          SET ticker = 'MDV' WHERE ticker = 'CCC'; EXCEPTION WHEN OTHERS THEN NULL; END; $$;
DO $$ BEGIN UPDATE company_kpis           SET ticker = 'MDV' WHERE ticker = 'CCC'; EXCEPTION WHEN OTHERS THEN NULL; END; $$;
DO $$ BEGIN UPDATE company_financials     SET ticker = 'MDV' WHERE ticker = 'CCC'; EXCEPTION WHEN OTHERS THEN NULL; END; $$;
DO $$ BEGIN UPDATE analyst_forecasts      SET ticker = 'MDV' WHERE ticker = 'CCC'; EXCEPTION WHEN OTHERS THEN NULL; END; $$;
DO $$ BEGIN UPDATE our_forecasts          SET ticker = 'MDV' WHERE ticker = 'CCC'; EXCEPTION WHEN OTHERS THEN NULL; END; $$;
DO $$ BEGIN UPDATE valuation_multiples    SET ticker = 'MDV' WHERE ticker = 'CCC'; EXCEPTION WHEN OTHERS THEN NULL; END; $$;
DO $$ BEGIN UPDATE raw_ingest             SET ticker = 'MDV' WHERE ticker = 'CCC'; EXCEPTION WHEN OTHERS THEN NULL; END; $$;
DO $$ BEGIN UPDATE insider_transactions   SET ticker = 'MDV' WHERE ticker = 'CCC'; EXCEPTION WHEN OTHERS THEN NULL; END; $$;
DO $$ BEGIN UPDATE institutional_ownership SET ticker = 'MDV' WHERE ticker = 'CCC'; EXCEPTION WHEN OTHERS THEN NULL; END; $$;
DO $$ BEGIN UPDATE calendar_events        SET ticker = 'MDV' WHERE ticker = 'CCC'; EXCEPTION WHEN OTHERS THEN NULL; END; $$;
DO $$ BEGIN UPDATE watchlist_items        SET ticker = 'MDV' WHERE ticker = 'CCC'; EXCEPTION WHEN OTHERS THEN NULL; END; $$;
DO $$ BEGIN UPDATE company_sentiment      SET ticker = 'MDV' WHERE ticker = 'CCC'; EXCEPTION WHEN OTHERS THEN NULL; END; $$;
DO $$ BEGIN UPDATE company_snapshot       SET ticker = 'MDV' WHERE ticker = 'CCC'; EXCEPTION WHEN OTHERS THEN NULL; END; $$;
DO $$ BEGIN UPDATE alert_rules            SET ticker = 'MDV' WHERE ticker = 'CCC'; EXCEPTION WHEN OTHERS THEN NULL; END; $$;

-- Rename the company itself
UPDATE companies
SET ticker = 'MDV', name = 'Modivo SA'
WHERE ticker = 'CCC' AND market = 'GPW';

-- Re-add the FK constraint (restoring original ON DELETE CASCADE semantics)
ALTER TABLE company_snapshot ADD CONSTRAINT company_snapshot_ticker_fkey
  FOREIGN KEY (ticker) REFERENCES companies(ticker) ON DELETE CASCADE;
