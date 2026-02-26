// GET /api/heatmap?tickers=PKN,PKO,PZU,KGH,...
// Returns a correlation matrix for the given list of tickers.
// Data from price_correlations table (pre-computed by calc-correlations EF).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const DEFAULT_TICKERS = [
  "PKO","PKN","PZU","KGH","PEO","SPL","LPP","DNP","ALE","CDR",
  "JSW","PGE","ENA","ATT","CPS","MBK","BDX","KRU","XTB","GPW",
];

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

export async function GET(req: NextRequest) {
  const tickersParam = req.nextUrl.searchParams.get("tickers");
  const tickers      = tickersParam
    ? tickersParam.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, 25)
    : DEFAULT_TICKERS;

  const db = supabase();

  // Fetch all pairwise correlations where both tickers are in our set
  const { data, error } = await db
    .from("price_correlations")
    .select("ticker_a, ticker_b, correlation, computed_at")
    .in("ticker_a", tickers)
    .in("ticker_b", tickers);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch company names
  const { data: companies } = await db
    .from("companies")
    .select("ticker, name")
    .in("ticker", tickers);

  const nameMap: Record<string, string> = {};
  (companies ?? []).forEach((c) => { nameMap[c.ticker] = c.name; });

  // Build matrix
  const idx: Record<string, number> = {};
  tickers.forEach((t, i) => { idx[t] = i; });

  const n = tickers.length;
  const matrix: (number | null)[][] = Array.from({ length: n }, () =>
    Array(n).fill(null),
  );

  // Diagonal = 1.0 (self-correlation)
  for (let i = 0; i < n; i++) matrix[i][i] = 1;

  for (const row of data ?? []) {
    const ia = idx[row.ticker_a];
    const ib = idx[row.ticker_b];
    if (ia !== undefined && ib !== undefined) {
      matrix[ia][ib] = row.correlation;
      matrix[ib][ia] = row.correlation; // symmetric
    }
  }

  // Identify high-risk clusters: pairs with correlation > 0.7 (concentrated risk)
  const riskClusters: { a: string; b: string; corr: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = matrix[i][j];
      if (c !== null && c >= 0.7) {
        riskClusters.push({ a: tickers[i], b: tickers[j], corr: c });
      }
    }
  }
  riskClusters.sort((a, b) => b.corr - a.corr);

  // Diversifiers: pairs with correlation < -0.2
  const diversifiers: { a: string; b: string; corr: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const c = matrix[i][j];
      if (c !== null && c <= -0.2) {
        diversifiers.push({ a: tickers[i], b: tickers[j], corr: c });
      }
    }
  }
  diversifiers.sort((a, b) => a.corr - b.corr);

  const computedAt = (data ?? []).find((r) => r.computed_at)?.computed_at ?? null;

  return NextResponse.json({
    tickers,
    matrix,
    labels:       nameMap,
    risk_clusters:  riskClusters.slice(0, 5),
    diversifiers:   diversifiers.slice(0, 5),
    computed_at:    computedAt,
  }, {
    headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate=600" },
  });
}
