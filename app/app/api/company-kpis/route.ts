import { NextResponse }  from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker")?.toUpperCase();

  if (!ticker) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL    ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY   ?? "",
    { auth: { persistSession: false } },
  );

  // Fetch financial rows + computed KPIs in parallel
  const [financialsRes, kpisRes] = await Promise.all([
    supabase
      .from("company_financials")
      .select("period, revenue, net_income, ebitda, eps, net_debt, currency")
      .eq("ticker", ticker)
      .order("period", { ascending: false })
      .limit(4),

    supabase
      .from("company_kpis")
      .select("kpi_type, value, metadata, calculated_at")
      .eq("ticker", ticker)
      .in("kpi_type", ["health_score", "red_flags", "dividend_score"]),
  ]);

  if (financialsRes.error) {
    return NextResponse.json({ error: financialsRes.error.message }, { status: 500 });
  }

  const kpisMap: Record<string, { value: number | null; metadata: unknown; calculated_at: string }> = {};
  for (const row of (kpisRes.data ?? [])) {
    kpisMap[row.kpi_type] = {
      value:        row.value,
      metadata:     row.metadata,
      calculated_at: row.calculated_at,
    };
  }

  return NextResponse.json(
    {
      financials:     financialsRes.data ?? [],
      health_score:   kpisMap["health_score"]   ?? null,
      red_flags:      kpisMap["red_flags"]       ?? null,
      dividend_score: kpisMap["dividend_score"]  ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
