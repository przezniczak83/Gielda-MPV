// GET /api/news
// Query params:
//   ?ticker=PKN        — filter by ticker (in tickers[] array)
//   ?source=bankier    — filter by source
//   ?impact_min=7      — minimum impact_score
//   ?category=earnings — filter by category
//   ?limit=50          — max results (default 50, max 100)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const revalidate = 60;

export async function GET(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { searchParams } = req.nextUrl;
  const ticker    = searchParams.get("ticker");
  const source    = searchParams.get("source");
  const impactMin = searchParams.get("impact_min");
  const category  = searchParams.get("category");
  const limit     = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);

  let query = supabase
    .from("news_items")
    .select("id, url, title, summary, source, published_at, tickers, sector, sentiment, impact_score, category, ai_summary")
    .eq("ai_processed", true)
    .order("published_at", { ascending: false })
    .limit(limit);

  if (ticker) {
    query = query.contains("tickers", [ticker.toUpperCase()]);
  }
  if (source) {
    query = query.eq("source", source);
  }
  if (impactMin) {
    query = query.gte("impact_score", parseInt(impactMin, 10));
  }
  if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    items: data ?? [],
    ts:    new Date().toISOString(),
  });
}
