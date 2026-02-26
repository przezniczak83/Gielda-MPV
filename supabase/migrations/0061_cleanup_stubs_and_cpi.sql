-- Migration 0061: cleanup stub/test records + fix bad US CPI value in macro_indicators

-- ── Remove stub/test ESPI records from company_events ────────────────────────
DELETE FROM company_events
WHERE title ILIKE '%stub%'
   OR title ILIKE '%test rekord%'
   OR title ILIKE '%test record%'
   OR title ILIKE '%fallback%';

-- ── Remove stub/test records from news_items ──────────────────────────────────
DELETE FROM news_items
WHERE title ILIKE '%stub%'
   OR title ILIKE '%test rekord%'
   OR title ILIKE '%test record%'
   OR title ILIKE '%fallback — wszystkie źródła%';

-- ── Remove bad US CPI rows (stored as raw index ~326 instead of YoY %) ────────
-- The fetch-macro Edge Function was fixed to compute YoY correctly.
-- Delete the stale bad rows so they are replaced on the next cron run.
DELETE FROM macro_indicators
WHERE name = 'US CPI (YoY)'
  AND value > 50;  -- YoY CPI is typically 0–15%; values >50 are raw index levels

-- Verify stubs are gone (will log 0):
-- SELECT COUNT(*) FROM company_events WHERE title ILIKE '%stub%';
-- SELECT COUNT(*) FROM news_items     WHERE title ILIKE '%stub%';
-- SELECT COUNT(*) FROM macro_indicators WHERE name = 'US CPI (YoY)' AND value > 50;
