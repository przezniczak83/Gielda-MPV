// supabase/functions/fetch-prices/index.ts
// Hybrid price fetcher with multi-source fallback chain.
//
// GPW chain:  Railway/Stooq → EODHD → Twelve Data → Yahoo Finance
// USA chain:  FMP → Twelve Data → Alpha Vantage → Yahoo Finance
//
// Railway is the PRIMARY GPW source — it bypasses Edge Function IP blocks
// that affect direct Stooq fetches from EF servers.
//
// Each source is tried in order; first one returning rows wins.
// source field stored in price_history for diagnostics.
//
// Deploy: supabase functions deploy fetch-prices --project-ref pftgmorsthoezhmojjpg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Raw OHLCV record returned by individual fetchers (no ticker/source yet). */
interface OHLCV {
  date:   string;        // YYYY-MM-DD
  open:   number | null;
  high:   number | null;
  low:    number | null;
  close:  number | null;
  volume: number | null;
}

/** Full row ready for upsert into price_history. */
interface PriceRow extends OHLCV {
  ticker: string;
  source: string;
}

type FetcherFn = (ticker: string) => Promise<OHLCV[]>;

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_TICKERS_PER_RUN  = 5;
const SLEEP_BETWEEN_TICKERS = 300;   // ms
const SLEEP_BETWEEN_SOURCES = 500;   // ms — between failed source attempts

// ─── Shared helpers ───────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function tsToDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? null : n;
}

function parseInt_(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? Math.round(v) : Number.parseInt(String(v), 10);
  return isNaN(n) ? null : n;
}

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── Railway/Stooq (GPW PRIMARY — bypasses EF IP blocks) ─────────────────────

