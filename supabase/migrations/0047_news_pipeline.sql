CREATE TABLE IF NOT EXISTS news_items (
  id           bigserial PRIMARY KEY,
  url_hash     text UNIQUE NOT NULL,  -- SHA-256 URL hash for deduplication
  url          text NOT NULL,
  title        text NOT NULL,
  summary      text,
  source       text NOT NULL,         -- 'pap', 'stooq', 'bankier', 'strefa', 'wp', 'youtube'
  published_at timestamptz,
  fetched_at   timestamptz DEFAULT now(),

  -- AI analysis
  tickers      text[] DEFAULT '{}',   -- ['PKN', 'PZU']
  sector       text,
  sentiment    numeric(3,2),           -- -1.00 to +1.00
  impact_score integer,               -- 1-10
  category     text,                  -- 'earnings','dividend','management','macro','other'
  ai_summary   text,                  -- 1-2 sentences in Polish
  ai_processed boolean DEFAULT false,

  -- Alert
  telegram_sent boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS news_items_published_at_idx ON news_items(published_at DESC);
CREATE INDEX IF NOT EXISTS news_items_tickers_idx ON news_items USING gin(tickers);
CREATE INDEX IF NOT EXISTS news_items_ai_processed_idx ON news_items(ai_processed) WHERE ai_processed = false;
CREATE INDEX IF NOT EXISTS news_items_impact_idx ON news_items(impact_score DESC);
