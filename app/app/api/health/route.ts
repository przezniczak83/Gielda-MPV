import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// ─── GET /api/health ─────────────────────────────────────────────────────────

export async function GET() {
  const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL    ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY   ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Run all stat queries in parallel
  const [
    companiesRes,
    eventsRes,
    lastIngestRes,
    lastPriceRes,
  ] = await Promise.allSettled([
    supabase.from("companies").select("*", { count: "exact", head: true }),
    supabase.from("company_events").select("*", { count: "exact", head: true }),
    supabase.from("raw_ingest").select("inserted_at").order("inserted_at", { ascending: false }).limit(1),
    supabase.from("price_history").select("date").order("date", { ascending: false }).limit(1),
  ]);

  const companies  = companiesRes.status  === "fulfilled" ? (companiesRes.value.count  ?? 0) : 0;
  const events     = eventsRes.status     === "fulfilled" ? (eventsRes.value.count     ?? 0) : 0;

  const lastIngestRow =
    lastIngestRes.status === "fulfilled" ? lastIngestRes.value.data?.[0] : null;
  const lastPriceRow  =
    lastPriceRes.status  === "fulfilled" ? lastPriceRes.value.data?.[0]  : null;

  const dbOk = companiesRes.status === "fulfilled" && !companiesRes.value.error;

  const body = {
    ok:    dbOk,
    ts:    new Date().toISOString(),
    stats: {
      companies,
      events,
      last_ingest: (lastIngestRow as { inserted_at?: string } | null)?.inserted_at ?? null,
      last_price:  (lastPriceRow  as { date?: string }        | null)?.date        ?? null,
    },
  };

  return NextResponse.json(body, {
    status: dbOk ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
