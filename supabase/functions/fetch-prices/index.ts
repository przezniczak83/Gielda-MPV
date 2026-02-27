// supabase/functions/fetch-prices/index.ts
// Batch price fetcher for GPW tickers using direct Stooq CSV endpoint.
//
// Batch logic: time-based rotating slot — different batch each 10-min window.
//   hourSlot   = now.getHours() * 6 + Math.floor(now.getMinutes() / 10)
//   batchIndex = hourSlot % totalBatches
// With ~400 GPW tickers / 30 per batch = ~14 batches → full rotation in 140 min.
//
// Each batch: 30 tickers, Stooq CSV, 5s timeout, 800ms delay between requests.
// Checkpoints written to price_fetch_batches + pipeline_runs + system_health.
//
// Deploy: supabase functions deploy fetch-prices --project-ref pftgmorsthoezhmojjpg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Constants ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 30;
const DELAY_MS   = 800;
const TIMEOUT_MS = 5_000;
const STOOQ_UA   = "Mozilla/5.0 (compatible; GieldaMonitor/3.1)";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function parseNum(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v.trim());
  return isNaN(n) || n <= 0 ? null : n;
}

function parseInt_(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseInt(v.trim(), 10);
  return isNaN(n) ? null : n;
}

// ─── Stooq CSV fetcher ────────────────────────────────────────────────────────

/** Fetch latest quote for a GPW ticker from Stooq CSV endpoint.
 *
 *  URL: https://stooq.pl/q/l/?s={ticker}.pl&e=csv
 *  CSV format: Symbol,Date,Time,Open,High,Low,Close,Volume
 *  Returns single data row (latest available trading day).
 *
 *  NOTE: Stooq blocks Supabase Edge Function IPs — use Railway proxy as primary
 *  and fall back to direct Stooq if Railway is not configured.
 */
interface StooqPrice {
  date:   string;
  open:   number | null;
  high:   number | null;
  low:    number | null;
  close:  number;
  volume: number | null;
}

