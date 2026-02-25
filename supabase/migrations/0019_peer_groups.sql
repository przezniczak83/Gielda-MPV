-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0019_peer_groups.sql
-- peer_groups + peer_group_members + default seeding
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS peer_groups (
  id          bigserial  PRIMARY KEY,
  name        text       NOT NULL,
  sector      text,
  description text,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS peer_group_members (
  id            bigserial  PRIMARY KEY,
  peer_group_id bigint     REFERENCES peer_groups(id) ON DELETE CASCADE,
  ticker        text       NOT NULL REFERENCES companies(ticker),
  is_primary    boolean    DEFAULT false,
  UNIQUE(peer_group_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_pgm_peer_group_id ON peer_group_members(peer_group_id);
CREATE INDEX IF NOT EXISTS idx_pgm_ticker        ON peer_group_members(ticker);

ALTER TABLE peer_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE peer_group_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'peer_groups' AND policyname = 'anon_read_peer_groups') THEN
    CREATE POLICY "anon_read_peer_groups" ON peer_groups FOR SELECT TO anon USING (true);
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'peer_group_members' AND policyname = 'anon_read_peer_group_members') THEN
    CREATE POLICY "anon_read_peer_group_members" ON peer_group_members FOR SELECT TO anon USING (true);
  END IF;
END; $$;

-- Default peer groups
INSERT INTO peer_groups (name, sector) VALUES
  ('Banki GPW',    'Banking'),
  ('Energetyka GPW','Energy'),
  ('Gaming GPW',   'Gaming'),
  ('Retail GPW',   'Retail'),
  ('Big Tech USA', 'Technology')
ON CONFLICT DO NOTHING;

-- Banki GPW (id=1) — only insert tickers that exist in companies
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT 1, t.ticker, t.is_primary FROM (VALUES
  ('PKO',  true),
  ('PZU',  false),
  ('MBK',  false),
  ('ALR',  false),
  ('ING',  false),
  ('BNP',  false)
) AS t(ticker, is_primary)
WHERE EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- Energetyka GPW (id=2)
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT 2, t.ticker, t.is_primary FROM (VALUES
  ('PKN',  true),
  ('PGE',  false),
  ('TPE',  false),
  ('ENA',  false),
  ('PGN',  false)
) AS t(ticker, is_primary)
WHERE EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- Gaming GPW (id=3)
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT 3, t.ticker, t.is_primary FROM (VALUES
  ('CDR',  true),
  ('TEN',  false),
  ('11B',  false),
  ('PLY',  false),
  ('PCF',  false)
) AS t(ticker, is_primary)
WHERE EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- Big Tech USA (id=5)
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT 5, t.ticker, t.is_primary FROM (VALUES
  ('AAPL',  true),
  ('MSFT',  false),
  ('GOOGL', false),
  ('AMZN',  false),
  ('META',  false),
  ('NVDA',  false)
) AS t(ticker, is_primary)
WHERE EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;
