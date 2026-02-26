// app/api/event-impact/route.ts
// Returns aggregated event impact stats from event_impact_analysis.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase
    .from("event_impact_analysis")
    .select("event_type, sample_count, avg_impact_score, positive_pct, high_impact_pct, top_tickers, computed_at")
    .order("avg_impact_score", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? [], {
    headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate" },
  });
}