async function fetchStooqDirect(ticker: string): Promise<StooqPrice | null> {
  const url  = `https://stooq.pl/q/l/?s=${ticker.toLowerCase()}.pl&e=csv`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": STOOQ_UA },
      signal:  ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const text  = (await res.text()).trim();
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

    const dataLine = lines.find(l =>
      !l.toLowerCase().startsWith("symbol") && !l.startsWith("#")
    );
    if (!dataLine) return null;

    // Symbol,Date,Time,Open,High,Low,Close,Volume
    const cols  = dataLine.split(",");
    const date  = cols[1]?.trim();
    if (!date || date === "N/D" || date === "0000-00-00") return null;

    const close = parseNum(cols[6]);
    if (!close) return null;

    return { date, open: parseNum(cols[3]), high: parseNum(cols[4]), low: parseNum(cols[5]), close, volume: parseInt_(cols[7]) };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/** Fetch a batch of GPW tickers via Railway proxy (bypasses Stooq IP blocks). */
async function fetchRailwayBatch(tickers: string[]): Promise<Map<string, StooqPrice>> {
  const baseUrl = Deno.env.get("RAILWAY_SCRAPER_URL") ?? "";
  const apiKey  = Deno.env.get("RAILWAY_SCRAPER_KEY") ?? "";
  if (!baseUrl) throw new Error("RAILWAY_SCRAPER_URL not set");

  const url = `${baseUrl}/prices/gpw/batch?tickers=${encodeURIComponent(tickers.join(","))}&days=2`;
  const res  = await fetch(url, {
    headers: { "X-API-Key": apiKey },
    signal:  AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Railway batch: HTTP ${res.status}`);

  const json = await res.json() as {
    ok:      boolean;
    results: Array<{
      ticker: string;
      ok:     boolean;
      data?:  Array<{ date: string; close: number | null; open?: number | null; high?: number | null; low?: number | null; volume?: number | null }>;
    }>;
  };

  if (!json.ok) throw new Error("Railway batch returned ok=false");

  const map = new Map<string, StooqPrice>();
  for (const r of json.results ?? []) {
    if (!r.ok || !r.data?.length) continue;
    // Take most recent row
    const latest = r.data.reduce((a, b) => a.date > b.date ? a : b);
    if (!latest.close || latest.close <= 0) continue;
    map.set(r.ticker, {
      date:   latest.date,
      open:   latest.open   ?? null,
      high:   latest.high   ?? null,
      low:    latest.low    ?? null,
      close:  latest.close,
      volume: latest.volume ?? null,
    });
  }
  return map;
}

/** Fetch price for a single ticker — Railway first, direct Stooq as fallback. */
async function fetchPrice(ticker: string): Promise<StooqPrice | null> {
  // Direct Stooq (may fail from EF IPs — caught by caller)
  return fetchStooqDirect(ticker);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  const now = new Date();
  console.log("[fetch-prices] Invoked at:", now.toISOString());

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const startedAt = now.toISOString();

  // ── Load GPW tickers ───────────────────────────────────────────────────────
  const { data: companies, error: compErr } = await supabase
    .from("companies")
    .select("ticker")
    .eq("market", "GPW")
    .order("ticker", { ascending: true });

  if (compErr || !companies?.length) {
    const msg = compErr?.message ?? "No GPW companies found";
    console.error("[fetch-prices] Fatal:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const tickers     = (companies as { ticker: string }[]).map(c => c.ticker);
  const totalBatches = Math.ceil(tickers.length / BATCH_SIZE);

  // ── Time-based rotating batch selection ───────────────────────────────────
  const hourSlot   = now.getHours() * 6 + Math.floor(now.getMinutes() / 10);
  const batchIndex = hourSlot % totalBatches;
  const batchKey   = `gpw_batch_${String(batchIndex).padStart(2, "0")}`;

  const batchStart   = batchIndex * BATCH_SIZE;
  const batchTickers = tickers.slice(batchStart, batchStart + BATCH_SIZE);

  console.log(
    `[fetch-prices] ${batchKey}: tickers[${batchStart}..${batchStart + batchTickers.length - 1}]`,
    `(batch ${batchIndex + 1}/${totalBatches})`,
  );

  // ── Pipeline run — start ───────────────────────────────────────────────────
  const { data: runData } = await supabase
    .from("pipeline_runs")
    .insert({
      function_name: "fetch-prices",
      source:        batchKey,
      status:        "running",
      started_at:    startedAt,
    })
    .select("id")
    .single();
  const runId = runData?.id as number | undefined;

  // ── Try Railway batch (bypasses Stooq IP blocks on EF servers) ──────────────
  let railwayMap = new Map<string, StooqPrice>();
  const railwayUrl = Deno.env.get("RAILWAY_SCRAPER_URL") ?? "";

  if (railwayUrl) {
    try {
      railwayMap = await fetchRailwayBatch(batchTickers);
      console.log(`[fetch-prices] Railway batch: ${railwayMap.size}/${batchTickers.length} tickers`);
    } catch (err) {
      console.warn(`[fetch-prices] Railway batch failed: ${err instanceof Error ? err.message : err} — falling back to direct Stooq`);
    }
  }

  // ── Fetch prices ───────────────────────────────────────────────────────────
  let fetched = 0;
  let failed  = 0;
  const failedTickers: string[] = [];

  for (let i = 0; i < batchTickers.length; i++) {
    const ticker = batchTickers[i];
    if (i > 0 && !railwayMap.has(ticker)) await sleep(DELAY_MS);

    try {
      // Use Railway result if available, else direct Stooq
      const price = railwayMap.has(ticker)
        ? railwayMap.get(ticker)!
        : await fetchPrice(ticker);

      if (!price) {
        console.warn(`[fetch-prices] ${ticker}: no data (N/D or empty response)`);
        failed++;
        failedTickers.push(ticker);
        continue;
      }

      // Upsert to price_history
      const { error: phErr } = await supabase
        .from("price_history")
        .upsert({
          ticker,
          date:   price.date,
          open:   price.open,
          high:   price.high,
          low:    price.low,
          close:  price.close,
          volume: price.volume,
          source: "stooq",
        }, { onConflict: "ticker,date" });

      if (phErr) {
        console.error(`[fetch-prices] ${ticker}: price_history upsert failed:`, phErr.message);
        failed++;
        failedTickers.push(ticker);
        continue;
      }

      // Compute change_1d from last 2 rows in price_history
      const { data: hist } = await supabase
        .from("price_history")
        .select("close")
        .eq("ticker", ticker)
        .order("date", { ascending: false })
        .limit(2);

      const prev     = (hist as Array<{ close: number }> | null)?.[1];
      const change1d = prev && prev.close > 0
        ? Math.round(((price.close - prev.close) / prev.close * 100) * 10000) / 10000
        : null;

      // Update companies
      await supabase.from("companies").update({
        last_price:       price.close,
        change_1d:        change1d,
        price_updated_at: now.toISOString(),
      }).eq("ticker", ticker);

      fetched++;
      console.log(`[fetch-prices] ${ticker}: ${price.close} PLN (${price.date})${change1d !== null ? ` Δ${change1d > 0 ? "+" : ""}${change1d}%` : ""} ✓`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[fetch-prices] ${ticker}: ${msg}`);
      failed++;
      failedTickers.push(ticker);
    }
  }

  const finishedAt  = new Date().toISOString();
  const batchStatus: "success" | "partial" | "failed" =
    failed  === 0             ? "success" :
    fetched > 0               ? "partial"  :
                                "failed";

  console.log(`[fetch-prices] ${batchKey} done — fetched=${fetched} failed=${failed} status=${batchStatus}`);

  // ── Checkpoint: price_fetch_batches ────────────────────────────────────────
  await supabase.from("price_fetch_batches").upsert({
    batch_key:     batchKey,
    tickers:       batchTickers,
    last_run_at:   finishedAt,
    last_status:   batchStatus,
    items_fetched: fetched,
    items_failed:  failed,
    details: {
      batch_index:   batchIndex,
      total_batches: totalBatches,
      failed_tickers: failedTickers.slice(0, 20),
    },
  }, { onConflict: "batch_key" });

  // ── Pipeline run — finish ──────────────────────────────────────────────────
  if (runId) {
    await supabase.from("pipeline_runs").update({
      finished_at: finishedAt,
      status:      batchStatus === "failed" ? "failed" : "success",
      items_in:    batchTickers.length,
      items_out:   fetched,
      errors:      failed,
      details: {
        batch_index:   batchIndex,
        total_batches: totalBatches,
        batch_key:     batchKey,
      },
    }).eq("id", runId);
  }

  // ── system_health ──────────────────────────────────────────────────────────
  if (fetched > 0) {
    await supabase.from("system_health").upsert({
      function_name:        "fetch-prices",
      last_success_at:      finishedAt,
      items_processed:      fetched,
      consecutive_failures: 0,
    }, { onConflict: "function_name" });
  }
  if (failed > 0) {
    // Set error fields separately to avoid overwriting last_success_at on partial success
    await supabase.from("system_health")
      .update({
        last_error:    failedTickers.slice(0, 5).join(", ") + (failedTickers.length > 5 ? ` (+${failedTickers.length - 5} more)` : ""),
        last_error_at: finishedAt,
        ...(fetched === 0 ? { consecutive_failures: 1 } : {}),
      })
      .eq("function_name", "fetch-prices");
  }

  return new Response(
    JSON.stringify({
      ok:             true,
      batch:          batchKey,
      batch_index:    batchIndex,
      total_batches:  totalBatches,
      fetched,
      failed,
      total_in_batch: batchTickers.length,
      ts:             finishedAt,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
