import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.toUpperCase().trim();
  if (!ticker) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }

  const db = supabase();

  // All forecasts for this ticker (last 12 months)
  const since = new Date();
  since.setFullYear(since.getFullYear() - 1);

  const { data: rows, error } = await db
    .from("analyst_forecasts")
    .select("id, institution, analyst_name, recommendation, price_target, currency, upside_pct, horizon_months, published_at, source_type")
    .eq("ticker", ticker)
    .gte("published_at", since.toISOString())
    .order("published_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ ticker, total: 0, buy: 0, hold: 0, sell: 0, neutral: 0, avg_pt: null, min_pt: null, max_pt: null, last_5: [] });
  }

  // Aggregate
  let buy = 0, hold = 0, sell = 0, neutral = 0;
  const pts: number[] = [];

  for (const r of rows) {
    const rec = (r.recommendation ?? "").toUpperCase();
    if (rec === "BUY" || rec === "OVERWEIGHT")        buy++;
    else if (rec === "SELL" || rec === "UNDERWEIGHT")  sell++;
    else if (rec === "HOLD")                           hold++;
    else                                               neutral++;
    if (r.price_target != null) pts.push(Number(r.price_target));
  }

  const avg_pt = pts.length > 0 ? parseFloat((pts.reduce((s, v) => s + v, 0) / pts.length).toFixed(2)) : null;
  const min_pt = pts.length > 0 ? parseFloat(Math.min(...pts).toFixed(2)) : null;
  const max_pt = pts.length > 0 ? parseFloat(Math.max(...pts).toFixed(2)) : null;

  const last_5 = rows.slice(0, 5).map(r => ({
    institution:    r.institution,
    analyst_name:   r.analyst_name,
    recommendation: r.recommendation,
    price_target:   r.price_target,
    currency:       r.currency,
    upside_pct:     r.upside_pct,
    published_at:   r.published_at,
    source_type:    r.source_type,
  }));

  return NextResponse.json({
    ticker,
    total:   rows.length,
    buy,
    hold,
    sell,
    neutral,
    avg_pt,
    min_pt,
    max_pt,
    last_5,
  });
}
