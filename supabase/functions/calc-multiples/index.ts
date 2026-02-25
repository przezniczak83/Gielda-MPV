// supabase/functions/calc-multiples/index.ts
// Calculates valuation multiples for all companies.
// Runs every weekday at 19:05 via pg_cron (after fetch-prices at 18:xx).
//
// Multiples computed:
//   P/E   = price / eps
//   P/B   = price / book_value_per_share  (skipped if no data)
//   EV/EBITDA = enterprise_value / ebitda (skipped if no data)
//   Market cap = price * shares_outstanding
//   Enterprise value = market_cap + net_debt
//
// Sources:
//   price           — price_history (latest close)
//   eps             — company_financials (latest row, eps field)
//   ebitda          — company_financials (latest row, ebitda field)
//   net_debt        — company_financials (latest row, net_debt field)
//   shares / book   — companies table (shares_outstanding, book_value_per_share)
//
// Upsert to valuation_multiples UNIQUE(ticker).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface CompanyRow {
  ticker:                   string;
  shares_outstanding:       number | null;
  book_value_per_share:     number | null;
}

interface FinancialRow {
  ticker:     string;
  eps:        number | null;
  ebitda:     number | null;
  net_debt:   number | null;
  revenue:    number | null;
}

interface PriceRow {
  ticker: string;
  close:  number;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  console.log("[calc-multiples] Invoked at:", new Date().toISOString());

  const supabaseUrl = Deno.env.get("SUPABASE_URL")              ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // ── 1. Fetch all tickers from companies ─────────────────────────────────────
  const { data: companies, error: compErr } = await db
    .from("companies")
    .select("ticker, shares_outstanding, book_value_per_share");

  if (compErr || !companies?.length) {
    console.error("[calc-multiples] companies fetch error:", compErr?.message);
    return new Response(
      JSON.stringify({ ok: false, error: compErr?.message ?? "No companies" }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }

  const tickers = companies.map((c: CompanyRow) => c.ticker);
  console.log(`[calc-multiples] Processing ${tickers.length} companies`);

  // ── 2. Fetch latest price per ticker ─────────────────────────────────────────
  // Use DISTINCT ON (ticker) ordered by date DESC
  const { data: priceRows, error: priceErr } = await db.rpc("latest_prices_per_ticker");

  // Fallback: if RPC doesn't exist, fetch individually (best effort)
  let priceMap: Map<string, number>;

  if (priceErr || !priceRows) {
    console.warn("[calc-multiples] RPC latest_prices_per_ticker not available, fetching individually");
    priceMap = new Map();
    // Fetch in parallel batches of 10
    const BATCH = 10;
    for (let i = 0; i < tickers.length; i += BATCH) {
      const batch = tickers.slice(i, i + BATCH);
      await Promise.all(batch.map(async (ticker: string) => {
        const { data } = await db
          .from("price_history")
          .select("close")
          .eq("ticker", ticker)
          .order("date", { ascending: false })
          .limit(1)
          .single();
        if (data?.close != null) priceMap.set(ticker, Number(data.close));
      }));
    }
  } else {
    priceMap = new Map((priceRows as PriceRow[]).map(r => [r.ticker, Number(r.close)]));
  }

  // ── 3. Fetch latest financials per ticker ────────────────────────────────────
  const finMap = new Map<string, FinancialRow>();
  // Fetch most recent financial row per ticker
  const { data: finAllRows, error: finErr } = await db
    .from("company_financials")
    .select("ticker, eps, ebitda, net_debt, revenue")
    .in("ticker", tickers)
    .order("created_at", { ascending: false });

  if (!finErr && finAllRows) {
    // Keep first occurrence per ticker (most recent)
    for (const row of finAllRows as FinancialRow[]) {
      if (!finMap.has(row.ticker)) finMap.set(row.ticker, row);
    }
  }

  // ── 4. Compute and upsert multiples ─────────────────────────────────────────
  const compMap = new Map<string, CompanyRow>(
    (companies as CompanyRow[]).map(c => [c.ticker, c])
  );

  const upsertRows: Record<string, unknown>[] = [];
  let computed = 0;

  for (const ticker of tickers) {
    const price = priceMap.get(ticker);
    if (price == null || price <= 0) continue;

    const fin  = finMap.get(ticker);
    const comp = compMap.get(ticker);

    const eps    = fin?.eps    ?? null;
    const ebitda = fin?.ebitda ?? null;
    const netDebt = fin?.net_debt ?? null;
    const revenue = fin?.revenue ?? null;
    const shares   = comp?.shares_outstanding ?? null;
    const bvps     = comp?.book_value_per_share ?? null;

    const marketCap      = shares != null ? price * shares : null;
    const enterpriseValue = (marketCap != null && netDebt != null)
      ? marketCap + netDebt : marketCap;

    const pe_ratio  = (eps   != null && eps   > 0) ? parseFloat((price / eps).toFixed(4))           : null;
    const pb_ratio  = (bvps  != null && bvps  > 0) ? parseFloat((price / bvps).toFixed(4))          : null;
    const ev_ebitda = (ebitda != null && ebitda > 0 && enterpriseValue != null)
      ? parseFloat((enterpriseValue / ebitda).toFixed(4)) : null;
    const ev_revenue = (revenue != null && revenue > 0 && enterpriseValue != null)
      ? parseFloat((enterpriseValue / revenue).toFixed(4)) : null;
    const ps_ratio  = (revenue != null && revenue > 0 && marketCap != null)
      ? parseFloat((marketCap / revenue).toFixed(4)) : null;

    upsertRows.push({
      ticker,
      pe_ratio,
      pb_ratio,
      ps_ratio,
      ev_ebitda,
      ev_revenue,
      market_cap:       marketCap,
      enterprise_value: enterpriseValue,
      calculated_at:    new Date().toISOString(),
    });
    computed++;
  }

  if (upsertRows.length === 0) {
    console.log("[calc-multiples] No price data available");
    return new Response(
      JSON.stringify({ ok: true, computed: 0, message: "No price data" }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }

  const { error: upsertErr } = await db
    .from("valuation_multiples")
    .upsert(upsertRows, { onConflict: "ticker" });

  if (upsertErr) {
    console.error("[calc-multiples] Upsert error:", upsertErr.message);
    return new Response(
      JSON.stringify({ ok: false, error: upsertErr.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }

  console.log(`[calc-multiples] Upserted ${computed} multiples`);

  return new Response(
    JSON.stringify({ ok: true, computed, ts: new Date().toISOString() }),
    { status: 200, headers: { "Content-Type": "application/json", ...CORS } },
  );
});