async function fetchRailwayGPW(ticker: string): Promise<OHLCV[]> {
  const baseUrl = Deno.env.get("RAILWAY_SCRAPER_URL") ?? "";
  const apiKey  = Deno.env.get("RAILWAY_SCRAPER_KEY") ?? "";
  if (!baseUrl) throw new Error("RAILWAY_SCRAPER_URL not set");

  const url = `${baseUrl}/prices/gpw/history?ticker=${encodeURIComponent(ticker)}&days=30`;
  const res  = await fetch(url, {
    headers: { "X-API-Key": apiKey },
    signal:  AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Railway returned ${res.status}`);

  const json = await res.json() as {
    ok:   boolean;
    data: Array<{ date: string; close: number | null; volume: number | null }>;
    error?: string;
  };

  if (!json.ok) throw new Error(json.error ?? "Railway error");
  if (!json.data?.length) return [];

  return json.data.map(r => ({
    date:   r.date,
    open:   null,
    high:   null,
    low:    null,
    close:  r.close,
    volume: r.volume,
  }));
}

// ─── Twelve Data (GPW: {ticker}.WAR, USA: {ticker}) ──────────────────────────

async function fetchTwelveDataGPW(ticker: string): Promise<OHLCV[]> {
  const key = Deno.env.get("TWELVE_DATA_KEY") ?? "";
  if (!key) throw new Error("TWELVE_DATA_KEY not set");

  const url = `https://api.twelvedata.com/time_series?symbol=${ticker}.WAW&interval=1day&outputsize=30&apikey=${key}`;
  return fetchTwelveData(url);
}

async function fetchTwelveDataUSA(ticker: string): Promise<OHLCV[]> {
  const key = Deno.env.get("TWELVE_DATA_KEY") ?? "";
  if (!key) throw new Error("TWELVE_DATA_KEY not set");

  const url = `https://api.twelvedata.com/time_series?symbol=${ticker}&interval=1day&outputsize=30&apikey=${key}`;
  return fetchTwelveData(url);
}

async function fetchTwelveData(url: string): Promise<OHLCV[]> {
  const res  = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json() as {
    values?: Array<{ datetime: string; open: string; high: string; low: string; close: string; volume: string }>;
    code?:   number;
    message?: string;
    status?:  string;
  };

  // Twelve Data returns {code: 400, message: "..."} for unknown symbols
  if (data.code || data.status === "error") {
    throw new Error(data.message ?? "Twelve Data error");
  }
  if (!data.values?.length) return [];

  return data.values.map(v => ({
    date:   v.datetime.slice(0, 10),
    open:   parseNum(v.open),
    high:   parseNum(v.high),
    low:    parseNum(v.low),
    close:  parseNum(v.close),
    volume: parseInt_(v.volume),
  }));
}

// ─── EODHD (GPW: {ticker}.WAR) ───────────────────────────────────────────────

async function fetchEODHD(ticker: string): Promise<OHLCV[]> {
  const key = Deno.env.get("EODHD_KEY") ?? "";
  if (!key) throw new Error("EODHD_KEY not set");

  const url = `https://eodhd.com/api/eod/${ticker}.WAR?api_token=${key}&fmt=json&limit=30`;
  const res  = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json() as Array<{
    date: string; open: number; high: number; low: number; close: number; volume: number;
  }>;

  if (!Array.isArray(data) || data.length === 0) return [];

  return data.map(v => ({
    date:   v.date.slice(0, 10),
    open:   parseNum(v.open),
    high:   parseNum(v.high),
    low:    parseNum(v.low),
    close:  parseNum(v.close),
    volume: parseInt_(v.volume),
  }));
}

// ─── Stooq (GPW: {ticker}.pl) — may block EF IPs ────────────────────────────

async function fetchStooq(ticker: string): Promise<OHLCV[]> {
  const url  = `https://stooq.pl/q/d/l/?s=${ticker.toLowerCase()}.pl&i=d`;
  const res  = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const text    = (await res.text()).trim();
  const lower   = text.toLowerCase();
  if (!text || lower.startsWith("no data") || lower.startsWith("brak danych")) {
    return [];
  }

  // CSV: Date,Open,High,Low,Close,Volume
  const lines  = text.split("\n").slice(1);
  const rows: OHLCV[] = [];

  for (const line of lines) {
    const [date, open, high, low, close, volume] = line.trim().split(",");
    if (!date || date === "null") continue;
    const c = parseNum(close);
    if (c === null) continue;
    rows.push({ date, open: parseNum(open), high: parseNum(high), low: parseNum(low), close: c, volume: parseInt_(volume) });
  }
  return rows;
}

// ─── FMP (USA) ────────────────────────────────────────────────────────────────

async function fetchFMP(ticker: string): Promise<OHLCV[]> {
  const key = Deno.env.get("FMP_KEY") ?? "";
  if (!key) throw new Error("FMP_KEY not set");

  const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${ticker}?timeseries=30&apikey=${key}`;
  const res  = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json() as {
    historical?: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>;
    "Error Message"?: string;
  };

  if (data["Error Message"]) throw new Error(data["Error Message"]);
  if (!data.historical?.length) return [];

  return data.historical.map(v => ({
    date:   v.date.slice(0, 10),
    open:   parseNum(v.open),
    high:   parseNum(v.high),
    low:    parseNum(v.low),
    close:  parseNum(v.close),
    volume: parseInt_(v.volume),
  }));
}

// ─── Alpha Vantage (USA) ──────────────────────────────────────────────────────

async function fetchAlphaVantage(ticker: string): Promise<OHLCV[]> {
  const key = Deno.env.get("ALPHA_VANTAGE_KEY") ?? "";
  if (!key) throw new Error("ALPHA_VANTAGE_KEY not set");

  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${ticker}&outputsize=compact&apikey=${key}`;
  const res  = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json() as {
    "Time Series (Daily)"?: Record<string, { "1. open": string; "2. high": string; "3. low": string; "4. close": string; "5. volume": string }>;
    "Note"?: string;
    "Information"?: string;
  };

  // Rate limit messages
  if (data["Note"] || data["Information"]) {
    throw new Error(data["Note"] ?? data["Information"]);
  }

  const series = data["Time Series (Daily)"];
  if (!series) return [];

  return Object.entries(series)
    .slice(0, 30)
    .map(([date, v]) => ({
      date,
      open:   parseNum(v["1. open"]),
      high:   parseNum(v["2. high"]),
      low:    parseNum(v["3. low"]),
      close:  parseNum(v["4. close"]),
      volume: parseInt_(v["5. volume"]),
    }));
}

// ─── Yahoo Finance (GPW: .WA, USA: as-is) ────────────────────────────────────

async function fetchYahooGPW(ticker: string): Promise<OHLCV[]> {
  return fetchYahoo(`${ticker}.WA`);
}

async function fetchYahooUSA(ticker: string): Promise<OHLCV[]> {
  return fetchYahoo(ticker);
}

async function fetchYahoo(symbol: string): Promise<OHLCV[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=30d`;
  const res  = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json() as {
    chart: {
      result: Array<{
        timestamp: number[];
        indicators: {
          quote: Array<{
            open: (number | null)[]; high: (number | null)[];
            low:  (number | null)[]; close: (number | null)[];
            volume: (number | null)[];
          }>;
        };
      }> | null;
      error: { description: string } | null;
    };
  };

  if (data.chart.error) throw new Error(data.chart.error.description);
  const result = data.chart.result?.[0];
  if (!result?.timestamp?.length) return [];

  const q    = result.indicators.quote[0];
  const rows: OHLCV[] = [];

  for (let i = 0; i < result.timestamp.length; i++) {
    const c = q.close[i];
    if (c === null || c === undefined) continue;
    rows.push({
      date:   tsToDate(result.timestamp[i]),
      open:   q.open[i]   ?? null,
      high:   q.high[i]   ?? null,
      low:    q.low[i]    ?? null,
      close:  c,
      volume: q.volume[i] ?? null,
    });
  }
  return rows;
}

// ─── Fallback chain orchestrator ──────────────────────────────────────────────

const GPW_CHAIN: [string, FetcherFn][] = [
  ["stooq",       fetchRailwayGPW],    // Railway proxy — bypasses EF IP blocks
  ["eodhd",       fetchEODHD],
  ["twelve_data", fetchTwelveDataGPW],
  ["yahoo",       fetchYahooGPW],
];

const USA_CHAIN: [string, FetcherFn][] = [
  ["fmp",           fetchFMP],
  ["twelve_data",   fetchTwelveDataUSA],
  ["alpha_vantage", fetchAlphaVantage],
  ["yahoo",         fetchYahooUSA],
];

async function fetchWithFallback(
  ticker: string,
  market: string,
): Promise<{ rows: OHLCV[]; sourceUsed: string }> {
  const chain = market === "GPW" ? GPW_CHAIN : USA_CHAIN;

  for (let i = 0; i < chain.length; i++) {
    const [sourceName, fetcher] = chain[i];

    try {
      const rows = await fetcher(ticker);
      if (rows.length > 0) {
        console.log(`[fetch-prices] ${ticker}: success via ${sourceName} (${rows.length} rows)`);
        return { rows, sourceUsed: sourceName };
      }
      console.log(`[fetch-prices] ${ticker}: ${sourceName} returned 0 rows, trying next`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[fetch-prices] ${ticker}: ${sourceName} failed: ${msg}`);
    }

    // Brief pause between source attempts (not after last)
    if (i < chain.length - 1) await sleep(SLEEP_BETWEEN_SOURCES);
  }

  console.warn(`[fetch-prices] ${ticker}: all sources exhausted, no data`);
  return { rows: [], sourceUsed: "none" };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  console.log("[fetch-prices] Invoked at:", new Date().toISOString());

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")              ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // ── Fetch companies ────────────────────────────────────────────────────────
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
  console.log(`[fetch-prices] ${allCompanies.length} companies found`);

  if (allCompanies.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, results: [], total_rows: 0, ts: new Date().toISOString() }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── Process batch ──────────────────────────────────────────────────────────
  const batch = allCompanies.slice(0, MAX_TICKERS_PER_RUN);
  const results: Array<{ ticker: string; rows_upserted: number; source_used: string }> = [];
  let totalRows = 0;

  for (let i = 0; i < batch.length; i++) {
    const { ticker, market } = batch[i];
    if (i > 0) await sleep(SLEEP_BETWEEN_TICKERS);

    const { rows: ohlcvRows, sourceUsed } = await fetchWithFallback(ticker, market);
    if (ohlcvRows.length === 0) {
      results.push({ ticker, rows_upserted: 0, source_used: "none" });
      continue;
    }

    // Attach ticker + source to each row
    const priceRows: PriceRow[] = ohlcvRows.map(r => ({
      ...r,
      ticker,
      source: sourceUsed,
    }));

    const { error: upsertErr } = await supabase
      .from("price_history")
      .upsert(priceRows, { onConflict: "ticker,date" });

    if (upsertErr) {
      console.error(`[fetch-prices] ${ticker}: upsert error:`, upsertErr.message);
      results.push({ ticker, rows_upserted: 0, source_used: sourceUsed });
      continue;
    }

    results.push({ ticker, rows_upserted: priceRows.length, source_used: sourceUsed });
    totalRows += priceRows.length;
    console.log(`[fetch-prices] ${ticker}: upserted ${priceRows.length} rows (source=${sourceUsed}) ✓`);
  }

  console.log(`[fetch-prices] Done: total_rows=${totalRows}`);

  return new Response(
    JSON.stringify({
      ok:         true,
      results,
      total_rows: totalRows,
      ts:         new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
