-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0015_watchlists.sql
-- Watchlisty: listy spółek do monitorowania.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS watchlists (
  id          bigserial    PRIMARY KEY,
  name        text         NOT NULL,
  description text,
  is_smart    boolean      DEFAULT false,
  smart_query jsonb,
  created_at  timestamptz  DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watchlist_items (
  id                 bigserial    PRIMARY KEY,
  watchlist_id       bigint       REFERENCES watchlists(id) ON DELETE CASCADE,
  ticker             text         NOT NULL REFERENCES companies(ticker),
  notes              text,
  alert_price_above  numeric(12,4),
  alert_price_below  numeric(12,4),
  added_at           timestamptz  DEFAULT now(),
  UNIQUE(watchlist_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_items_watchlist
  ON watchlist_items(watchlist_id);

CREATE INDEX IF NOT EXISTS idx_watchlist_items_ticker
  ON watchlist_items(ticker);

ALTER TABLE watchlists       ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist_items  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'watchlists' AND policyname = 'anon_read_watchlists') THEN
    CREATE POLICY "anon_read_watchlists" ON watchlists FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'watchlist_items' AND policyname = 'anon_read_watchlist_items') THEN
    CREATE POLICY "anon_read_watchlist_items" ON watchlist_items FOR SELECT TO anon USING (true);
  END IF;
END; $$;

-- Domyślne watchlisty
INSERT INTO watchlists (name, description) VALUES
  ('GPW Core',    'Główne spółki GPW do monitorowania'),
  ('USA Tech',    'Spółki technologiczne USA'),
  ('Dywidendy',   'Spółki dywidendowe GPW'),
  ('Obserwowane', 'Spółki pod obserwacją')
ON CONFLICT DO NOTHING;
