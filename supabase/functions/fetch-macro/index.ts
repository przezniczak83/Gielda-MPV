// supabase/functions/fetch-macro/index.ts
// Fetches macro-economic indicators from NBP API + FRED API (when key available)
// + Stooq WIBOR rates + GUS BDL CPI.
//
// Data sources:
//   NBP API    — exchange rates EUR/PLN, USD/PLN, GBP/PLN, CHF/PLN (always)
//   Stooq CSV  — WIBOR 1M, 3M, 6M (always, no API key needed)
//   GUS BDL    — PL CPI YoY (always, free API, no key)
//   FRED API   — Fed Funds Rate, US CPI, 10Y Treasury, Unemployment (when FRED_API_KEY set)
//
// NOTE: NBP endpoints for CPI, WIBOR (/api/cenycen/, /api/stopy/) do NOT exist.
//
// To enable FRED:
//   supabase secrets set FRED_API_KEY=your_key
//   Free key at: https://fred.stlouisfed.org/docs/api/api_key.html
//
// Deploy: supabase functions deploy fetch-macro --project-ref pftgmorsthoezhmojjpg

import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { createLogger }      from "../_shared/logger.ts";

const log = createLogger("fetch-macro");

// ─── NBP Exchange Rate fetcher ────────────────────────────────────────────────

interface NBPRate {
  no:            string;
  effectiveDate: string;
  mid:           number;
}

interface NBPResponse {
  table:    string;
  currency: string;
  code:     string;
  rates:    NBPRate[];
}

