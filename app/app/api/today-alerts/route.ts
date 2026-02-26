import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const since = searchParams.get("since") ?? new Date(new Date().setHours(0,0,0,0)).toISOString();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL    ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY   ?? "",
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase
    .from("company_events")
    .select("ticker, title, alerted_at, impact_score")
    .not("alerted_at", "is", null)
    .gte("alerted_at", since)
    .order("alerted_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json([], { status: 500 });
  }

  return NextResponse.json(data ?? [], {
    headers: { "Cache-Control": "no-store" },
  });
}
