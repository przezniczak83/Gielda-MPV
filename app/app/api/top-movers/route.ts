import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL    ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY   ?? "",
    { auth: { persistSession: false } },
  );

  // Get the latest date in price_history
  const { data: latestRow } = await supabase
    .from("price_history")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestRow) {
    return NextResponse.json({ gainers: [], losers: [] });
  }

  const latestDate = latestRow.date;

  // Get prices for latest date and 1 day before for GPW stocks
  const { data: prices } = await supabase
    .from("price_history")
    .select("ticker, date, close")
    .gte("date", new Date(new Date(latestDate).getTime() - 5 * 24 * 3600 * 1000)
      .toISOString().split("T")[0])
    .lte("date", latestDate)
    .order("date", { ascending: false })
    .limit(2000);

  if (!prices || prices.length === 0) {
    return NextResponse.json({ gainers: [], losers: [] });
  }

  // Get company names for GPW
  const { data: companies } = await supabase
    .from("companies")
    .select("ticker, name, market")
    .eq("market", "GPW");

  const nameMap: Record<string, string> = {};
  const gpwSet = new Set<string>();
  (companies ?? []).forEach((c) => {
    nameMap[c.ticker] = c.name;
    gpwSet.add(c.ticker);
  });

  // Group by ticker, keep 2 most recent dates
  const grouped: Record<string, { date: string; close: number }[]> = {};
  for (const row of prices) {
    if (!gpwSet.has(row.ticker)) continue;
    if (!grouped[row.ticker]) grouped[row.ticker] = [];
    if (grouped[row.ticker].length < 2) {
      grouped[row.ticker].push({ date: row.date, close: row.close });
    }
  }

  const movers = Object.entries(grouped)
    .filter(([, rows]) => rows.length === 2)
    .map(([ticker, rows]) => {
      const price     = rows[0].close;
      const prevClose = rows[1].close;
      const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
      return {
        ticker,
        name:      nameMap[ticker] ?? ticker,
        price:     price.toFixed(2),
        changePct: changePct.toFixed(2),
      };
    })
    .filter((m) => Math.abs(parseFloat(m.changePct)) > 0);

  const gainers = movers
    .filter((m) => parseFloat(m.changePct) > 0)
    .sort((a, b) => parseFloat(b.changePct) - parseFloat(a.changePct))
    .slice(0, 5);

  const losers = movers
    .filter((m) => parseFloat(m.changePct) < 0)
    .sort((a, b) => parseFloat(a.changePct) - parseFloat(b.changePct))
    .slice(0, 5);

  return NextResponse.json({ gainers, losers }, {
    headers: { "Cache-Control": "s-maxage=120, stale-while-revalidate=300" },
  });
}
