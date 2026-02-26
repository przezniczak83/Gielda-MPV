-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0039_sector_kpis.sql
-- sector_kpi_definitions + sector_kpis tables for sector-specific KPIs
-- ─────────────────────────────────────────────────────────────────────────────

-- Definitions: what each KPI means per sector
CREATE TABLE IF NOT EXISTS sector_kpi_definitions (
  id          bigserial  PRIMARY KEY,
  sector      text       NOT NULL,
  kpi_code    text       NOT NULL,  -- e.g. "npl_ratio", "same_store_sales", "arpu"
  kpi_name    text       NOT NULL,  -- human-readable name
  unit        text       DEFAULT '%',
  description text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(sector, kpi_code)
);

-- Actual KPI values per ticker+period
CREATE TABLE IF NOT EXISTS sector_kpis (
  id           bigserial  PRIMARY KEY,
  ticker       text       NOT NULL REFERENCES companies(ticker) ON DELETE CASCADE,
  sector       text       NOT NULL,
  kpi_code     text       NOT NULL,
  kpi_name     text       NOT NULL,
  value        numeric(18, 4),
  prev_value   numeric(18, 4),
  change_pct   numeric(10, 4),
  unit         text       DEFAULT '%',
  period       text,               -- e.g. "2025-Q3"
  source       text       DEFAULT 'manual',
  extracted_at timestamptz DEFAULT now(),
  UNIQUE(ticker, kpi_code, period)
);

CREATE INDEX IF NOT EXISTS idx_sector_kpis_ticker  ON sector_kpis(ticker);
CREATE INDEX IF NOT EXISTS idx_sector_kpis_sector  ON sector_kpis(sector);
CREATE INDEX IF NOT EXISTS idx_sector_kpis_code    ON sector_kpis(kpi_code);

ALTER TABLE sector_kpi_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sector_kpis            ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sector_kpi_definitions' AND policyname = 'anon_read_sector_kpi_defs') THEN
    CREATE POLICY "anon_read_sector_kpi_defs" ON sector_kpi_definitions FOR SELECT TO anon USING (true);
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sector_kpis' AND policyname = 'anon_read_sector_kpis') THEN
    CREATE POLICY "anon_read_sector_kpis" ON sector_kpis FOR SELECT TO anon USING (true);
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sector_kpis' AND policyname = 'service_role_all_sector_kpis') THEN
    CREATE POLICY "service_role_all_sector_kpis" ON sector_kpis FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END; $$;

-- ── Seed KPI definitions per sector ──────────────────────────────────────────

INSERT INTO sector_kpi_definitions (sector, kpi_code, kpi_name, unit, description) VALUES
-- Banking
  ('Banking', 'npl_ratio',       'NPL Ratio',         '%',  'Kredyty zagrożone / kredyty ogółem'),
  ('Banking', 'roe',             'ROE',                '%',  'Return on Equity'),
  ('Banking', 'nim',             'NIM',                '%',  'Net Interest Margin — marża odsetkowa netto'),
  ('Banking', 'car',             'CAR',                '%',  'Capital Adequacy Ratio — współczynnik wypłacalności'),
  ('Banking', 'cost_income',     'Cost/Income',        '%',  'Wskaźnik koszty/dochody'),
-- Retail
  ('Retail',  'like_for_like',   'LFL Growth',         '%',  'Wzrost sprzedaży w porównywalnych sklepach'),
  ('Retail',  'gross_margin',    'Gross Margin',       '%',  'Marża brutto na sprzedaży'),
  ('Retail',  'inventory_days',  'Inventory Days',     'dni','Średni czas rotacji zapasów'),
  ('Retail',  'revenue_per_sqm', 'Revenue/m²',         'PLN','Przychody na m² powierzchni'),
-- Energy
  ('Energy',  'ebitda_margin',   'EBITDA Margin',      '%',  'Marża EBITDA'),
  ('Energy',  'production_volume','Production Volume', 'kt', 'Wolumen produkcji (kton)'),
  ('Energy',  'capex_to_rev',    'CapEx/Revenue',      '%',  'Nakłady inwestycyjne / przychody'),
-- Gaming
  ('Gaming',  'mau',             'MAU',                'mln','Miesięcznie aktywni użytkownicy'),
  ('Gaming',  'arppu',           'ARPPU',              'USD','Avg Revenue Per Paying User'),
  ('Gaming',  'pipeline_titles', 'Pipeline Titles',    'szt','Liczba tytułów w produkcji'),
  ('Gaming',  'digital_sales_pct','Digital Sales %',   '%',  'Udział sprzedaży cyfrowej'),
-- Technology/SaaS
  ('Technology', 'arr',          'ARR',                'mln','Annual Recurring Revenue'),
  ('Technology', 'net_retention','Net Revenue Retention','%','NRR — retencja przychodów netto'),
  ('Technology', 'rule_of_40',   'Rule of 40',         '%',  'Growth% + FCF Margin%'),
  ('SaaS',    'arr',             'ARR',                'mln','Annual Recurring Revenue'),
  ('SaaS',    'churn_rate',      'Churn Rate',         '%',  'Miesięczny churn klientów'),
  ('SaaS',    'net_retention',   'Net Revenue Retention','%','NRR'),
-- Healthcare
  ('Healthcare', 'pipeline_phase3','Phase III Pipeline','szt','Leki w III fazie badań klinicznych'),
  ('Healthcare', 'rd_to_rev',    'R&D/Revenue',        '%',  'Wydatki B+R / przychody'),
  ('Healthcare', 'ebitda_margin','EBITDA Margin',      '%',  'Marża EBITDA'),
-- Real Estate
  ('Real Estate','nav_discount', 'NAV Discount',       '%',  'Dyskonto do wartości aktywów netto'),
  ('Real Estate','occupancy_rate','Occupancy Rate',    '%',  'Obłożenie powierzchni'),
  ('Real Estate','units_sold',   'Units Sold',         'szt','Sprzedane mieszkania/lokale'),
-- Mining
  ('Mining',  'cash_cost',       'Cash Cost/t',        'USD','Koszt gotówkowy na tonę'),
  ('Mining',  'production_volume','Production Volume', 'kt', 'Wolumen wydobycia (kton)'),
  ('Mining',  'ebitda_margin',   'EBITDA Margin',      '%',  'Marża EBITDA'),
-- Telecom
  ('Telecom', 'arpu',            'ARPU',               'PLN','Average Revenue Per User'),
  ('Telecom', 'churn_rate',      'Churn Rate',         '%',  'Kwartalna rezygnacja klientów'),
  ('Telecom', 'ebitda_margin',   'EBITDA Margin',      '%',  'Marża EBITDA')
ON CONFLICT (sector, kpi_code) DO NOTHING;

-- cron: extract sector KPIs monthly (1st of month at 09:00 UTC)
SELECT cron.schedule(
  'extract-sector-kpis-monthly',
  '0 9 1 * *',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM vault.secrets WHERE name = 'supabase_functions_url') || '/extract-sector-kpis',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM vault.secrets WHERE name = 'supabase_anon_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);
