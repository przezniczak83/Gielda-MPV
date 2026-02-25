import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "50");

  const { data, error } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  )
    .from("calendar_events")
    .select("id, ticker, event_type, event_date, title, description, companies(name)")
    .gte("event_date", new Date().toISOString())
    .order("event_date", { ascending: true })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result = (data ?? []).map(e => ({
    id:           e.id,
    ticker:       e.ticker,
    company_name: (e.companies as { name?: string } | null)?.name ?? null,
    event_type:   e.event_type,
    event_date:   e.event_date,
    title:        e.title,
    description:  e.description,
  }));

  return NextResponse.json(result);
}
