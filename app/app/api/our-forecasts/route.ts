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

  const { data, error } = await supabase()
    .from("our_forecasts")
    .select("scenario, revenue_growth_pct, ebitda_margin_pct, eps, price_target, rationale, confidence, key_assumptions, generated_at")
    .eq("ticker", ticker)
    .order("scenario");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
