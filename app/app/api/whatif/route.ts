// GET /api/whatif          — list all scenarios
// GET /api/whatif?id=3    — single scenario with company names

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

interface ScenarioRow {
  id:          number;
  name:        string;
  description: string;
  category:    string;
  impacts:     Record<string, { pct_change: number; rationale: string }>;
  created_at:  string;
}

export async function GET(req: NextRequest) {
  const idParam = req.nextUrl.searchParams.get("id");
  const db      = supabase();

  if (idParam) {
    // Single scenario with enriched company data
    const { data: scenario, error } = await db
      .from("whatif_scenarios")
      .select("*")
      .eq("id", idParam)
      .maybeSingle<ScenarioRow>();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!scenario) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Fetch company names for impacted tickers
    const impactTickers = Object.keys(scenario.impacts);
    const { data: companies } = await db
      .from("companies")
      .select("ticker, name, sector")
      .in("ticker", impactTickers);

    const companyMap: Record<string, { name: string; sector: string | null }> = {};
    (companies ?? []).forEach((c) => { companyMap[c.ticker] = { name: c.name, sector: c.sector }; });

    // Enrich impacts with company names
    const enrichedImpacts = Object.entries(scenario.impacts).map(([ticker, impact]) => ({
      ticker,
      name:       companyMap[ticker]?.name    ?? ticker,
      sector:     companyMap[ticker]?.sector  ?? null,
      pct_change: impact.pct_change,
      rationale:  impact.rationale,
    })).sort((a, b) => b.pct_change - a.pct_change);

    return NextResponse.json({
      ...scenario,
      enriched_impacts: enrichedImpacts,
    }, {
      headers: { "Cache-Control": "s-maxage=3600" },
    });
  }

  // All scenarios (list)
  const { data, error } = await db
    .from("whatif_scenarios")
    .select("id, name, description, category, created_at")
    .order("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? [], {
    headers: { "Cache-Control": "s-maxage=3600" },
  });
}
