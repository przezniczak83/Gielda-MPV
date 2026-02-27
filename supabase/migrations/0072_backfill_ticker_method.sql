-- 0072_backfill_ticker_method.sql
-- Fix ticker_method constraint + backfill NULL values.
--
-- Problems found:
-- 1. Paywall path in process-news wrote ticker_method = NULL when source ∈
--    (rp, parkiet, pb) and no deterministic match.  New code writes 'paywall'
--    but 'paywall' was not in the check constraint.
-- 2. ESPI path used 'espi_preset' which also wasn't in the constraint.
--    Code has been updated to use 'espi_url' (already allowed).
-- 3. Backfill: all remaining ai_processed=true articles with ticker_method IS NULL.

-- ── Step 1: extend the check constraint ──────────────────────────────────────
ALTER TABLE news_items DROP CONSTRAINT IF EXISTS news_items_ticker_method_check;

ALTER TABLE news_items
  ADD CONSTRAINT news_items_ticker_method_check
  CHECK (ticker_method IN ('deterministic', 'ai', 'espi_url', 'espi_preset', 'paywall', 'manual'));

-- ── Step 2: backfill NULLs ────────────────────────────────────────────────────

-- Paywall sources that were processed without AI (skipped due to no content)
UPDATE news_items
SET    ticker_method = 'paywall'
WHERE  ai_processed  = true
  AND  ticker_method IS NULL
  AND  source IN ('rp', 'parkiet', 'pb');

-- All other processed articles with NULL ticker_method → generic 'ai' fallback
UPDATE news_items
SET    ticker_method = 'ai'
WHERE  ai_processed  = true
  AND  ticker_method IS NULL;

-- ── Step 3: verify — should return 0 rows ─────────────────────────────────────
SELECT COUNT(*) AS remaining_null_ticker_method
FROM   news_items
WHERE  ai_processed  = true
  AND  ticker_method IS NULL;
