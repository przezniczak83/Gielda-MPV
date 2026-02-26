import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// Top GPW companies to display in ticker tape
const TOP_TICKERS = [
  "PKO","PKN","PZU","KGH","PEO","SPL","LPP","DNP","ALE","CDR",
  "JSW","PCO","PGE","ENA","ATT","CPS","MBK","BDX","KRU","XTB",
  "AMB","APR","BGS","NEU","TEN","ING","BNP","SAN","MRC","VRG",
];

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL    ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY   ?? "",
    { auth: { persistSession: false } },
  );

  // Get latest 2 rows per ticker to compute daily change
  const { data, error } = await supabase
    .from("price_history")
    .select("ticker, date, close")
    .in("ticker", TOP_TICKERS)
    .order("date", { ascending: false })
    .limit(TOP_TICKERS.length * 2);

  if (error) {
    return NextResponse.json([], { status: 500 });
  }

  // Get company names
  const { data: companies } = await supabase
    .from("companies")
    .select("ticker, name")
    .in("ticker", TOP_TICKERS);

  const nameMap: Record<string, string> = {};
  (companies ?? []).forEach((c) => { nameMap[c.ticker] = c.name; });

  // Group by ticker, pick latest 2 rows
  const grouped: Record<string, { date: string; close: number }[]> = {};
  (data ?? []).forEach((row) => {
    if (!grouped[row.ticker]) grouped[row.ticker] = [];
    if (grouped[row.ticker].length < 2) {
      grouped[row.ticker].push({ date: row.date, close: row.close });
    }
  });

  const result = Object.entries(grouped)
    .filter(([, rows]) => rows.length > 0)
    .map(([ticker, rows]) => {
      const price     = rows[0].close;
      const prevClose = rows[1]?.close ?? price;
      const change    = price - prevClose;
      const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
      return {
        ticker,
        name:      nameMap[ticker] ?? ticker,
        price:     price.toFixed(2),
        change:    change.toFixed(2),
        changePct: changePct.toFixed(2),
      };
    })
    // Keep original order
    .sort((a, b) => TOP_TICKERS.indexOf(a.ticker) - TOP_TICKERS.indexOf(b.ticker));

  return NextResponse.json(result, {
    headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=120" },
  });
}
