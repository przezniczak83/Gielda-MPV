-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0040_chat_history.sql
-- chat_history — stores AI chat messages per ticker for persistent context
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_history (
  id          bigserial    PRIMARY KEY,
  ticker      text         NOT NULL REFERENCES companies(ticker) ON DELETE CASCADE,
  role        text         NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text         NOT NULL,
  created_at  timestamptz  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_history_ticker     ON chat_history(ticker);
CREATE INDEX IF NOT EXISTS idx_chat_history_created_at ON chat_history(created_at DESC);

ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chat_history' AND policyname = 'anon_read_chat_history'
  ) THEN
    CREATE POLICY "anon_read_chat_history" ON chat_history FOR SELECT TO anon USING (true);
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chat_history' AND policyname = 'service_role_all_chat_history'
  ) THEN
    CREATE POLICY "service_role_all_chat_history"
      ON chat_history FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END; $$;
