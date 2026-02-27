// GET /api/companies-list
// Returns all companies with enriched columns for the companies list page.
// Tries to select avg_sentiment_30d, news_count_30d, last_news_at if they exist.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const revalidate = 600; // ISR: 10 minutes

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase
    .from("companies")
    .select(`
      ticker, name, official_name, sector, market,
      last_price, change_1d, price_updated_at,
      health_score, rs_score, rs_trend,
      last_news_at, avg_sentiment_30d, news_count_30d
    `)
    .order("market")
    .order("ticker");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ companies: data ?? [] });
}
