-- Migration 0060: companies profile fields + news_items attachments/body_text
-- Part of CZĘŚĆ 2 (company page redesign) + KROK 4 (ESPI PDF attachments)

-- ── Companies profile fields ─────────────────────────────────────────────────

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS ceo         text,
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS ir_url      text,
  ADD COLUMN IF NOT EXISTS indices     text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS city        text,
  ADD COLUMN IF NOT EXISTS description text;

-- ── news_items: ESPI body text + PDF attachments ─────────────────────────────

ALTER TABLE news_items
  ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS body_text   text;

-- ── Seed: basic data for top WIG20 companies ─────────────────────────────────

UPDATE companies SET
  ceo         = 'Cezary Kocik',
  website_url = 'https://www.mbank.pl',
  ir_url      = 'https://www.mbank.pl/relacje-inwestorskie',
  indices     = ARRAY['WIG20', 'WIG-Banki'],
  city        = 'Warszawa',
  description = 'mBank S.A. jest jednym z największych banków w Polsce, oferującym nowoczesne usługi finansowe dla klientów indywidualnych i korporacyjnych.'
WHERE ticker = 'MBK';

UPDATE companies SET
  ceo         = 'Ireneusz Fąfara',
  website_url = 'https://www.orlen.pl',
  ir_url      = 'https://www.orlen.pl/pl/dla-inwestorow',
  indices     = ARRAY['WIG20'],
  city        = 'Płock',
  description = 'PKN ORLEN S.A. jest największą firmą w Polsce i Europie Środkowo-Wschodniej, działającą w branży energetyczno-paliwowej.'
WHERE ticker = 'PKN';

UPDATE companies SET
  ceo         = 'Szymon Midera',
  website_url = 'https://www.pkobp.pl',
  ir_url      = 'https://www.pkobp.pl/relacje-inwestorskie',
  indices     = ARRAY['WIG20', 'WIG-Banki'],
  city        = 'Warszawa',
  description = 'PKO Bank Polski S.A. – największy bank w Polsce pod względem aktywów, obsługujący ponad 11 mln klientów.'
WHERE ticker = 'PKO';

UPDATE companies SET
  website_url = 'https://www.pzu.pl',
  ir_url      = 'https://www.pzu.pl/relacje-inwestorskie',
  indices     = ARRAY['WIG20'],
  city        = 'Warszawa',
  description = 'PZU S.A. – największa firma ubezpieczeniowa w Polsce i Europie Środkowej.'
WHERE ticker = 'PZU';

UPDATE companies SET
  website_url = 'https://www.kghm.com',
  ir_url      = 'https://www.kghm.com/pl/inwestorzy',
  indices     = ARRAY['WIG20'],
  city        = 'Lubin',
  description = 'KGHM Polska Miedź S.A. – jeden z wiodących producentów miedzi i srebra na świecie.'
WHERE ticker = 'KGH';

UPDATE companies SET
  ceo         = 'Marek Piechocki',
  website_url = 'https://www.lpp.com.pl',
  ir_url      = 'https://www.lpp.com.pl/dla-inwestorow',
  indices     = ARRAY['WIG20'],
  city        = 'Gdańsk',
  description = 'LPP SA – polska firma odzieżowa, właściciel marek Reserved, Cropp, House, Mohito i Sinsay.'
WHERE ticker = 'LPP';

UPDATE companies SET
  ceo         = 'Adam Małyszko',
  website_url = 'https://www.allegro.eu',
  ir_url      = 'https://www.allegro.eu/dla-inwestorow',
  indices     = ARRAY['WIG20'],
  city        = 'Poznań',
  description = 'Allegro.eu S.A. – wiodąca platforma e-commerce w Polsce i Europie Środkowej.'
WHERE ticker = 'ALE';

UPDATE companies SET
  ceo         = 'Adam Kiciński',
  website_url = 'https://www.cdprojekt.com',
  ir_url      = 'https://www.cdprojekt.com/pl/relacje-inwestorskie',
  indices     = ARRAY['WIG20'],
  city        = 'Warszawa',
  description = 'CD Projekt S.A. – twórca gier video, producent serii Wiedźmin i Cyberpunk 2077.'
WHERE ticker = 'CDR';

UPDATE companies SET
  website_url = 'https://www.dino.com.pl',
  ir_url      = 'https://www.dino.com.pl/relacje-inwestorskie',
  indices     = ARRAY['WIG20'],
  city        = 'Krotoszyn',
  description = 'Dino Polska S.A. – jedna z najszybciej rosnących sieci supermarketów spożywczych w Polsce.'
WHERE ticker = 'DNP';

UPDATE companies SET
  website_url = 'https://www.jsw.pl',
  ir_url      = 'https://www.jsw.pl/relacje-inwestorskie',
  indices     = ARRAY['WIG20'],
  city        = 'Jastrzębie-Zdrój',
  description = 'Jastrzębska Spółka Węglowa S.A. – największy producent wysokogatunkowego węgla koksowego w Unii Europejskiej.'
WHERE ticker = 'JSW';

-- Mark remaining WIG20 members (no detailed data)
UPDATE companies SET indices = ARRAY['WIG20']
WHERE ticker IN ('PEO','SPL','OPL','PCO','PKP','WPL','CEZ','GTN','CPS');

-- ── Backfill ticker_confidence for old articles (BUG 2 fix) ──────────────────
-- Articles processed before migration 0057 have ticker_confidence = '{}'
-- Set default confidence of 0.7 for their tickers (they were matched by
-- the old pipeline which required explicit ticker presence)

UPDATE news_items
SET ticker_confidence = (
  SELECT jsonb_object_agg(t, 0.7)
  FROM unnest(tickers) t
)
WHERE (ticker_confidence IS NULL OR ticker_confidence = '{}'::jsonb)
  AND ai_processed = true
  AND tickers IS NOT NULL
  AND array_length(tickers, 1) > 0;
