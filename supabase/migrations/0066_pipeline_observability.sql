-- Pipeline observability: run logs, batch checkpoints, and news_items indexes

-- ── pipeline_runs: log every Edge Function invocation ────────────────────────
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id            BIGSERIAL PRIMARY KEY,
  function_name TEXT        NOT NULL,
  source        TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  status        TEXT        NOT NULL DEFAULT 'running',  -- running|success|failed
  items_in      INT         DEFAULT 0,
  items_out     INT         DEFAULT 0,
  errors        INT         DEFAULT 0,
  details       JSONB       DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_fn_started
  ON pipeline_runs (function_name, started_at DESC);

-- ── price_fetch_batches: checkpoint for price fetching ────────────────────────
CREATE TABLE IF NOT EXISTS price_fetch_batches (
  batch_key       TEXT PRIMARY KEY,   -- 'gpw_batch_01' ... 'main'
  last_run_at     TIMESTAMPTZ,
  last_offset     INT  DEFAULT 0,
  last_status     TEXT DEFAULT 'never',
  tickers_fetched INT  DEFAULT 0,
  tickers_failed  INT  DEFAULT 0
);

-- ── Indexes on news_items (critical for query performance) ────────────────────
CREATE INDEX IF NOT EXISTS idx_news_published_at
  ON news_items (published_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_ai_backlog
  ON news_items (published_at DESC)
  WHERE ai_processed = false;

CREATE INDEX IF NOT EXISTS idx_news_source_published
  ON news_items (source, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_tickers_gin
  ON news_items USING GIN (tickers);

-- ── Index on companies.price_updated_at ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_companies_price_updated
  ON companies (price_updated_at DESC);

-- Verify
SELECT
  (SELECT COUNT(*) FROM pipeline_runs)         AS pipeline_runs,
  (SELECT COUNT(*) FROM price_fetch_batches)   AS price_fetch_batches;
