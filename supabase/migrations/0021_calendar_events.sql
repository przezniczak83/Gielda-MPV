-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0021_calendar_events.sql
-- calendar_events — upcoming corporate events (earnings, dividends, AGM, etc.)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calendar_events (
  id          bigserial  PRIMARY KEY,
  ticker      text       NOT NULL REFERENCES companies(ticker),
  event_type  text       NOT NULL CHECK (event_type IN ('earnings','dividend_exdate','agm','analyst_day','other')),
  event_date  timestamptz NOT NULL,
  title       text       NOT NULL,
  description text,
  source      text       DEFAULT 'manual',
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_date   ON calendar_events(event_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_ticker ON calendar_events(ticker);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'calendar_events' AND policyname = 'anon_read_calendar_events') THEN
    CREATE POLICY "anon_read_calendar_events" ON calendar_events FOR SELECT TO anon USING (true);
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'calendar_events' AND policyname = 'service_role_all_calendar_events') THEN
    CREATE POLICY "service_role_all_calendar_events"
      ON calendar_events FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END; $$;

-- Test data
INSERT INTO calendar_events (ticker, event_type, event_date, title) VALUES
  ('PKN',  'earnings',       now() + interval '7 days',  'Wyniki Q4 2025'),
  ('PZU',  'earnings',       now() + interval '14 days', 'Wyniki Q4 2025'),
  ('CDR',  'earnings',       now() + interval '21 days', 'Wyniki Q4 2025'),
  ('KGHM', 'dividend_exdate',now() + interval '10 days', 'Ex-dividend KGHM'),
  ('LPP',  'earnings',       now() + interval '30 days', 'Wyniki Q4 2025'),
  ('PKO',  'earnings',       now() + interval '17 days', 'Wyniki Q4 2025'),
  ('PGE',  'agm',            now() + interval '45 days', 'Walne Zgromadzenie Akcjonariuszy'),
  ('MBK',  'analyst_day',    now() + interval '35 days', 'Dzień Analityków 2026')
ON CONFLICT DO NOTHING;
