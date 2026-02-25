// supabase/functions/fetch-prices/index.ts
// Pobiera historyczne ceny akcji z Yahoo Finance i upsertuje do price_history.
//
// Stooq blokuje Edge Functions (brak sesji/cookies) — zastąpiony Yahoo Finance.
// Yahoo Finance URL:
//   GPW: https://query1.finance.yahoo.com/v8/finance/chart/{ticker}.WA?interval=1d&range=30d
//   USA: https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=30d
//
// Max 5 spółek per run, sleep 500ms między requestami.
// Deploy: supabase functions deploy fetch-prices --project-ref pftgmorsthoezhmojjpg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PriceRow {
  ticker: string;
  date:   string;   // YYYY-MM-DD
  open:   number | null;
  high:   number | null;
  low:    number | null;
  close:  number | null;
  volume: number | null;
}

interface YahooQuote {
  open:   (number | null)[];
  high:   (number | null)[];
  low:    (number | null)[];
  close:  (number | null)[];
  volume: (number | null)[];
}

interface YahooResult {
  timestamp:  number[];
  indicators: { quote: YahooQuote[] };
}

interface YahooResponse {
  chart: {
    result: YahooResult[] | null;
    error:  { code: string; description: string } | null;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_TICKERS_PER_RUN = 5;
const SLEEP_MS            = 500;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Yahoo Finance symbol: GPW tickers get .WA suffix, USA tickers are used as-is. */
function toYahooSymbol(ticker: string, market: string): string {
  return market === "GPW" ? `${ticker}.WA` : ticker;
}

/** Convert Unix timestamp (seconds) to YYYY-MM-DD string. */
function tsToDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

/**
 * Fetches and parses Yahoo Finance chart data for a ticker.
 * Returns array of PriceRow for the last 30 days.
 */
async function fetchYahooPrices(ticker: string, market: string): Promise<PriceRow[]> {
  const symbol = toYahooSymbol(ticker, market);
  const url    = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=30d`;

  console.log(`[fetch-prices] Fetching ${url}`);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept":     "application/json",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[fetch-prices] ${ticker}: network error: ${msg}`);
    return [];
  }

  if (!res.ok) {
    console.warn(`[fetch-prices] ${ticker}: HTTP ${res.status}`);
    return [];
  }

  let data: YahooResponse;
  try {
    data = await res.json() as YahooResponse;
  } catch {
    console.warn(`[fetch-prices] ${ticker}: invalid JSON response`);
    return [];
  }

  if (data.chart.error) {
    console.warn(`[fetch-prices] ${ticker}: Yahoo error: ${data.chart.error.description}`);
    return [];
  }

  const result = data.chart.result?.[0];
  if (!result || !result.timestamp?.length) {
    console.warn(`[fetch-prices] ${ticker}: no data in response`);
    return [];
  }

  const quote      = result.indicators.quote[0];
  const timestamps = result.timestamp;
  const rows: PriceRow[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const close = quote.close[i];
    if (close === null || close === undefined) continue; // skip trading halts

    rows.push({
      ticker,
      date:   tsToDate(timestamps[i]),
      open:   quote.open[i]   ?? null,
      high:   quote.high[i]   ?? null,
      low:    quote.low[i]    ?? null,
      close:  close,
      volume: quote.volume[i] ?? null,
    });
  }

  return rows;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  console.log("[fetch-prices] Invoked at:", new Date().toISOString());

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")              ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // ── Pobierz wszystkie spółki (GPW + USA) ──────────────────────────────────
  const { data: companies, error: compErr } = await supabase
    .from("companies")
    .select("ticker, market")
    .order("ticker", { ascending: true });

  if (compErr) {
    console.error("[fetch-prices] Companies fetch error:", compErr.message);
    return new Response(
      JSON.stringify({ ok: false, error: compErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const allCompanies = (companies ?? []) as { ticker: string; market: string }[];
  console.log(`[fetch-prices] Found ${allCompanies.length} companies`);

  if (allCompanies.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, updated_tickers: [], total_rows: 0, ts: new Date().toISOString() }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── Process max 5 companies ────────────────────────────────────────────────
  const batch          = allCompanies.slice(0, MAX_TICKERS_PER_RUN);
  const updatedTickers: string[] = [];
  let   totalRows      = 0;

  for (let i = 0; i < batch.length; i++) {
    const { ticker, market } = batch[i];

    if (i > 0) await sleep(SLEEP_MS);

    const rows = await fetchYahooPrices(ticker, market);
    console.log(`[fetch-prices] ${ticker}: got ${rows.length} row(s)`);

    if (rows.length === 0) continue;

    const { error: upsertErr } = await supabase
      .from("price_history")
      .upsert(rows, { onConflict: "ticker,date" });

    if (upsertErr) {
      console.error(`[fetch-prices] ${ticker}: upsert error:`, upsertErr.message);
      continue;
    }

    updatedTickers.push(ticker);
    totalRows += rows.length;
    console.log(`[fetch-prices] ${ticker} (${toYahooSymbol(ticker, market)}): upserted ${rows.length} rows ✓`);
  }

  console.log(`[fetch-prices] Done: tickers=${updatedTickers.length} rows=${totalRows}`);

  return new Response(
    JSON.stringify({
      ok:              true,
      updated_tickers: updatedTickers,
      total_rows:      totalRows,
      ts:              new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
