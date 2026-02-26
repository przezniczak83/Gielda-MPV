-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0036_peer_groups_data.sql
-- Populates peer groups for all ~200 companies (GPW + USA)
-- Uses ON CONFLICT DO NOTHING + WHERE EXISTS for idempotency
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Add missing members to existing groups (created in 0019) ─────────────────

-- Banki GPW — add remaining bank tickers
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('PEO', false), ('MIL', false), ('BHW', false),
       ('SAN', false), ('GKI', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'Banki GPW'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- Gaming GPW — add remaining gaming tickers
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES ('PLW', false), ('CIG', false), ('HRP', false), ('GKP', false)) AS t(ticker, is_primary)
WHERE g.name = 'Gaming GPW'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- Retail GPW — add remaining retailers
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES ('DNP', false), ('MON', false), ('WTN', false)) AS t(ticker, is_primary)
WHERE g.name = 'Retail GPW'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- Big Tech USA — add more
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES ('IBM', false), ('UBER', false)) AS t(ticker, is_primary)
WHERE g.name = 'Big Tech USA'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── New peer groups ───────────────────────────────────────────────────────────

INSERT INTO peer_groups (name, sector, description) VALUES
  ('Nieruchomości GPW', 'Real Estate',       'Deweloperzy i spółki nieruchomościowe GPW'),
  ('Budownictwo GPW',   'Construction',      'Firmy budowlane notowane na GPW'),
  ('Produkcja GPW',     'Manufacturing',     'Producenci przemysłowi z GPW'),
  ('Górnictwo GPW',     'Mining',            'Kopalnie i spółki wydobywcze GPW'),
  ('Healthcare GPW',    'Healthcare',        'Firmy medyczne, biotech i farmaceutyczne z GPW'),
  ('Media GPW',         'Media',             'Media i telekomunikacja GPW'),
  ('E-commerce',        'E-commerce',        'Platformy handlu elektronicznego GPW + USA'),
  ('Telecom GPW',       'Telecom',           'Operatorzy telekomunikacyjni GPW'),
  ('IT Services GPW',   'IT Services',       'Firmy IT i software z GPW'),
  ('Finanse GPW',       'Finance',           'Finanse i usługi finansowe GPW'),
  ('FMCG GPW',          'FMCG',             'Dobra szybkozbywalne i żywność GPW'),
  ('Semiconductors USA','Semiconductors',    'Producenci półprzewodników USA'),
  ('FinTech USA',       'FinTech',           'Płatności i FinTech USA'),
  ('US Banking',        'Banking',           'Banki inwestycyjne i komercyjne USA'),
  ('Streaming USA',     'Streaming',         'Platformy streamingowe USA'),
  ('Automotive USA',    'Automotive',        'Producenci samochodów i EV USA'),
  ('SaaS USA',          'SaaS',             'Oprogramowanie jako usługa USA'),
  ('Defense USA',       'Defense',           'Przemysł obronny i lotniczy USA'),
  ('Energy USA',        'Energy',            'Energetyka i ropa naftowa USA'),
  ('Healthcare USA',    'Healthcare',        'Ochrona zdrowia, biotech i pharma USA'),
  ('Consumer USA',      'Consumer',          'Konsumpcja, handel detaliczny i restauracje USA'),
  ('Cybersecurity USA', 'Cybersecurity',     'Cyberbezpieczeństwo USA'),
  ('Hurtownia GPW',     'Wholesale',         'Handel hurtowy GPW'),
  ('Turystyka GPW',     'Tourism',           'Turystyka i hotele GPW')
ON CONFLICT DO NOTHING;