async function fetchNBPRate(currencyCode: string): Promise<{ current: NBPRate; previous: NBPRate } | null> {
  const url = `https://api.nbp.pl/api/exchangerates/rates/A/${currencyCode}/last/2/?format=json`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) {
      log.warn(`NBP ${currencyCode} HTTP ${res.status}`);
      return null;
    }
    const data = await res.json() as NBPResponse;
    if (!data.rates || data.rates.length < 2) {
      log.warn(`NBP ${currencyCode} insufficient data`);
      return null;
    }
    const rates = data.rates.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    return {
      current:  rates[rates.length - 1],
      previous: rates[rates.length - 2],
    };
  } catch (err) {
    log.warn(`NBP ${currencyCode} fetch error:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ─── Stooq CSV fetcher (WIBOR rates) ─────────────────────────────────────────

async function fetchStooqCSV(
  symbol: string,
): Promise<{ current: number; previous: number; date: string } | null> {
  // Returns last 5 trading days; symbol e.g. "^wibor1m"
  const url = `https://stooq.pl/q/d/l/?s=${encodeURIComponent(symbol)}&i=d&l=5`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) {
      log.warn(`Stooq ${symbol} HTTP ${res.status}`);
      return null;
    }
    const text = await res.text();
    const lines = text.trim().split("\n").slice(1).filter(l => l.trim()); // skip header
    if (lines.length < 2) {
      log.warn(`Stooq ${symbol} insufficient rows`);
      return null;
    }
    // CSV: Date,Open,High,Low,Close,Volume — use Close (index 4)
    const parseClose = (line: string) => {
      const cols = line.split(",");
      return cols.length >= 5 ? parseFloat(cols[4]) : NaN;
    };
    const current  = parseClose(lines[lines.length - 1]);
    const previous = parseClose(lines[lines.length - 2]);
    const date     = lines[lines.length - 1].split(",")[0];
    if (isNaN(current) || isNaN(previous)) {
      log.warn(`Stooq ${symbol} parse failed`);
      return null;
    }
    return { current, previous, date };
  } catch (err) {
    log.warn(`Stooq ${symbol} error:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ─── GUS BDL CPI fetcher ──────────────────────────────────────────────────────

interface BDLResult {
  id:     string;
  values: Array<{ year: number; period: number; val: number }>;
}

interface BDLResponse {
  results: BDLResult[];
}

async function fetchGUSCPI(): Promise<{ current: number; previous: number; period: string } | null> {
  // Variable 645 = CPI (indices of consumer goods and services prices, same month previous year = 100)
  // Returns value like 102.4 meaning +2.4% YoY
  const year = new Date().getFullYear();
  const url  = `https://bdl.stat.gov.pl/api/v1/data/by-variable/645?unit-level=0&year=${year}&year=${year - 1}&format=json&page-size=20`;
  try {
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "GieldaMPV/1.0" },
    });
    if (!res.ok) {
      log.warn(`GUS BDL CPI HTTP ${res.status}`);
      return null;
    }
    const data = await res.json() as BDLResponse;
    const results = data?.results ?? [];
    if (!results.length || !results[0].values?.length) {
      log.warn("GUS BDL CPI: no data");
      return null;
    }
    // Combine all values sorted by year+period descending
    const allVals = results.flatMap(r => r.values ?? [])
      .sort((a, b) => b.year !== a.year ? b.year - a.year : b.period - a.period);
    if (allVals.length < 2) {
      log.warn("GUS BDL CPI: insufficient records");
      return null;
    }
    // Convert index (e.g. 102.4) to YoY % change (e.g. 2.4)
    const toYoY = (v: number) => parseFloat((v - 100).toFixed(2));
    const curr = allVals[0];
    const prev = allVals[1];
    return {
      current:  toYoY(curr.val),
      previous: toYoY(prev.val),
      period:   `${curr.year}-${String(curr.period).padStart(2, "0")}`,
    };
  } catch (err) {
    log.warn("GUS BDL CPI error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ─── FRED API fetcher ─────────────────────────────────────────────────────────

interface FREDObservation {
  date:  string;
  value: string;   // may be "." when data unavailable
}

interface FREDResponse {
  observations: FREDObservation[];
}

async function fetchFREDSeries(
  apiKey: string,
  seriesId: string,
): Promise<{ current: number; previous: number; date: string } | null> {
  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}` +
    `&api_key=${apiKey}` +
    `&file_type=json` +
    `&limit=2` +
    `&sort_order=desc`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      log.warn(`FRED ${seriesId} HTTP ${res.status}`);
      return null;
    }
    const data = await res.json() as FREDResponse;
    const obs  = (data.observations ?? []).filter(o => o.value !== ".");
    if (obs.length < 2) {
      log.warn(`FRED ${seriesId} insufficient valid data`);
      return null;
    }
    return {
      current:  parseFloat(obs[0].value),
      previous: parseFloat(obs[1].value),
      date:     obs[0].date,
    };
  } catch (err) {
    log.warn(`FRED ${seriesId} error:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

const CORS = {
  "Content-Type":                "application/json",
  "Access-Control-Allow-Origin": "*",
};

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status:  204,
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  log.info("fetch-macro invoked at:", new Date().toISOString());

  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: CORS },
    );
  }

  const fetched: string[] = [];
  const failed:  string[] = [];
  const rows: Array<{
    name: string; value: number; prev_value: number | null;
    change_pct: number | null; source: string; period: string | null;
  }> = [];

  // ── NBP exchange rates (always) ────────────────────────────────────────────
  const currencies = ["EUR", "USD", "GBP", "CHF"];
  const nbpResults = await Promise.all(currencies.map(code => fetchNBPRate(code)));

  for (let i = 0; i < currencies.length; i++) {
    const code = currencies[i];
    const data = nbpResults[i];
    if (!data) { failed.push(`${code}/PLN`); continue; }
    const { current, previous } = data;
    const changePct = previous.mid > 0
      ? parseFloat(((current.mid - previous.mid) / previous.mid * 100).toFixed(4))
      : null;
    rows.push({
      name:       `${code}/PLN`,
      value:      current.mid,
      prev_value: previous.mid,
      change_pct: changePct,
      source:     "NBP",
      period:     current.effectiveDate,
    });
    fetched.push(`${code}/PLN`);
  }

  // ── WIBOR rates from Stooq (always) ───────────────────────────────────────
  const WIBOR_SYMBOLS: Array<{ symbol: string; name: string }> = [
    { symbol: "^wibor1m", name: "WIBOR 1M" },
    { symbol: "^wibor3m", name: "WIBOR 3M" },
    { symbol: "^wibor6m", name: "WIBOR 6M" },
  ];

  const wiborResults = await Promise.all(WIBOR_SYMBOLS.map(w => fetchStooqCSV(w.symbol)));
  for (let i = 0; i < WIBOR_SYMBOLS.length; i++) {
    const { name } = WIBOR_SYMBOLS[i];
    const data     = wiborResults[i];
    if (!data) { failed.push(name); continue; }
    const changePct = data.previous > 0
      ? parseFloat(((data.current - data.previous) / data.previous * 100).toFixed(4))
      : null;
    rows.push({
      name,
      value:      data.current,
      prev_value: data.previous,
      change_pct: changePct,
      source:     "Stooq",
      period:     data.date,
    });
    fetched.push(name);
  }

  // ── GUS BDL — PL CPI ──────────────────────────────────────────────────────
  const cpiData = await fetchGUSCPI();
  if (!cpiData) {
    failed.push("PL CPI");
  } else {
    const changePct = cpiData.previous !== 0
      ? parseFloat(((cpiData.current - cpiData.previous) / Math.abs(cpiData.previous) * 100).toFixed(4))
      : null;
    rows.push({
      name:       "PL CPI (YoY)",
      value:      cpiData.current,
      prev_value: cpiData.previous,
      change_pct: changePct,
      source:     "GUS BDL",
      period:     cpiData.period,
    });
    fetched.push("PL CPI");
  }

  // ── FRED data (when key available) ────────────────────────────────────────
  const fredKey = Deno.env.get("FRED_API_KEY");
  if (!fredKey) {
    log.info("FRED_API_KEY not set — skipping USA macro (see lessons-learned.md for setup)");
  } else {
    const FRED_SERIES: Array<{ id: string; name: string; unit: string }> = [
      { id: "FEDFUNDS", name: "Fed Funds Rate",    unit: "%" },
      { id: "CPIAUCSL", name: "US CPI (YoY)",      unit: "%" },
      { id: "DGS10",    name: "US 10Y Treasury",   unit: "%" },
      { id: "UNRATE",   name: "US Unemployment",   unit: "%" },
    ];

    const fredResults = await Promise.all(
      FRED_SERIES.map(s => fetchFREDSeries(fredKey, s.id))
    );

    for (let i = 0; i < FRED_SERIES.length; i++) {
      const series = FRED_SERIES[i];
      const data   = fredResults[i];
      if (!data) { failed.push(series.name); continue; }
      const changePct = data.previous > 0
        ? parseFloat(((data.current - data.previous) / Math.abs(data.previous) * 100).toFixed(4))
        : null;
      rows.push({
        name:       series.name,
        value:      data.current,
        prev_value: data.previous,
        change_pct: changePct,
        source:     "FRED",
        period:     data.date,
      });
      fetched.push(series.name);
    }
    log.info(`FRED: fetched ${fredResults.filter(Boolean).length}/${FRED_SERIES.length} series`);
  }

  // ── Persist ────────────────────────────────────────────────────────────────
  if (rows.length > 0) {
    const { error } = await supabase.from("macro_indicators").insert(rows);
    if (error) {
      log.error("Insert error:", error.message);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: CORS },
      );
    }
  }

  log.info(`Done. fetched=${fetched.join(",")} failed=${failed.join(",")}`);

  return new Response(
    JSON.stringify({ ok: true, fetched, failed, ts: new Date().toISOString() }),
    { status: 200, headers: CORS },
  );
});
