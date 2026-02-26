-- ============================================
-- KROK 1: Usuń spółki które nie istnieją na GPW
-- lub zostały wycofane z obrotu
-- UWAGA: AMB, CAR, ATG, SPL usunięte z listy DELETE
-- bo są poprawiane UPDATE-em w KROK 2 (nie usuwane)
-- ============================================
DO $$
DECLARE
  bad_tickers text[] := ARRAY[
    'BML','COR','EME','GKP','KAN','KBJ','MWT','OAT',
    'PHD','PKM','PGN','QNT','ROB','TRK','ARG','WSE',
    'CIG','FSG','HRP','APE','SFG','VRG','RPC','GKI','MDA'
  ];
BEGIN
  DELETE FROM peer_group_members WHERE ticker = ANY(bad_tickers);
  DELETE FROM company_events       WHERE ticker = ANY(bad_tickers);
  DELETE FROM company_snapshot     WHERE ticker = ANY(bad_tickers);
  DELETE FROM company_kpis         WHERE ticker = ANY(bad_tickers);
  DELETE FROM companies            WHERE ticker = ANY(bad_tickers);
END;
$$;

-- ============================================
-- KROK 2: Popraw błędne nazwy spółek
-- ============================================

-- AMB = Ambra SA (wino, nie AmRest)
UPDATE companies SET name = 'Ambra SA', sector = 'Consumer'
  WHERE ticker = 'AMB';

-- APT = Apator SA (liczniki energii)
UPDATE companies SET name = 'Apator SA', sector = 'Manufacturing'
  WHERE ticker = 'APT';

-- CAR = Inter Cars SA (części samochodowe)
UPDATE companies SET name = 'Inter Cars SA', sector = 'Automotive'
  WHERE ticker = 'CAR';

-- EAT = AmRest Holdings SE (restauracje)
UPDATE companies SET name = 'AmRest Holdings SE', sector = 'Consumer'
  WHERE ticker = 'EAT';

-- GPW = GPW SA (giełda papierów wartościowych)
UPDATE companies SET name = 'GPW SA', sector = 'Finance'
  WHERE ticker = 'GPW';

-- SPR = Spyrosoft SA
UPDATE companies SET name = 'Spyrosoft SA', sector = 'Technology'
  WHERE ticker = 'SPR';

-- SHO = Shoper SA
UPDATE companies SET name = 'Shoper SA', sector = 'Technology'
  WHERE ticker = 'SHO';

-- VRC = Vercom SA
UPDATE companies SET name = 'Vercom SA', sector = 'Technology'
  WHERE ticker = 'VRC';

-- ATG = ATM Grupa SA (media/produkcja TV)
UPDATE companies SET name = 'ATM Grupa SA', sector = 'Media'
  WHERE ticker = 'ATG';

-- SPL = Santander Bank Polska SA
UPDATE companies SET name = 'Santander Bank Polska SA', sector = 'Banking'
  WHERE ticker = 'SPL';

-- KGN = Cognor Holding SA
UPDATE companies SET name = 'Cognor Holding SA', sector = 'Manufacturing'
  WHERE ticker = 'KGN';

-- NBR = Netia SA
UPDATE companies SET name = 'Netia SA', sector = 'Telecom'
  WHERE ticker = 'NBR';

-- MRC = Mercator Medical SA
UPDATE companies SET name = 'Mercator Medical SA', sector = 'Healthcare'
  WHERE ticker = 'MRC';

-- MOL = MOL Magyar Olaj (notowana na GPW)
UPDATE companies SET name = 'MOL Magyar Olaj', sector = 'Energy'
  WHERE ticker = 'MOL';

-- BRK: update nazwy, pomijamy rename tickera (peer_group_members FK deadlock)
UPDATE companies SET name = 'Berkshire Hathaway B'
  WHERE ticker = 'BRK' AND market = 'USA';

-- ============================================
-- KROK 3: Dodaj brakujące ważne spółki GPW
-- ============================================
INSERT INTO companies (ticker, name, sector, market, has_subsidiaries) VALUES
  ('1AT',  'Atal SA',                  'RealEstate',   'GPW', TRUE),
  ('APR',  'Auto Partner SA',          'Automotive',   'GPW', FALSE),
  ('HUG',  'Huuuge Games',             'Gaming',       'GPW', FALSE),
  ('GOP',  'Games Operators SA',       'Gaming',       'GPW', FALSE),
  ('MDG',  'Medicalgorithmics SA',     'Healthcare',   'GPW', FALSE),
  ('ENA',  'Enea SA',                  'Energy',       'GPW', TRUE),
  ('ATT',  'Grupa Azoty SA',           'Chemicals',    'GPW', TRUE),
  ('PCO',  'Pepco Group',              'Retail',       'GPW', TRUE),
  ('ZAB',  'Żabka Polska',             'Retail',       'GPW', TRUE),
  ('XTB',  'XTB SA',                   'Finance',      'GPW', FALSE),
  ('PCF',  'PCF Group SA',             'Gaming',       'GPW', FALSE),
  ('BLO',  'Bloober Team SA',          'Gaming',       'GPW', FALSE),
  ('CRI',  'Creotech Instruments',     'Technology',   'GPW', FALSE),
  ('DAT',  'DataWalk SA',              'Technology',   'GPW', FALSE),
  ('MBR',  'MoBruk SA',               'Environment',  'GPW', FALSE),
  ('TMR',  'Tatry Mountain Resorts',   'Tourism',      'GPW', TRUE),
  ('NEU',  'Neuca SA',                 'Healthcare',   'GPW', TRUE),
  ('SLV',  'Selvita SA',               'Biotech',      'GPW', FALSE),
  ('MAB',  'Mabion SA',                'Biotech',      'GPW', FALSE),
  ('RVU',  'Ryvu Therapeutics',        'Biotech',      'GPW', FALSE),
  ('BGS',  'Benefit Systems SA',       'Services',     'GPW', FALSE),
  ('DNP',  'Dino Polska SA',           'Retail',       'GPW', FALSE),
  ('PCC',  'PCC Rokita SA',            'Chemicals',    'GPW', FALSE),
  ('MBW',  'Magellan SA',              'Finance',      'GPW', FALSE),
  ('KRU',  'Kruk SA',                  'Finance',      'GPW', FALSE),
  ('SPR',  'Spyrosoft SA',             'Technology',   'GPW', FALSE),
  ('SHO',  'Shoper SA',                'Technology',   'GPW', FALSE),
  ('VRC',  'Vercom SA',                'Technology',   'GPW', FALSE)
ON CONFLICT (ticker) DO UPDATE SET
  name             = EXCLUDED.name,
  sector           = EXCLUDED.sector,
  has_subsidiaries = EXCLUDED.has_subsidiaries;

-- ============================================
-- KROK 4: Weryfikacja końcowa
-- ============================================
SELECT market, count(*) AS total
FROM companies
GROUP BY market
ORDER BY market;
