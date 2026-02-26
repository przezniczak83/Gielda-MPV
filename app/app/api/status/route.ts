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
      .select("function_name, status, items_fetched, items_processed, items_failed, error_message, created_at")
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

  return NextResponse.json({
    pipeline: {
      total_24h:     total24h    ?? 0,
      processed_24h: processed24h ?? 0,
      total_1h:      total1h     ?? 0,
      pending_ai:    pending     ?? 0,
    },
    breaking_24h: breakingRows ?? [],
    log:          logRows      ?? [],
    ts:           new Date().toISOString(),
  });
}
