// app/api/nav-stats/route.ts
// Returns quick stats for Nav badges — polled every 60s.
// { alerts_count: N, events_today: M }

import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

export async function GET() {
  const db  = supabase();
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10); // YYYY-MM-DD

  const [alertsRes, eventsRes] = await Promise.all([
    db.from("user_alerts").select("id", { count: "exact", head: true }).eq("triggered", false),
    db.from("company_events")
      .select("id", { count: "exact", head: true })
      .gte("published_at", `${todayIso}T00:00:00Z`),
  ]);

  return Response.json(
    {
      alerts_count:  alertsRes.count ?? 0,
      events_today:  eventsRes.count ?? 0,
      ts:            now.toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
