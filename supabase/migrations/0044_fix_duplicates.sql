-- Fix duplicate company tickers
-- Uses IF EXISTS guards for tables that may not exist on all environments

DO $$
DECLARE
  bad_tickers text[] := ARRAY['KGHM', 'PCR'];
BEGIN
  -- Non-CASCADE FKs — must delete before deleting companies
  DELETE FROM peer_group_members     WHERE ticker = ANY(bad_tickers);
  DELETE FROM company_events         WHERE ticker = ANY(bad_tickers);
  DELETE FROM calendar_events        WHERE ticker = ANY(bad_tickers);
  DELETE FROM watchlist_items        WHERE ticker = ANY(bad_tickers);
  DELETE FROM institutional_ownership WHERE ticker = ANY(bad_tickers);
  DELETE FROM company_kpis           WHERE ticker = ANY(bad_tickers);
  DELETE FROM company_snapshot       WHERE ticker = ANY(bad_tickers);

  -- Optional tables (guard against missing)
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'portfolio_positions') THEN
    EXECUTE 'DELETE FROM portfolio_positions WHERE ticker = ANY($1)' USING bad_tickers;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'portfolio_transactions') THEN
    EXECUTE 'DELETE FROM portfolio_transactions WHERE ticker = ANY($1)' USING bad_tickers;
  END IF;

  -- CASCADE handles: company_sentiment, alert_rules, dividends, sector_kpis, chat_history
  DELETE FROM companies WHERE ticker = ANY(bad_tickers);
END;
$$;
