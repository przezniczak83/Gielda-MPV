// GET /api/status
// Returns news pipeline health: latest ingestion_log entries + news_items stats.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const revalidate = 60;

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const since1h  = new Date(Date.now() -      3600 * 1000).toISOString();

  const [
    { data: logRows,  error: logErr },
    { count: total24h },
    { count: processed24h },
    { count: total1h },
    { count: pending },
    { data: breakingRows },
  ] = await Promise.all([
    supabase
      .from("ingestion_log")
      .select("source_name, status, messages_fetched, messages_new, messages_failed, error_details, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("news_items").select("*", { count: "exact", head: true }).gte("created_at", since24h),
    supabase.from("news_items").select("*", { count: "exact", head: true }).gte("created_at", since24h).eq("ai_processed", true),
    supabase.from("news_items").select("*", { count: "exact", head: true }).gte("created_at", since1h),
    supabase.from("news_items").select("*", { count: "exact", head: true }).eq("ai_processed", false),
    supabase
      .from("news_items")
      .select("id, title, source, published_at")
      .eq("is_breaking", true)
      .gte("published_at", since24h)
      .order("published_at", { ascending: false })
      .limit(5),
  ]);

  if (logErr) {
    return NextResponse.json({ error: logErr.message }, { status: 500 });
  }

  // Normalize log rows to a consistent shape for the frontend
  const log = (logRows ?? []).map(r => ({
    function_name:   (r as Record<string, unknown>).source_name     as string,
    status:          (r as Record<string, unknown>).status           as string,
    items_fetched:   (r as Record<string, unknown>).messages_fetched as number | null,
    items_processed: (r as Record<string, unknown>).messages_new     as number | null,
    items_failed:    (r as Record<string, unknown>).messages_failed  as number | null,
    error_message:   ((r as Record<string, unknown>).error_details as { message?: string } | null)?.message ?? null,
    created_at:      (r as Record<string, unknown>).created_at       as string,
  }));

  return NextResponse.json({
    pipeline: {
      total_24h:     total24h    ?? 0,
      processed_24h: processed24h ?? 0,
      total_1h:      total1h     ?? 0,
      pending_ai:    pending     ?? 0,
    },
    breaking_24h: breakingRows ?? [],
    log,
    ts: new Date().toISOString(),
  });
}
