-- 0058_clean_bad_tickers.sql
-- KROK 1E: Remove newly-blacklisted ticker aliases from ticker_aliases table.
-- KROK 1E: Strip false-positive tickers from news_items and requeue for reprocessing.
--
-- New blacklist additions (on top of 0054): TEN, SIM, OBS, KRU, SKA,
-- SAN, ENA, TGT, SAT, TAG, BIO, CIG, MDV, ODL, DAD, IPE
-- (ART, DOM, EUR, USD, PLN, MSZ, ONO, PCC already cleaned in 0054/0055)

-- ── Step 1: Remove newly-blacklisted aliases from ticker_aliases ──────────────
-- Keep alias_type='abbreviation' for these tickers (they're real tickers),
-- but remove any same-string alias that belongs to OTHER companies as
-- short_name / brand / official_name.

DELETE FROM ticker_aliases
WHERE alias IN (
  'ten','sim','obs','kru','ska',
  'san','ena','tgt','sat','tag',
  'bio','cig','mdv','odl','dad','ipe'
)
  AND alias_type IN ('short_name', 'brand', 'official_name');

-- ── Step 2: Strip false-positive tickers from news_items ─────────────────────
-- Affected tickers: those added to new blacklist + those NOT in companies table.
-- NOTE: companies table has no is_active column — treat all rows as active.

UPDATE news_items
SET
  tickers = ARRAY(
    SELECT t
    FROM UNNEST(tickers) AS t
    WHERE t NOT IN (
      'TEN','MSZ','ART','DOM','SIM','OBS','KRU','SKA',
      'SAN','ENA','TGT','EUR','USD','PLN','SAT','TAG',
      'BIO','CIG','MDV','ODL','DAD','IPE','ONO','PCC'
    )
    AND t IN (SELECT ticker FROM companies)
  ),
  ai_processed = false   -- reprocess to get correct tickers + confidence
WHERE
  tickers IS NOT NULL
  AND tickers <> '{}'
  AND tickers && ARRAY[
    'TEN','MSZ','ART','DOM','SIM','OBS','KRU','SKA',
    'SAN','ENA','TGT','EUR','USD','PLN','SAT','TAG',
    'BIO','CIG','MDV','ODL','DAD','IPE','ONO','PCC'
  ]::text[];

-- ── Step 3: Report affected rows ──────────────────────────────────────────────
DO $$
DECLARE
  cnt integer;
BEGIN
  SELECT COUNT(*) INTO cnt
  FROM news_items
  WHERE ai_processed = false
    AND published_at > NOW() - INTERVAL '30 days';
  RAISE NOTICE 'Items requeued for reprocessing (last 30d): %', cnt;
END;
$$;
