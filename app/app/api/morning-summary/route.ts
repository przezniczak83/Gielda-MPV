// app/api/morning-summary/route.ts
// GET → { alerts_last_12h, calendar_today, new_recommendations_24h }

import { createClient } from "@supabase/supabase-js";

export const revalidate = 300; // 5 min

export const runtime = "nodejs";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

export async function GET() {
  const twelveHAgo = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
  const oneDayAgo  = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const tomorrow   = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

  const db = supabase();
  const [alertsRes, calendarRes, recsRes] = await Promise.all([
    db.from("company_events")
      .select("*", { count: "exact", head: true })
      .gte("published_at", twelveHAgo)
      .gte("impact_score", 6),
    db.from("calendar_events")
      .select("*", { count: "exact", head: true })
      .gte("event_date", todayStart)
      .lte("event_date", tomorrow),
    db.from("analyst_forecasts")
      .select("*", { count: "exact", head: true })
      .gte("created_at", oneDayAgo),
  ]);

  return Response.json({
    ok:                    true,
    alerts_last_12h:       alertsRes.count   ?? 0,
    calendar_today:        calendarRes.count  ?? 0,
    new_recommendations_24h: recsRes.count   ?? 0,
  });
}
