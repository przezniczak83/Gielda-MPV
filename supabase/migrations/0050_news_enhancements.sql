-- 0050_news_enhancements.sql
-- News pipeline v2 enhancements:
--   1. ticker_aliases    — alias map for better ticker extraction
--   2. news_items ext    — key_facts, topics, is_breaking, source_url, etc.
--   3. sentiment_daily   — daily aggregation per ticker
--   4. companies ext     — last_news_at, news_count_30d, avg_sentiment_30d
--   5. ingestion_log     — pipeline monitoring

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ticker_aliases
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ticker_aliases (
  id         bigserial PRIMARY KEY,
  ticker     text NOT NULL,
  alias      text NOT NULL,
  alias_type text NOT NULL, -- 'official_name' | 'short_name' | 'brand' | 'abbreviation'
  language   text DEFAULT 'pl',
  UNIQUE(alias)
);

CREATE INDEX IF NOT EXISTS ticker_aliases_alias_idx  ON ticker_aliases(lower(alias));
CREATE INDEX IF NOT EXISTS ticker_aliases_ticker_idx ON ticker_aliases(ticker);

-- Seed: generate aliases from companies table (ticker + name variants)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT ticker, name
    FROM companies
    ORDER BY ticker
  LOOP
    BEGIN
      -- ticker abbreviation (lowercase)
      INSERT INTO ticker_aliases (ticker, alias, alias_type)
      VALUES (r.ticker, lower(r.ticker), 'abbreviation')
      ON CONFLICT (alias) DO NOTHING;

      -- official name (lowercase)
      IF r.name IS NOT NULL AND length(trim(r.name)) > 0 THEN
        INSERT INTO ticker_aliases (ticker, alias, alias_type)
        VALUES (r.ticker, lower(trim(r.name)), 'official_name')
        ON CONFLICT (alias) DO NOTHING;

        -- Name stripped of common suffixes: S.A., S.A, sp. z o.o., SA
        INSERT INTO ticker_aliases (ticker, alias, alias_type)
        VALUES (
          r.ticker,
          lower(trim(regexp_replace(r.name, '\s*(S\.?A\.?|sp\.\s*z\s*o\.o\.?|spółka akcyjna)\s*$', '', 'i'))),
          'short_name'
        )
        ON CONFLICT (alias) DO NOTHING;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Skip problematic rows silently
      NULL;
    END;
  END LOOP;
END;
$$;

-- Manual overrides for high-value aliases
INSERT INTO ticker_aliases (ticker, alias, alias_type) VALUES
  ('PKN', 'orlen',            'brand'),
  ('PKN', 'pkn orlen',        'brand'),
  ('PKN', 'polska koncern naftowy', 'official_name'),
  ('ALE', 'allegro',          'brand'),
  ('ALE', 'allegro.eu',       'brand'),
  ('CDR', 'cd projekt',       'brand'),
  ('CDR', 'cd projekt red',   'brand'),
  ('CDR', 'cdp',              'abbreviation'),
  ('KGH', 'kghm',             'brand'),
  ('KGH', 'kghm polska miedź','official_name'),
  ('PZU', 'powszechny zakład ubezpieczeń', 'official_name'),
  ('PKO', 'pko bank polski',  'official_name'),
  ('PKO', 'pko bp',           'brand'),
  ('PEO', 'bank pekao',       'brand'),
  ('PEO', 'pekao',            'brand'),
  ('SPL', 'santander bank polska', 'official_name'),
  ('MBK', 'mbank',            'brand'),
  ('LPP', 'lpp',              'abbreviation'),
  ('DNP', 'dino polska',      'official_name'),
  ('CPS', 'cyfrowy polsat',   'official_name'),
  ('CPS', 'polsat',           'brand'),
  ('PGE', 'polska grupa energetyczna', 'official_name'),
  ('ENA', 'enea',             'brand'),
  ('ATT', 'asseco',           'brand'),
  ('ATT', 'asseco poland',    'official_name'),
  ('JSW', 'jastrzębska spółka węglowa', 'official_name'),
  ('GPW', 'giełda papierów wartościowych', 'official_name'),
  ('XTB', 'xtb',              'brand'),
  ('KRU', 'kruk',             'brand'),
  ('BDX', 'budimex',          'brand'),
  ('TPE', 'tauron',           'brand'),
  ('PCO', 'polskie górnictwo naftowe', 'official_name'),
  ('GNB', 'getin noble bank', 'official_name'),
  ('PLY', 'play',             'brand'),
  ('OPL', 'orange polska',    'official_name'),
  ('OPL', 'orange',           'brand'),
  ('TEN', 'ten square games', 'official_name'),
  ('ABS', 'agora',            'brand')
ON CONFLICT (alias) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. news_items extensions
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE news_items
  ADD COLUMN IF NOT EXISTS source_url        text,
  ADD COLUMN IF NOT EXISTS key_facts         jsonb   DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS topics            text[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_breaking       boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS impact_assessment text,
  ADD COLUMN IF NOT EXISTS relevance_score   numeric(3,2) DEFAULT 1.0;

CREATE INDEX IF NOT EXISTS news_items_is_breaking_idx
  ON news_items(is_breaking) WHERE is_breaking = true;
CREATE INDEX IF NOT EXISTS news_items_topics_idx
  ON news_items USING gin(topics);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. sentiment_daily
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sentiment_daily (
  id             bigserial PRIMARY KEY,
  ticker         text NOT NULL,
  date           date NOT NULL,
  avg_sentiment  numeric(4,3),
  min_sentiment  numeric(4,3),
  max_sentiment  numeric(4,3),
  message_count  int DEFAULT 0,
  positive_count int DEFAULT 0,
  negative_count int DEFAULT 0,
  neutral_count  int DEFAULT 0,
  breaking_count int DEFAULT 0,
  dominant_topic text,
  UNIQUE(ticker, date)
);

CREATE INDEX IF NOT EXISTS sentiment_daily_ticker_date_idx
  ON sentiment_daily(ticker, date DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. companies extensions
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS last_news_at      timestamptz,
  ADD COLUMN IF NOT EXISTS news_count_30d    int   DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_sentiment_30d numeric(4,3);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ingestion_log
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ingestion_log (
  id               bigserial PRIMARY KEY,
  source_name      text NOT NULL,
  started_at       timestamptz DEFAULT now(),
  finished_at      timestamptz,
  status           text NOT NULL, -- 'success' | 'partial_failure' | 'failure'
  messages_fetched int DEFAULT 0,
  messages_new     int DEFAULT 0,
  messages_failed  int DEFAULT 0,
  error_details    jsonb,
  duration_ms      int,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingestion_log_source_idx
  ON ingestion_log(source_name, created_at DESC);
