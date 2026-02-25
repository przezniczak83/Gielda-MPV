import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

export interface SmartWatchlist {
  id:          string;
  name:        string;
  description: string;
  items:       SmartItem[];
}

export interface SmartItem {
  ticker: string;
  name:   string;
  value:  number;
  label:  string;
}

export async function GET() {
  const db = supabase();

  // Run all 3 smart queries in parallel
  const [highRiskRes, undervaluedRes, moatRes] = await Promise.allSettled([
    // Smart 1 — Wysokie ryzyko (Red Flags ≥ 3)
    db
      .from("company_kpis")
      .select("ticker, value, companies!inner(name)")
      .eq("kpi_type", "red_flags")
      .gte("value", 3)
      .order("value", { ascending: false })
      .limit(20),

    // Smart 2 — Niedowartościowane (upside > 20%)
    db
      .from("analyst_forecasts")
      .select("ticker, upside_pct, companies!inner(name)")
      .gt("upside_pct", 20)
      .gte("published_at", new Date(Date.now() - 180 * 24 * 3600 * 1000).toISOString())
      .order("upside_pct", { ascending: false })
      .limit(50),

    // Smart 3 — Silny MOAT tech (moat_score ≥ 7)
    db
      .from("company_kpis")
      .select("ticker, value, companies!inner(name)")
      .eq("kpi_type", "moat_score")
      .gte("value", 7)
      .order("value", { ascending: false })
      .limit(20),
  ]);

  // ── Smart 1: High Risk ─────────────────────────────────────────────────────

  const highRiskItems: SmartItem[] = [];
  if (highRiskRes.status === "fulfilled" && highRiskRes.value.data) {
    for (const row of highRiskRes.value.data) {
      highRiskItems.push({
        ticker: row.ticker,
        name:   (row.companies as unknown as { name: string } | null)?.name ?? "",
        value:  row.value ?? 0,
        label:  `${row.value ?? 0} red flags`,
      });
    }
  }

  // ── Smart 2: Undervalued (average upside per ticker) ──────────────────────

  const undervaluedItems: SmartItem[] = [];
  if (undervaluedRes.status === "fulfilled" && undervaluedRes.value.data) {
    const map = new Map<string, { name: string; sum: number; count: number }>();
    for (const row of undervaluedRes.value.data) {
      if (!map.has(row.ticker)) {
        map.set(row.ticker, {
          name:  (row.companies as unknown as { name: string } | null)?.name ?? "",
          sum:   0,
          count: 0,
        });
      }
      const entry = map.get(row.ticker)!;
      entry.sum   += row.upside_pct ?? 0;
      entry.count += 1;
    }
    for (const [ticker, { name, sum, count }] of map.entries()) {
      const avg = sum / count;
      if (avg > 20) {
        undervaluedItems.push({
          ticker,
          name,
          value: Math.round(avg * 10) / 10,
          label: `+${(Math.round(avg * 10) / 10).toFixed(1)}% upside`,
        });
      }
    }
    undervaluedItems.sort((a, b) => b.value - a.value);
  }

  // ── Smart 3: Strong MOAT ───────────────────────────────────────────────────

  const moatItems: SmartItem[] = [];
  if (moatRes.status === "fulfilled" && moatRes.value.data) {
    for (const row of moatRes.value.data) {
      moatItems.push({
        ticker: row.ticker,
        name:   (row.companies as unknown as { name: string } | null)?.name ?? "",
        value:  row.value ?? 0,
        label:  `MOAT ${(row.value ?? 0).toFixed(1)}/10`,
      });
    }
  }

  const smartWatchlists: SmartWatchlist[] = [
    {
      id:          "high-risk",
      name:        "Wysokie ryzyko",
      description: "Spółki z Red Flags ≥ 3",
      items:       highRiskItems,
    },
    {
      id:          "undervalued",
      name:        "Niedowartościowane",
      description: "Upside > 20% wg konsensusu analityków",
      items:       undervaluedItems,
    },
    {
      id:          "strong-moat",
      name:        "Silny MOAT tech",
      description: "MOAT score ≥ 7 — spółki z trwałą przewagą",
      items:       moatItems,
    },
  ];

  return NextResponse.json(smartWatchlists);
}
