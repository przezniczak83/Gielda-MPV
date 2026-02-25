// supabase/functions/fetch-macro/index.ts
// Fetches macro-economic indicators from NBP API + FRED API (when key available).
//
// Data sources:
//   NBP API — exchange rates EUR/PLN, USD/PLN, GBP/PLN, CHF/PLN (always)
//   FRED API — Fed Funds Rate, US CPI, 10Y Treasury, Unemployment (when FRED_API_KEY set)
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
