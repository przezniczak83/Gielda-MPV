import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker") ?? "";
  if (!ticker) return NextResponse.json([], { status: 400 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase
    .from("sector_kpis")
    .select("kpi_code, kpi_name, value, prev_value, change_pct, unit, period, extracted_at")
    .eq("ticker", ticker)
    .order("extracted_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Deduplicate by kpi_code — keep most recent
  const seen   = new Set<string>();
  const latest = [];
  for (const row of data ?? []) {
    if (!seen.has(row.kpi_code)) {
      seen.add(row.kpi_code);
      latest.push(row);
    }
  }

  return NextResponse.json(latest, {
    headers: { "Cache-Control": "public, s-maxage=300" },
  });
}
