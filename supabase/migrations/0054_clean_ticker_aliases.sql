-- 0054_clean_ticker_aliases.sql
-- Remove ticker aliases that cause false positives:
--   - Common Polish/English words matching unrelated articles
--   - Currency/index abbreviations misidentified as company tickers
--   - 2-3 char aliases that are too ambiguous

-- ── 1. Remove specific common-word aliases ────────────────────────────────────
-- These are real companies but their short aliases appear too often in unrelated text.
-- Full-name aliases (e.g. "eurocash sa", "dom development") are kept and work fine.

DELETE FROM ticker_aliases WHERE alias IN (
  -- Currencies / indices (NOT companies despite tickers existing)
  'eur',      -- EUR=Eurocash but "EUR" in news = Euro currency 99% of the time
  'msz',      -- MSZ=Mostostal Zabrze but "MSZ" in Polish = Ministerstwo Spraw Zagranicznych
  -- Extremely common English/Polish words
  'text',     -- TXT=Text SA — "text" appears in almost every article
  'dom',      -- DOM=Dom Development — "dom" means "house/home" in Polish
  'art',      -- ART=Artifex Mundi — "art" is a common word
  'now',      -- NOW=ServiceNow — "now" appears everywhere as a time adverb
  'net',      -- NET=Cloudflare — "net" appears everywhere (internet, network, net profit)
  'gs',       -- GS=Goldman Sachs — "GS" appears in many finance contexts
  'ab',       -- ABE=AB SA — "ab" is 2 chars and matches too many things
  'med',      -- MED=Medicover — "med" appears in all medical articles
  'act',      -- ACT=Action SA — "act" is a common English word
  'pcc',      -- PCC=PCC Rokita — "PCC" is a common abbreviation for many things
  'ono',      -- ONO=OneSano — "ono" matches Polish pronouns
  'eco',      -- too generic
  'bit',      -- too generic
  'pro',      -- too generic
  'lab',      -- too generic
  'era',      -- too generic
  'one',      -- too generic
  'plus',     -- CPS brand alias — but "plus" appears everywhere
  'fast',     -- too generic
  'data',     -- too generic
  'tech',     -- too generic
  'soft',     -- too generic
  'work',     -- too generic
  'fund',     -- too generic
  'star',     -- too generic
  'idea',     -- too generic
  'nova',     -- too generic
  'agro',     -- too generic
  'auto',     -- too generic (APR=Auto Partner has "auto" alias)
  'best',     -- BST=BEST SA — "best" is a common adjective
  'group',    -- too generic
  'capital',  -- too generic
  'energy',   -- too generic
  'power',    -- too generic
  'global',   -- too generic
  'trade',    -- too generic
  'first',    -- too generic
  'real',     -- too generic
  'open',     -- too generic
  'core',     -- too generic
  'home',     -- too generic
  'life',     -- too generic
  'care',     -- too generic
  'time',     -- too generic
  'link',     -- too generic
  'line',     -- too generic
  'next',     -- too generic
  'euro',     -- too generic (= currency)
  'inwest',   -- too generic
  'holding',  -- too generic
  'finance',  -- too generic
  'nbp',      -- central bank abbreviation
  'usd',      -- currency
  'pln',      -- currency
  'gbp',      -- currency
  'chf',      -- currency
  'jpy',      -- currency
  'wig',      -- index
  'wig20',    -- index
  'mwig40',   -- index
  'swig80',   -- index
  'spolka',   -- generic
  'akcyjna',  -- generic
  'limited',  -- generic
  'polska',   -- generic (too many companies have this in name)
  'polskie',  -- generic
  'national', -- generic
  'investments' -- generic
);

-- ── 2. Remove all 2-char aliases that are not official tickers ────────────────
-- 2-char aliases are nearly always wrong (match initials, short words, etc.)
DELETE FROM ticker_aliases
WHERE LENGTH(alias) <= 2
  AND alias_type IN ('short_name', 'abbreviation', 'brand');

-- ── 3. Remove 3-char short_name/brand aliases for tickers that have longer name aliases ──
-- Keep only if the alias IS exactly the ticker (abbreviation) — those are fine
-- because the heuristic already filters to length >= 4.
-- But remove 3-char short_name/brand aliases that aren't the ticker itself.
DELETE FROM ticker_aliases
WHERE LENGTH(alias) = 3
  AND alias_type IN ('short_name', 'brand')
  AND alias <> LOWER(ticker);

-- ── 4. Stats ──────────────────────────────────────────────────────────────────
SELECT alias_type, COUNT(*) as count
FROM ticker_aliases
GROUP BY alias_type
ORDER BY count DESC;

SELECT ticker, alias
FROM ticker_aliases
WHERE LENGTH(alias) <= 3
ORDER BY alias;