-- ── Nieruchomości GPW ─────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('GTC', true), ('PHN', false), ('DOM', false), ('ATT', false),
       ('ECH', false), ('ROB', false), ('DVL', false), ('INK', false),
       ('ARC', false), ('COR', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'Nieruchomości GPW'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Budownictwo GPW ───────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('BDX', true), ('UNI', false), ('TOR', false),
       ('PXM', false), ('MID', false), ('ERB', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'Budownictwo GPW'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Produkcja GPW ─────────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('KTY', true),  ('AMC', false), ('SNK', false), ('FTE', false),
       ('WLT', false), ('APE', false), ('ZEP', false), ('ARG', false),
       ('FSG', false), ('ZAM', false), ('ZMT', false), ('FTI', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'Produkcja GPW'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Górnictwo GPW ─────────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('KGHM', true), ('JSW', false), ('LWB', false), ('FMF', false), ('KGN', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'Górnictwo GPW'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Healthcare GPW ────────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('MED', true),  ('MRC', false), ('EME', false), ('MDA', false),
       ('VOX', false), ('SLV', false), ('MAB', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'Healthcare GPW'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Media GPW ─────────────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES ('CPS', true), ('WPL', false), ('AGO', false)) AS t(ticker, is_primary)
WHERE g.name = 'Media GPW'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── E-commerce (GPW + USA) ────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('ALE', true),  ('SPL', false),
       ('AMZN', false), ('BABA', false), ('SHOP', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'E-commerce'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Telecom GPW ───────────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES ('OPL', true), ('NBR', false)) AS t(ticker, is_primary)
WHERE g.name = 'Telecom GPW'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── IT Services GPW ───────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('ACP', true),  ('CMR', false), ('SFG', false), ('VRG', false),
       ('LVC', false), ('TXT', false), ('PHD', false), ('KBJ', false),
       ('CAR', false), ('TRK', false), ('BML', false), ('QNT', false),
       ('RPC', false), ('MWT', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'IT Services GPW'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Finanse GPW ───────────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('KRU', true), ('BST', false), ('WSE', false), ('BGS', false), ('KAN', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'Finanse GPW'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── FMCG GPW ──────────────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('ZWC', true),  ('ZPC', false),
       ('PKM', false), ('HEJ', false), ('GRP', false), ('MAK', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'FMCG GPW'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Semiconductors USA ────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('NVDA', true),  ('AMD', false), ('INTC', false), ('QCOM', false),
       ('MU', false),   ('ARM', false), ('ASML', false), ('TSM', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'Semiconductors USA'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── FinTech USA ───────────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('V', true), ('MA', false), ('PYPL', false), ('COIN', false), ('SQ', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'FinTech USA'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── US Banking ────────────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('JPM', true), ('BAC', false), ('GS', false), ('MS', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'US Banking'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Streaming USA ─────────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES ('NFLX', true), ('SPOT', false)) AS t(ticker, is_primary)
WHERE g.name = 'Streaming USA'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Automotive USA ────────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('TSLA', true), ('RIVN', false), ('F', false), ('GM', false), ('ATG', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'Automotive USA'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── SaaS USA ──────────────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('CRM', true),  ('NOW', false),  ('SNOW', false), ('ZM', false),
       ('HUBS', false), ('TEAM', false), ('WDAY', false), ('DOCU', false),
       ('PLTR', false), ('ORCL', false), ('ADBE', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'SaaS USA'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Defense USA ───────────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('LMT', true), ('RTX', false), ('NOC', false), ('BA', false), ('GE', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'Defense USA'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Energy USA ────────────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES ('XOM', true), ('CVX', false), ('COP', false)) AS t(ticker, is_primary)
WHERE g.name = 'Energy USA'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Healthcare USA ────────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('JNJ', true),  ('UNH', false), ('ABT', false), ('AMGN', false),
       ('MRNA', false), ('GILD', false), ('PFE', false), ('MRK', false),
       ('BMY', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'Healthcare USA'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Consumer USA ──────────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('WMT', true),  ('HD', false),   ('COST', false), ('TGT', false),
       ('NKE', false), ('SBUX', false), ('MCD', false),  ('KO', false),
       ('PEP', false), ('DIS', false),  ('CAT', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'Consumer USA'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Cybersecurity USA ─────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('CRWD', true), ('PANW', false), ('NET', false), ('DDOG', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'Cybersecurity USA'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Hurtownia GPW ─────────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES ('TIM', true), ('EAT', false), ('ACT', false)) AS t(ticker, is_primary)
WHERE g.name = 'Hurtownia GPW'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Turystyka GPW ─────────────────────────────────────────────────────────────
INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('RBW', true), ('OBS', false), ('ARH', false), ('AMB', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'Turystyka GPW'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Social Media (standalone group) ──────────────────────────────────────────
INSERT INTO peer_groups (name, sector, description) VALUES
  ('Social Media USA', 'Social Media', 'Media społecznościowe USA')
ON CONFLICT DO NOTHING;

INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES ('META', true), ('SNAP', false)) AS t(ticker, is_primary)
WHERE g.name = 'Social Media USA'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Finance USA (standalone group) ────────────────────────────────────────────
INSERT INTO peer_groups (name, sector, description) VALUES
  ('Finance USA', 'Finance', 'Finanse i zarządzanie aktywami USA')
ON CONFLICT DO NOTHING;

INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES
       ('BRK', true), ('AXP', false), ('BLK', false), ('SCHW', false)
     ) AS t(ticker, is_primary)
WHERE g.name = 'Finance USA'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

-- ── Misc USA (Telecom, Gaming, Agri, Industrial) ──────────────────────────────
INSERT INTO peer_groups (name, sector, description) VALUES
  ('Telecom USA',    'Telecom',   'Operatorzy telekomunikacyjni USA'),
  ('Industrial USA', 'Industrial','Przemysł ciężki USA')
ON CONFLICT DO NOTHING;

INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES ('T', true), ('VZ', false)) AS t(ticker, is_primary)
WHERE g.name = 'Telecom USA'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;

INSERT INTO peer_group_members (peer_group_id, ticker, is_primary)
SELECT g.id, t.ticker, t.is_primary
FROM peer_groups g,
     (VALUES ('GE', true), ('DE', false), ('RBLX', false)) AS t(ticker, is_primary)
WHERE g.name = 'Industrial USA'
  AND EXISTS (SELECT 1 FROM companies c WHERE c.ticker = t.ticker)
ON CONFLICT (peer_group_id, ticker) DO NOTHING;
