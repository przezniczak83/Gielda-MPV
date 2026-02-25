// supabase/functions/fetch-sec/index.ts
// Fetches fundamental financial data from SEC EDGAR for USA stocks.
//
// POST {} or GET — processes up to 3 USA companies per call (rate limit safe)
//
// Sources:
//   Ticker → CIK:  https://www.sec.gov/files/company_tickers.json
//   Fundamentals:  https://data.sec.gov/api/xbrl/companyfacts/{CIK}.json
//
// Extracts (last 8 quarters, 10-Q/10-K):
//   Revenue, NetIncome, EPS, LongTermDebt, OperatingCashFlow
//
// Upserts to company_financials { ticker, period, revenue, net_income, eps, net_debt, fcf }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const SEC_HEADERS = {
  "User-Agent": "GieldaMonitor/1.0 contact@gielda-monitor.pl",
  "Accept":     "application/json",
};

interface SecTickerEntry {
  cik_str: number;
  ticker:  string;
  title:   string;
}

interface SecFact {
  val:      number;
  accn:     string;
  fy:       number;
  fp:       string;
  form:     string;
  filed:    string;
  start?:   string;
  end:      string;
  frame?:   string;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Get last N unique (end-period, form) facts ordered by end date DESC */
function extractLastNPeriods(facts: SecFact[], n: number): SecFact[] {
  const seen = new Set<string>();
  const result: SecFact[] = [];
  // Sort by end date desc
  const sorted = [...facts].sort((a, b) => b.end.localeCompare(a.end));
  for (const f of sorted) {
    if (!["10-Q", "10-K"].includes(f.form)) continue;
    const key = `${f.end}|${f.form}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(f);
    }
    if (result.length >= n) break;
  }
  return result;
}

/** Safely get a concept's facts array from SEC EDGAR JSON */
function getFacts(cik_data: Record<string, unknown>, ...conceptNames: string[]): SecFact[] {
  const us_gaap = cik_data["us-gaap"] as Record<string, { units: { USD?: SecFact[]; shares?: SecFact[] } }> | undefined;
  if (!us_gaap) return [];
  for (const name of conceptNames) {
    const concept = us_gaap[name];
    if (!concept) continue;
    const units = concept.units;
    const facts = units?.USD ?? units?.shares ?? [];
    if (facts.length > 0) return facts;
  }
  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")             ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Parse optional ticker param (for targeted calls)
  let targetTicker: string | null = null;
  try {
    if (req.method === "POST") {
      const body = await req.json();
      targetTicker = body.ticker?.toUpperCase() ?? null;
    } else {
      const url = new URL(req.url);
      targetTicker = url.searchParams.get("ticker")?.toUpperCase() ?? null;
    }
  } catch { /* no body */ }

  // ── Fetch company tickers from SEC ────────────────────────────────────────

  console.log("[fetch-sec] Fetching SEC ticker map…");
  let tickerMap: Map<string, string>;
  try {
    const res  = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: SEC_HEADERS });
    const data = await res.json() as Record<string, SecTickerEntry>;
    tickerMap  = new Map(
      Object.values(data).map(e => [
        e.ticker.toUpperCase(),
        String(e.cik_str).padStart(10, "0"),
      ]),
    );
    console.log(`[fetch-sec] Loaded ${tickerMap.size} tickers from SEC`);
  } catch (err) {
    console.error("[fetch-sec] Failed to fetch SEC ticker map:", err);
    return new Response(
      JSON.stringify({ ok: false, error: "SEC ticker map unavailable" }),
      { status: 503, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }

  // ── Get USA companies from DB ─────────────────────────────────────────────

  let query = db.from("companies").select("ticker, name").eq("market", "USA");
  if (targetTicker) query = query.eq("ticker", targetTicker);
  const { data: companies } = await query.limit(targetTicker ? 1 : 3);

  if (!companies?.length) {
    return new Response(
      JSON.stringify({ ok: true, processed: 0, message: "No USA companies found" }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }

  const results: Array<{ ticker: string; status: string; periods?: number; error?: string }> = [];

  for (const company of companies) {
    const ticker = company.ticker;
    const cik    = tickerMap.get(ticker);

    if (!cik) {
      console.warn(`[fetch-sec] No CIK for ${ticker}`);
      results.push({ ticker, status: "no_cik" });
      continue;
    }

    console.log(`[fetch-sec] Fetching ${ticker} (CIK: ${cik})…`);

    try {
      const factsRes = await fetch(
        `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
        { headers: SEC_HEADERS },
      );

      if (!factsRes.ok) {
        console.warn(`[fetch-sec] ${ticker}: HTTP ${factsRes.status}`);
        results.push({ ticker, status: `http_${factsRes.status}` });
        await sleep(1000);
        continue;
      }

      const factsData = await factsRes.json() as {
        facts: Record<string, unknown>;
      };
      const facts = factsData.facts as Record<string, unknown>;

      // ── Extract last 8 periods of each metric ────────────────────────────

      const revFacts  = getFacts(facts,
        "Revenues",
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "SalesRevenueNet",
      );
      const nieFacts  = getFacts(facts, "NetIncomeLoss");
      const epsFacts  = getFacts(facts, "EarningsPerShareBasic", "EarningsPerShareDiluted");
      const debtFacts = getFacts(facts, "LongTermDebt", "LongTermDebtCurrent", "LongTermDebtNoncurrent");
      const ocfFacts  = getFacts(facts, "NetCashProvidedByUsedInOperatingActivities");

      // Use revenue periods as the anchor (defines which periods we upsert)
      const anchorPeriods = extractLastNPeriods(revFacts, 8);

      if (anchorPeriods.length === 0) {
        console.warn(`[fetch-sec] ${ticker}: no revenue data`);
        results.push({ ticker, status: "no_revenue" });
        await sleep(1000);
        continue;
      }

      // Build lookups by end-date for other metrics
      function buildLookup(facts: SecFact[]): Map<string, number> {
        const m = new Map<string, number>();
        for (const f of [...facts].sort((a, b) => b.end.localeCompare(a.end))) {
          if (!["10-Q", "10-K"].includes(f.form)) continue;
          if (!m.has(f.end)) m.set(f.end, f.val);
        }
        return m;
      }

      const niLookup   = buildLookup(nieFacts);
      const epsLookup  = buildLookup(epsFacts);
      const debtLookup = buildLookup(debtFacts);
      const ocfLookup  = buildLookup(ocfFacts);

      // ── Build upsert rows ─────────────────────────────────────────────────

      const rows = anchorPeriods.map(p => ({
        ticker,
        period:     p.end,
        revenue:    p.val       ?? null,
        net_income: niLookup.get(p.end)   ?? null,
        eps:        epsLookup.get(p.end)  ?? null,
        net_debt:   debtLookup.get(p.end) ?? null,
        fcf:        ocfLookup.get(p.end)  ?? null,
        currency:   "USD",
      }));

      const { error: upsertErr } = await db
        .from("company_financials")
        .upsert(rows, { onConflict: "ticker,period" });

      if (upsertErr) {
        console.error(`[fetch-sec] ${ticker} upsert error:`, upsertErr.message);
        results.push({ ticker, status: "upsert_error", error: upsertErr.message });
      } else {
        console.log(`[fetch-sec] ${ticker}: upserted ${rows.length} periods`);
        results.push({ ticker, status: "ok", periods: rows.length });
      }
    } catch (err) {
      console.error(`[fetch-sec] ${ticker} error:`, err);
      results.push({ ticker, status: "error", error: String(err) });
    }

    // SEC rate limit: 10 req/s max, 1s sleep is safe
    await sleep(1000);
  }

  return new Response(
    JSON.stringify({ ok: true, processed: results.length, results }),
    { headers: { ...CORS, "Content-Type": "application/json" } },
  );
});
