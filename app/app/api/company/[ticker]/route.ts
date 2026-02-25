// app/api/company/[ticker]/route.ts
// Consolidated company data endpoint.
// Tries company_snapshot first (<30 min fresh), falls back to live parallel queries.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL    ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY   ?? "",
    { auth: { persistSession: false } },
  );
}

function isFresh(computedAt: string, maxMinutes: number): boolean {
  const age = (Date.now() - new Date(computedAt).getTime()) / 1000 / 60;
  return age < maxMinutes;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker: raw } = await params;
  const ticker = raw.toUpperCase().trim();

  const db = supabase();

  // ── 1. Try snapshot (fast path) ───────────────────────────────────────────
  const { data: snapRow } = await db
    .from("company_snapshot")
    .select("snapshot, computed_at")
    .eq("ticker", ticker)
    .maybeSingle();

  if (snapRow && isFresh(snapRow.computed_at, 30)) {
    return NextResponse.json(
      {
        ok:          true,
        source:      "snapshot",
        computed_at: snapRow.computed_at,
        ...snapRow.snapshot,
      },
      { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=60" } },
    );
  }

  // ── 2. Snapshot missing / stale → live parallel queries ───────────────────
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const [
    companyRes,
    eventsRes,
    pricesRes,
    kpisRes,
    forecastsRes,
    multiplesRes,
    ourForecastRes,
  ] = await Promise.all([
    db.from("companies")
      .select("ticker, name, sector, market")
      .eq("ticker", ticker)
      .maybeSingle(),

    db.from("company_events")
      .select("id, title, event_type, impact_score, published_at, url")
      .eq("ticker", ticker)
      .order("published_at", { ascending: false })
      .limit(20),

    db.from("price_history")
      .select("close, date, volume")
      .eq("ticker", ticker)
      .order("date", { ascending: false })
      .limit(30),

    db.from("company_kpis")
      .select("kpi_type, value, metadata, calculated_at")
      .eq("ticker", ticker)
      .in("kpi_type", ["health_score", "red_flags", "earnings_quality", "moat_score", "dividend_score"]),

    db.from("analyst_forecasts")
      .select("institution, analyst_name, recommendation, price_target, currency, upside_pct, published_at, source_type")
      .eq("ticker", ticker)
      .gte("published_at", oneYearAgo.toISOString())
      .order("published_at", { ascending: false })
      .limit(20),

    db.from("valuation_multiples")
      .select("pe_ratio, pb_ratio, ev_ebitda, market_cap")
      .eq("ticker", ticker)
      .maybeSingle(),

    db.from("our_forecasts")
      .select("scenario, price_target, upside_pct, confidence, revenue_growth_pct, ebitda_margin_pct, rationale, generated_at")
      .eq("ticker", ticker)
      .order("scenario"),
  ]);

  if (!companyRes.data) {
    return NextResponse.json({ ok: false, error: `Ticker ${ticker} not found` }, { status: 404 });
  }

  return NextResponse.json(
    {
      ok:              true,
      source:          "live",
      company:         companyRes.data,
      recent_events:   eventsRes.data    ?? [],
      price_history:   pricesRes.data    ?? [],
      kpis:            kpisRes.data      ?? [],
      analyst_forecasts: forecastsRes.data ?? [],
      multiples:       multiplesRes.data ?? null,
      our_forecasts:   ourForecastRes.data ?? [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
