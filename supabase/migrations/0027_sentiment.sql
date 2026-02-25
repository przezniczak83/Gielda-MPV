-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0027_sentiment.sql
-- Stores AI-generated sentiment analysis per company.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS company_sentiment (
  ticker      text         PRIMARY KEY REFERENCES companies(ticker) ON DELETE CASCADE,
  score       numeric      NOT NULL,                   -- -1.0 to +1.0
  label       text         NOT NULL,                   -- BULLISH / NEUTRAL / BEARISH
  summary     text         NOT NULL DEFAULT '',
  raw_json    jsonb        NOT NULL DEFAULT '{}',
  analyzed_at timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_sentiment_analyzed
  ON company_sentiment(analyzed_at DESC);

ALTER TABLE company_sentiment ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'company_sentiment' AND policyname = 'anon_read_company_sentiment'
  ) THEN
    CREATE POLICY "anon_read_company_sentiment"
      ON company_sentiment FOR SELECT TO anon USING (true);
  END IF;
END; $$;
