-- What-If Scenario Engine
-- Stores predefined GPW macro scenarios with ticker impact estimates

CREATE TABLE IF NOT EXISTS whatif_scenarios (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL,
  description text,
  category    text,  -- 'macro', 'sector', 'geopolitical'
  impacts     jsonb, -- {ticker: {pct_change: -5.2, rationale: "..."}}
  created_at  timestamptz DEFAULT now()
);

-- 6 GPW predefined scenarios
INSERT INTO whatif_scenarios (name, description, category, impacts) VALUES

(
  'Podwyżka stóp NBP o 50bp',
  'Nieoczekiwana podwyżka stóp procentowych przez RPP o 50 punktów bazowych. Negatywnie dla banków z dużym portfelem hipotecznym, pozytywnie dla sektora finansowego krótkookresowo.',
  'macro',
  '{
    "PKO":  {"pct_change": -3.5, "rationale": "Wyższe odpisy na kredyty hipoteczne"},
    "SPL":  {"pct_change": -2.8, "rationale": "Presja na marżę odsetkową"},
    "PEO":  {"pct_change": -2.5, "rationale": "Koszty refinansowania wzrosną"},
    "XTB":  {"pct_change": 2.0,  "rationale": "Wyższe stopy = większa aktywność handlowa"},
    "DNP":  {"pct_change": -1.5, "rationale": "Konsumenci ograniczą wydatki"},
    "LPP":  {"pct_change": -1.8, "rationale": "Spada siła nabywcza konsumentów"}
  }'::jsonb
),

(
  'Eskalacja konfliktu na Ukrainie',
  'Znaczące pogorszenie sytuacji geopolitycznej na wschodzie Europy. Wzrost cen surowców energetycznych, odpływ kapitału z regionu CEE.',
  'geopolitical',
  '{
    "PKN":  {"pct_change": 4.5,  "rationale": "Wyższe ceny ropy = wyższe marże rafineryjne"},
    "KGH":  {"pct_change": 3.2,  "rationale": "Miedź i złoto rosną jako safe haven"},
    "PKO":  {"pct_change": -5.0, "rationale": "Ryzyko geopolityczne = wypływ kapitału z banków"},
    "PZU":  {"pct_change": -3.5, "rationale": "Wyższe ryzyko i rezerwy ubezpieczeniowe"},
    "CDR":  {"pct_change": -2.0, "rationale": "Mniejsze budżety na gry w kryzysie"},
    "PGE":  {"pct_change": -2.5, "rationale": "Wyższe koszty energii dla dystrybucji"}
  }'::jsonb
),

(
  'Boom AI / technologiczny',
  'Przełom technologiczny w AI zwiększa popyt na spółki technologiczne i gamingowe. Polska branża IT i gaming korzystają ze wzrostu globalnego.',
  'sector',
  '{
    "CDR":  {"pct_change": 8.0,  "rationale": "CD Projekt korzysta z boomu AI w grach"},
    "XTB":  {"pct_change": 5.0,  "rationale": "Platformy tradingowe korzystają ze wzrostu aktywności"},
    "PKO":  {"pct_change": 1.5,  "rationale": "Cyfryzacja bankowości przyspiesza"},
    "GPW":  {"pct_change": 3.0,  "rationale": "Więcej spółek tech debiutuje na GPW"},
    "DNP":  {"pct_change": -1.0, "rationale": "Tradycyjny retail traci na rzecz e-commerce"},
    "JSW":  {"pct_change": -2.0, "rationale": "Węgiel traci na znaczeniu w zielonej transformacji"}
  }'::jsonb
),

(
  'Recesja w strefie euro',
  'Niemcy i Francja wchodzą w recesję techniczną. Polska eksport spada, PKB hamuje do 0.5% wzrostu.',
  'macro',
  '{
    "PKN":  {"pct_change": -4.0, "rationale": "Niższe zapotrzebowanie na paliwa w Europie"},
    "KGH":  {"pct_change": -5.5, "rationale": "Miedź spada przy spadku produkcji przemysłowej"},
    "ATT":  {"pct_change": -6.0, "rationale": "Nawozy tracą przy mniejszej produkcji rolnej"},
    "LPP":  {"pct_change": -3.5, "rationale": "Ekspozycja na europejskie rynki odzieżowe"},
    "PZU":  {"pct_change": 1.0,  "rationale": "Ubezpieczenia defensywne w recesji"},
    "CDR":  {"pct_change": 2.0,  "rationale": "Gry wideo rosną w czasie kryzysu (tani rozrywka)"}
  }'::jsonb
),

(
  'Obniżka podatku CIT do 15%',
  'Rząd ogłasza obniżkę podatku CIT do 15% dla firm zatrudniających powyżej 50 pracowników. Pozytywne dla całego rynku.',
  'macro',
  '{
    "PKO":  {"pct_change": 3.5,  "rationale": "Wzrost zysku netto po niższym podatku"},
    "SPL":  {"pct_change": 3.2,  "rationale": "Banki największymi beneficjentami"},
    "DNP":  {"pct_change": 4.0,  "rationale": "Wysoka baza zysku, duży efekt podatku"},
    "LPP":  {"pct_change": 3.8,  "rationale": "Wzrost dyspozycyjnego zysku i dywidendy"},
    "CDR":  {"pct_change": 2.5,  "rationale": "Wyższe marże netto w sektorze gier"},
    "XTB":  {"pct_change": 3.0,  "rationale": "Wzrost zysku XTB przy wysokich marżach"}
  }'::jsonb
),

(
  'Wzrost cen miedzi o 30%',
  'Deficyt miedzi na rynkach globalnych (przyspieszenie elektryfikacji, ograniczenia podaży z Chile). Cena miedzi osiąga 12 000 USD/t.',
  'sector',
  '{
    "KGH":  {"pct_change": 18.0, "rationale": "KGHM = największy beneficjent wzrostu cen miedzi"},
    "PKN":  {"pct_change": -1.5, "rationale": "Wyższe koszty energii do produkcji"},
    "ATT":  {"pct_change": -2.0, "rationale": "Koszty surowców do nawozów rosną"},
    "PGE":  {"pct_change": 2.5,  "rationale": "Wyższe ceny miedzi = wartość sieci"},
    "ENA":  {"pct_change": 2.0,  "rationale": "Enea korzysta na elektryfikacji"},
    "CDR":  {"pct_change": 0.5,  "rationale": "Neutralny wpływ na sektor gier"}
  }'::jsonb
)

ON CONFLICT DO NOTHING;

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_whatif_scenarios_category ON whatif_scenarios(category);
