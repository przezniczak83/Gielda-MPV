-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0018_portfolio.sql
-- portfolio_positions + portfolio_transactions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portfolio_positions (
  id             bigserial    PRIMARY KEY,
  ticker         text         NOT NULL REFERENCES companies(ticker),
  shares         numeric(12,4) NOT NULL,
  avg_buy_price  numeric(12,4) NOT NULL,
  currency       text         DEFAULT 'PLN',
  opened_at      timestamptz  DEFAULT now(),
  closed_at      timestamptz,
  notes          text,
  created_at     timestamptz  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_positions_ticker ON portfolio_positions(ticker);

CREATE TABLE IF NOT EXISTS portfolio_transactions (
  id               bigserial    PRIMARY KEY,
  ticker           text         NOT NULL REFERENCES companies(ticker),
  transaction_type text         CHECK (transaction_type IN ('BUY','SELL')),
  shares           numeric(12,4) NOT NULL,
  price            numeric(12,4) NOT NULL,
  commission       numeric(10,4) DEFAULT 0,
  currency         text         DEFAULT 'PLN',
  executed_at      timestamptz  NOT NULL,
  notes            text,
  created_at       timestamptz  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_transactions_ticker ON portfolio_transactions(ticker);

ALTER TABLE portfolio_positions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_transactions  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'portfolio_positions' AND policyname = 'service_role_all_portfolio_positions') THEN
    CREATE POLICY "service_role_all_portfolio_positions"
      ON portfolio_positions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'portfolio_transactions' AND policyname = 'service_role_all_portfolio_transactions') THEN
    CREATE POLICY "service_role_all_portfolio_transactions"
      ON portfolio_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END; $$;
