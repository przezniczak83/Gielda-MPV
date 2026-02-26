// supabase/functions/calc-correlations/index.ts
// Compute Pearson price-return correlations for a given ticker vs its peers.
//
// POST { ticker: string, period_days?: number }
//
// Algorithm:
//   1. Fetch daily closes for ticker + all peers in same market (last N days)
//   2. Compute daily log-returns for each
//   3. Pearson r(ticker, peer) for overlapping days
//   4. Upsert top 30 results (by |r|) to price_correlations
//
// Deploy: supabase functions deploy calc-correlations --project-ref pftgmorsthoezhmojjpg

import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { createLogger }      from "../_shared/logger.ts";
import { okResponse, errorResponse } from "../_shared/response.ts";

const log = createLogger("calc-correlations");

const DEFAULT_DAYS = 90;
const MAX_PEERS    = 50;   // limit to avoid Supabase row limits

// ── Math helpers ─────────────────────────────────────────────────────────────

function dailyReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    } else {
      returns.push(0);
    }
  }
  return returns;
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 5) return null;
  const n = xs.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX  += xs[i];
    sumY  += ys[i];
    sumXY += xs[i] * ys[i];
    sumX2 += xs[i] * xs[i];
    sumY2 += ys[i] * ys[i];
  }
  const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

// ── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  let body: { ticker?: string; period_days?: number } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const ticker = body.ticker?.toUpperCase().trim();
  if (!ticker) return errorResponse("ticker required", 400);

  const periodDays = body.period_days ?? DEFAULT_DAYS;
  const since = new Date(Date.now() - periodDays * 24 * 3600 * 1000)
    .toISOString().slice(0, 10);

  let supabase;
  try { supabase = getSupabaseClient(); }
  catch (err) { return errorResponse(err instanceof Error ? err.message : String(err)); }

  // ── Get market for this ticker ─────────────────────────────────────────────
  const { data: company, error: coErr } = await supabase
    .from("companies")
    .select("market")
    .eq("ticker", ticker)
    .maybeSingle();

  if (coErr || !company) return errorResponse(coErr?.message ?? "ticker not found", 404);

  // ── Get peers in same market ───────────────────────────────────────────────
  const { data: peers, error: peersErr } = await supabase
    .from("companies")
    .select("ticker")
    .eq("market", company.market)
    .neq("ticker", ticker)
    .limit(MAX_PEERS);

  if (peersErr) return errorResponse(peersErr.message);
  if (!peers || peers.length === 0) return okResponse({ message: "no peers", ticker });

  const allTickers = [ticker, ...peers.map((p: { ticker: string }) => p.ticker)];

  // ── Fetch price history for all tickers ───────────────────────────────────
  const { data: prices, error: prErr } = await supabase
    .from("price_history")
    .select("ticker, date, close")
    .in("ticker", allTickers)
    .gte("date", since)
    .order("date", { ascending: true });

  if (prErr) return errorResponse(prErr.message);
  if (!prices || prices.length === 0) return okResponse({ message: "no price data", ticker });

  // ── Build date-indexed maps per ticker ────────────────────────────────────
  const priceMap = new Map<string, Map<string, number>>();
  for (const row of prices as { ticker: string; date: string; close: number }[]) {
    if (!priceMap.has(row.ticker)) priceMap.set(row.ticker, new Map());
    priceMap.get(row.ticker)!.set(row.date, row.close);
  }

  const targetMap = priceMap.get(ticker);
  if (!targetMap || targetMap.size < 5) {
    return okResponse({ message: "insufficient price data for target ticker", ticker });
  }

  const targetDates = [...targetMap.keys()].sort();

  // Compute returns for target
  const targetCloses = targetDates.map(d => targetMap.get(d)!);
  const targetReturns = dailyReturns(targetCloses);

  // ── Compute correlations ──────────────────────────────────────────────────
  const results: Array<{ ticker_b: string; r: number; n: number }> = [];

  for (const peer of peers as { ticker: string }[]) {
    const peerMap = priceMap.get(peer.ticker);
    if (!peerMap || peerMap.size < 5) continue;

    // Find overlapping dates
    const commonDates = targetDates.filter(d => peerMap.has(d));
    if (commonDates.length < 10) continue;

    // Get aligned returns (by index in commonDates sorted list)
    // We need to compute returns from common dates only
    const tCloses: number[] = [];
    const pCloses: number[] = [];
    for (const d of commonDates) {
      tCloses.push(targetMap.get(d)!);
      pCloses.push(peerMap.get(d)!);
    }

    const tRet = dailyReturns(tCloses);
    const pRet = dailyReturns(pCloses);

    const r = pearson(tRet, pRet);
    if (r !== null) {
      results.push({ ticker_b: peer.ticker, r, n: tRet.length });
    }
  }

  // Sort by |r| descending, keep top 30
  results.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  const top30 = results.slice(0, 30);

  if (top30.length === 0) return okResponse({ message: "no correlations computed", ticker });

  // ── Upsert correlations ────────────────────────────────────────────────────
  const upsertRows = top30.map(({ ticker_b, r, n }) => ({
    ticker_a:    ticker,
    ticker_b,
    correlation: Math.round(r * 10000) / 10000,
    sample_size: n,
    period_days: periodDays,
    computed_at: new Date().toISOString(),
  }));

  const { error: upsertErr } = await supabase
    .from("price_correlations")
    .upsert(upsertRows, { onConflict: "ticker_a,ticker_b" });

  if (upsertErr) {
    log.error("Upsert error:", upsertErr.message);
    return errorResponse(upsertErr.message);
  }

  log.info(`${ticker}: computed ${top30.length} correlations vs ${peers.length} peers`);
  return okResponse({
    ticker,
    peers_checked: results.length,
    correlations:  top30.length,
    top5: top30.slice(0, 5).map(r => ({ ticker: r.ticker_b, r: r.r.toFixed(3) })),
  });
});
