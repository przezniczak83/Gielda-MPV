// GET /api/news/stats
// Returns pipeline statistics for the last 24h.
//   total_24h       — total news items
//   breaking_24h    — is_breaking items
//   avg_sentiment   — mean sentiment of processed items
//   top_tickers     — [{ticker, count}] top 5 by news volume
//   by_source       — {source: count}
//   by_category     — {category: count}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const revalidate = 120;

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("news_items")
    .select("source, tickers, sentiment, category, is_breaking, ai_processed")
    .gte("published_at", since24h);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = rows ?? [];

  // total + breaking
  const total_24h    = items.length;
  const breaking_24h = items.filter(r => r.is_breaking).length;

  // avg sentiment (only processed)
  const processed = items.filter(r => r.ai_processed && r.sentiment !== null);
  const avg_sentiment =
    processed.length > 0
      ? Math.round(
          (processed.reduce((s: number, r) => s + (r.sentiment as number), 0) / processed.length) * 1000,
        ) / 1000
      : null;

  // by_source
  const by_source: Record<string, number> = {};
  for (const r of items) {
    by_source[r.source] = (by_source[r.source] ?? 0) + 1;
  }

  // by_category (only processed, non-null category)
  const by_category: Record<string, number> = {};
  for (const r of items.filter(r => r.ai_processed && r.category)) {
    by_category[r.category!] = (by_category[r.category!] ?? 0) + 1;
  }

  // top_tickers — unnest tickers[]
  const tickerCount: Record<string, number> = {};
  for (const r of items) {
    for (const t of (r.tickers ?? [])) {
      tickerCount[t] = (tickerCount[t] ?? 0) + 1;
    }
  }
  const top_tickers = Object.entries(tickerCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([ticker, count]) => ({ ticker, count }));

  return NextResponse.json({
    total_24h,
    breaking_24h,
    avg_sentiment,
    top_tickers,
    by_source,
    by_category,
    ts: new Date().toISOString(),
  });
}
