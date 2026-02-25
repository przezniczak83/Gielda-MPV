import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.toUpperCase().trim();
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

  const { data, error } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  )
    .from("institutional_ownership")
    .select("institution_name, shares_held, ownership_pct, change_pct, report_date, source")
    .eq("ticker", ticker)
    .order("report_date", { ascending: false })
    .order("ownership_pct",  { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Deduplicate: keep latest report_date per institution
  const seen = new Set<string>();
  const deduped = (data ?? []).filter(r => {
    if (seen.has(r.institution_name)) return false;
    seen.add(r.institution_name);
    return true;
  });

  return NextResponse.json(deduped.slice(0, 10));
}
