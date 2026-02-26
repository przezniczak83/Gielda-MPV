// GET /api/news/sentiment
// Query params:
//   ?ticker=PKN   — required
//   ?days=30      — lookback window (default 30, max 90)
//
// Returns sentiment_daily rows for the ticker + aggregate stats.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const revalidate = 300;

export async function GET(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { searchParams } = req.nextUrl;
  const ticker  = searchParams.get("ticker")?.trim().toUpperCase();
  const daysRaw = parseInt(searchParams.get("days") ?? "30", 10);
  const days    = Math.min(isNaN(daysRaw) ? 30 : daysRaw, 90);

  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10); // YYYY-MM-DD

  const { data, error } = await supabase
    .from("sentiment_daily")
    .select(
      "date, avg_sentiment, min_sentiment, max_sentiment, message_count, " +
      "positive_count, negative_count, neutral_count, breaking_count, dominant_topic",
    )
    .eq("ticker", ticker)
    .gte("date", cutoff)
    .order("date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];

  // Aggregate stats over the window
  const sentiments = rows.flatMap(r =>
    r.avg_sentiment !== null ? [r.avg_sentiment as number] : [],
  );
  const avgSentiment =
    sentiments.length > 0
      ? Math.round((sentiments.reduce((s, v) => s + v, 0) / sentiments.length) * 1000) / 1000
      : null;

  const totalMessages  = rows.reduce((s, r) => s + (r.message_count  ?? 0), 0);
  const totalBreaking  = rows.reduce((s, r) => s + (r.breaking_count ?? 0), 0);
  const totalPositive  = rows.reduce((s, r) => s + (r.positive_count ?? 0), 0);
  const totalNegative  = rows.reduce((s, r) => s + (r.negative_count ?? 0), 0);

  return NextResponse.json({
    ticker,
    days,
    rows,
    stats: {
      avg_sentiment:   avgSentiment,
      total_messages:  totalMessages,
      total_breaking:  totalBreaking,
      positive_count:  totalPositive,
      negative_count:  totalNegative,
      neutral_count:   totalMessages - totalPositive - totalNegative,
    },
    ts: new Date().toISOString(),
  });
}
