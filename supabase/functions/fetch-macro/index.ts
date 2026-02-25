// supabase/functions/fetch-macro/index.ts
// Fetches macro-economic indicators from NBP API.
//
// Data sources:
//   NBP API — exchange rates EUR/PLN, USD/PLN (confirmed working endpoints)
//   NBP API — GBP/PLN, CHF/PLN
//
// NOTE: NBP endpoints for CPI, WIBOR (/api/cenycen/, /api/stopy/) do NOT exist.
// FRED API skipped — no FRED_API_KEY configured.
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
    // rates sorted ascending by date — last is most recent
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

  const currencies = ["EUR", "USD", "GBP", "CHF"];
  const fetched: string[] = [];
  const failed:  string[] = [];

  const results = await Promise.all(
    currencies.map(async (code) => {
      const data = await fetchNBPRate(code);
      if (!data) {
        failed.push(code);
        return null;
      }

      const { current, previous } = data;
      const pairName   = `${code}/PLN`;
      const changePct  = previous.mid > 0
        ? ((current.mid - previous.mid) / previous.mid) * 100
        : null;

      return {
        name:       pairName,
        value:      current.mid,
        prev_value: previous.mid,
        change_pct: changePct !== null ? parseFloat(changePct.toFixed(4)) : null,
        source:     "NBP",
        period:     current.effectiveDate,
      };
    })
  );

  const rows = results.filter(Boolean) as Array<{
    name:       string;
    value:      number;
    prev_value: number;
    change_pct: number | null;
    source:     string;
    period:     string;
  }>;

  if (rows.length > 0) {
    const { error } = await supabase
      .from("macro_indicators")
      .insert(rows);

    if (error) {
      log.error("Insert error:", error.message);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: CORS },
      );
    }

    for (const r of rows) fetched.push(r.name);
  }

  log.info(`Done. fetched=${fetched.join(",")} failed=${failed.join(",")}`);

  return new Response(
    JSON.stringify({
      ok:      true,
      fetched,
      failed,
      ts:      new Date().toISOString(),
    }),
    { status: 200, headers: CORS },
  );
});
