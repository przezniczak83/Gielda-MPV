-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0024_rls_hardening.sql
-- RLS hardening for legacy tables (news, news_audit, tickers)
-- that pre-date the migration system and lack Row Level Security.
--
-- Existing tables from 0001-0021 all have RLS enabled.
-- This migration covers the remaining 3 legacy tables.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── news ─────────────────────────────────────────────────────────────────────
-- Public news table — anon read allowed, write via service_role only.

ALTER TABLE IF EXISTS news ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'news' AND policyname = 'anon_read_news'
  ) THEN
    CREATE POLICY "anon_read_news" ON news FOR SELECT TO anon USING (true);
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'news' AND policyname = 'service_role_all_news'
  ) THEN
    CREATE POLICY "service_role_all_news" ON news
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END; $$;

-- ── news_audit ────────────────────────────────────────────────────────────────
-- Internal audit trail — anon has NO access.

ALTER TABLE IF EXISTS news_audit ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'news_audit' AND policyname = 'service_role_all_news_audit'
  ) THEN
    CREATE POLICY "service_role_all_news_audit" ON news_audit
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END; $$;

-- anon has NO policy on news_audit — blocked by default.

-- ── tickers ──────────────────────────────────────────────────────────────────
-- Reference list of allowed tickers — anon read allowed.

ALTER TABLE IF EXISTS tickers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'tickers' AND policyname = 'anon_read_tickers'
  ) THEN
    CREATE POLICY "anon_read_tickers" ON tickers FOR SELECT TO anon USING (true);
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'tickers' AND policyname = 'service_role_all_tickers'
  ) THEN
    CREATE POLICY "service_role_all_tickers" ON tickers
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END; $$;
