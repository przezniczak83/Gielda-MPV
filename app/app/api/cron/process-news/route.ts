// GET /api/cron/process-news
// Vercel Cron: calls process-news Edge Function every 2 minutes.
// Backup for pg_cron. Vercel sends Authorization: Bearer <CRON_SECRET>.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Allow both Vercel cron (CRON_SECRET) and direct health-check calls in development
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const efUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/process-news`;

  const resp = await fetch(efUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type":  "application/json",
    },
    body: "{}",
  });

  const data = await resp.json().catch(() => ({}));
  return NextResponse.json({ ok: resp.ok, status: resp.status, data });
}
