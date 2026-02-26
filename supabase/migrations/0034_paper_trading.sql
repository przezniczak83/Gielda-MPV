-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0034_paper_trading.sql
-- Virtual/paper trading — simulate stock buying/selling with virtual cash.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Paper portfolios (named virtual accounts) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS paper_portfolios (
  id           bigserial    PRIMARY KEY,
  name         text         NOT NULL,
  description  text,
  initial_cash numeric(15,2) NOT NULL DEFAULT 100000.00,
  cash_balance numeric(15,2) NOT NULL DEFAULT 100000.00,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now()
);

-- ── Trades (individual BUY/SELL orders) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS paper_trades (
  id             bigserial     PRIMARY KEY,
  portfolio_id   bigint        NOT NULL REFERENCES paper_portfolios(id) ON DELETE CASCADE,
  ticker         text          NOT NULL,
  direction      text          NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  quantity       integer       NOT NULL CHECK (quantity > 0),
  price          numeric(12,4) NOT NULL CHECK (price > 0),
  total_value    numeric(15,4) NOT NULL,   -- price * quantity
  note           text,
  traded_at      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paper_trades_portfolio ON paper_trades(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_paper_trades_ticker    ON paper_trades(ticker);

-- ── Positions (current holdings per portfolio/ticker) ─────────────────────────
CREATE TABLE IF NOT EXISTS paper_positions (
  portfolio_id    bigint        NOT NULL REFERENCES paper_portfolios(id) ON DELETE CASCADE,
  ticker          text          NOT NULL,
  quantity        integer       NOT NULL DEFAULT 0,
  avg_cost        numeric(12,4),          -- weighted average cost per share
  total_invested  numeric(15,4),          -- total cash spent
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (portfolio_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_paper_positions_ticker ON paper_positions(ticker);

-- ── RLS ────────────────────────────────────────────────────────────────────────
ALTER TABLE paper_portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_trades     ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_positions  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'paper_portfolios' AND policyname = 'anon_read_paper_portfolios') THEN
    CREATE POLICY "anon_read_paper_portfolios" ON paper_portfolios FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'paper_trades' AND policyname = 'anon_read_paper_trades') THEN
    CREATE POLICY "anon_read_paper_trades" ON paper_trades FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'paper_positions' AND policyname = 'anon_read_paper_positions') THEN
    CREATE POLICY "anon_read_paper_positions" ON paper_positions FOR SELECT TO anon USING (true);
  END IF;
END; $$;

-- ── Default portfolio ──────────────────────────────────────────────────────────
INSERT INTO paper_portfolios (name, description, initial_cash, cash_balance)
VALUES ('Mój Portfel Demo', 'Domyślny portfel do paper tradingu — 100 000 PLN', 100000, 100000)
ON CONFLICT DO NOTHING;
