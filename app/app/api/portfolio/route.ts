import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

export async function GET() {
  const db = supabase();

  // Get open positions with current price + company name via lateral join (via RPC workaround)
  // We'll fetch positions then join manually for simplicity
  const { data: positions, error: posErr } = await db
    .from("portfolio_positions")
    .select("id, ticker, shares, avg_buy_price, currency, opened_at, notes, companies(name)")
    .is("closed_at", null)
    .order("created_at", { ascending: false });

  if (posErr) {
    return NextResponse.json({ error: posErr.message }, { status: 500 });
  }

  if (!positions || positions.length === 0) {
    return NextResponse.json([]);
  }

  // Fetch latest price for each ticker in parallel
  const tickers = [...new Set(positions.map(p => p.ticker))];
  const priceMap = new Map<string, number>();

  await Promise.all(tickers.map(async (ticker) => {
    const { data } = await db
      .from("price_history")
      .select("close")
      .eq("ticker", ticker)
      .order("date", { ascending: false })
      .limit(1)
      .single();
    if (data?.close != null) priceMap.set(ticker, Number(data.close));
  }));

  const result = positions.map(p => {
    const currentPrice    = priceMap.get(p.ticker) ?? null;
    const avgBuy          = Number(p.avg_buy_price);
    const shares          = Number(p.shares);
    const unrealizedPnl   = currentPrice != null ? (currentPrice - avgBuy) * shares : null;
    const pnlPct          = currentPrice != null && avgBuy > 0
      ? ((currentPrice - avgBuy) / avgBuy) * 100 : null;
    const marketValue     = currentPrice != null ? currentPrice * shares : null;

    return {
      id:              p.id,
      ticker:          p.ticker,
      company_name:    (p.companies as { name?: string } | null)?.name ?? null,
      shares,
      avg_buy_price:   avgBuy,
      current_price:   currentPrice,
      market_value:    marketValue != null ? parseFloat(marketValue.toFixed(2)) : null,
      unrealized_pnl:  unrealizedPnl != null ? parseFloat(unrealizedPnl.toFixed(2)) : null,
      pnl_pct:         pnlPct != null ? parseFloat(pnlPct.toFixed(2)) : null,
      currency:        p.currency,
      opened_at:       p.opened_at,
      notes:           p.notes,
    };
  });

  // Sort by unrealized_pnl desc (null last)
  result.sort((a, b) => {
    if (a.unrealized_pnl == null) return 1;
    if (b.unrealized_pnl == null) return -1;
    return b.unrealized_pnl - a.unrealized_pnl;
  });

  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const db = supabase();

  let body: { ticker?: string; shares?: number; avg_buy_price?: number; notes?: string; currency?: string };
  try { body = await request.json(); } catch { body = {}; }

  const ticker        = body.ticker?.toUpperCase().trim();
  const shares        = Number(body.shares);
  const avgBuyPrice   = Number(body.avg_buy_price);

  if (!ticker || !shares || shares <= 0 || !avgBuyPrice || avgBuyPrice <= 0) {
    return NextResponse.json({ error: "ticker, shares and avg_buy_price required" }, { status: 400 });
  }

  const { data, error } = await db
    .from("portfolio_positions")
    .insert({
      ticker,
      shares,
      avg_buy_price: avgBuyPrice,
      currency:      body.currency ?? "PLN",
      notes:         body.notes ?? null,
    })
    .select("id, ticker, shares, avg_buy_price")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(request: Request) {
  const db = supabase();

  let body: { id?: number };
  try { body = await request.json(); } catch { body = {}; }

  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await db
    .from("portfolio_positions")
    .update({ closed_at: new Date().toISOString() })
    .eq("id", body.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
