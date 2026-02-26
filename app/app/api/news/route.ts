// GET /api/news
// Query params:
//   ?ticker=PKN         — single ticker OR ?ticker=PKN,PZU (comma-separated)
//   ?source=bankier     — filter by source
//   ?impact_min=7       — minimum impact_score
//   ?category=earnings  — filter by category
//   ?breaking=true      — only is_breaking items
//   ?days=7             — last N days only
//   ?has_facts=true     — only items with key_facts
//   ?limit=50           — max results (default 50, max 100)
//   ?offset=0           — pagination offset

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
  const tickerParam = searchParams.get("ticker");
  const source      = searchParams.get("source");
  const impactMin   = searchParams.get("impact_min");
  const category    = searchParams.get("category");
  const breaking    = searchParams.get("breaking");
  const daysParam   = searchParams.get("days");
  const hasFacts    = searchParams.get("has_facts");
  const limit       = Math.min(parseInt(searchParams.get("limit")  ?? "50",  10), 100);
  const offset      = Math.max(parseInt(searchParams.get("offset") ?? "0",   10), 0);

  let query = supabase
    .from("news_items")
    .select("id, url, title, summary, source, published_at, tickers, sector, sentiment, impact_score, category, ai_summary, key_facts, topics, is_breaking, impact_assessment")
    .eq("ai_processed", true)
    .order("published_at", { ascending: false })
    .range(offset, offset + limit - 1);

  // Ticker filter — support comma-separated list
  if (tickerParam) {
    const tickers = tickerParam.split(",").map(t => t.trim().toUpperCase()).filter(Boolean);
    if (tickers.length === 1) {
      query = query.contains("tickers", [tickers[0]]);
    } else if (tickers.length > 1) {
      // filter: tickers && ANY of the provided tickers — use overlaps
      query = query.overlaps("tickers", tickers);
    }
  }

  if (source)    query = query.eq("source", source);
  if (impactMin) query = query.gte("impact_score", parseInt(impactMin, 10));
  if (category)  query = query.eq("category", category);
  if (breaking === "true") query = query.eq("is_breaking", true);
  if (hasFacts === "true") query = query.neq("key_facts", "[]");

  if (daysParam) {
    const days    = Math.min(parseInt(daysParam, 10) || 7, 90);
    const cutoff  = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    query = query.gte("published_at", cutoff);
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
