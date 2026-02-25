import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json({ companies: [], events: [] });

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );

  const pattern = `%${q}%`;

  const [compRes, eventRes] = await Promise.all([
    db
      .from("companies")
      .select("ticker, name, sector, market")
      .or(`ticker.ilike.${pattern},name.ilike.${pattern}`)
      .limit(5),

    db
      .from("company_events")
      .select("id, ticker, title, event_type, published_at")
      .ilike("title", pattern)
      .order("published_at", { ascending: false })
      .limit(5),
  ]);

  return NextResponse.json({
    companies: (compRes.data ?? []).map(c => ({ ...c, type: "company" })),
    events:    (eventRes.data ?? []).map(e => ({ ...e, type: "event" })),
  });
}
