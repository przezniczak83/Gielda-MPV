// app/api/paper-trading/route.ts
// Paper trading API — virtual portfolio management.
//
// GET  /api/paper-trading                          — list portfolios
// GET  /api/paper-trading?portfolio_id=1           — portfolio detail + positions + recent trades
// POST /api/paper-trading { action: "create_portfolio", name, description?, initial_cash? }
// POST /api/paper-trading { action: "trade", portfolio_id, ticker, direction, quantity, price, note? }
// DELETE /api/paper-trading { portfolio_id }        — delete portfolio

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

// ─── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const db = supabase();
  const portfolioId = req.nextUrl.searchParams.get("portfolio_id");

  if (!portfolioId) {
    // List all portfolios
    const { data, error } = await db
      .from("paper_portfolios")
      .select("id, name, description, initial_cash, cash_balance, created_at")
      .order("created_at", { ascending: true });

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json(data ?? []);
  }

  // Portfolio detail: positions + recent trades
  const [portfolioRes, positionsRes, tradesRes] = await Promise.all([
    db.from("paper_portfolios")
      .select("id, name, description, initial_cash, cash_balance, created_at, updated_at")
      .eq("id", portfolioId)
      .maybeSingle(),
    db.from("paper_positions")
      .select("ticker, quantity, avg_cost, total_invested, updated_at")
      .eq("portfolio_id", portfolioId)
      .gt("quantity", 0)
      .order("total_invested", { ascending: false }),
    db.from("paper_trades")
      .select("id, ticker, direction, quantity, price, total_value, note, traded_at")
      .eq("portfolio_id", portfolioId)
      .order("traded_at", { ascending: false })
      .limit(50),
  ]);

  if (portfolioRes.error) return Response.json({ error: portfolioRes.error.message }, { status: 500 });
  if (!portfolioRes.data)  return Response.json({ error: "Portfolio not found" }, { status: 404 });

  // Fetch latest prices for held tickers
  const tickers = (positionsRes.data ?? []).map((p: { ticker: string }) => p.ticker);
  let latestPrices: Record<string, number> = {};

  if (tickers.length > 0) {
    const { data: prices } = await db
      .from("price_history")
      .select("ticker, close, date")
      .in("ticker", tickers)
      .order("date", { ascending: false });

    // Take the latest price per ticker
    const seen = new Set<string>();
    for (const p of prices ?? []) {
      const row = p as { ticker: string; close: number; date: string };
      if (!seen.has(row.ticker)) {
        latestPrices[row.ticker] = row.close;
        seen.add(row.ticker);
      }
    }
  }

  // Compute PnL per position
  const positions = (positionsRes.data ?? []).map((pos: {
    ticker: string; quantity: number; avg_cost: number | null; total_invested: number | null; updated_at: string;
  }) => {
    const current = latestPrices[pos.ticker] ?? null;
    const marketValue = current !== null ? current * pos.quantity : null;
    const pnl = marketValue !== null && pos.total_invested !== null
      ? marketValue - pos.total_invested
      : null;
    const pnlPct = pnl !== null && pos.total_invested !== null && pos.total_invested > 0
      ? (pnl / pos.total_invested) * 100
      : null;

    return { ...pos, current_price: current, market_value: marketValue, pnl, pnl_pct: pnlPct };
  });

  return Response.json({
    portfolio: portfolioRes.data,
    positions,
    trades: tradesRes.data ?? [],
    latest_prices: latestPrices,
  });
}

// ─── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    action:        "create_portfolio" | "trade";
    // create_portfolio
    name?:         string;
    description?:  string;
    initial_cash?: number;
    // trade
    portfolio_id?: number;
    ticker?:       string;
    direction?:    "BUY" | "SELL";
    quantity?:     number;
    price?:        number;
    note?:         string;
  };

  const db = supabase();

  if (body.action === "create_portfolio") {
    if (!body.name?.trim()) {
      return Response.json({ error: "name required" }, { status: 400 });
    }
    const cash = body.initial_cash ?? 100000;
    const { data, error } = await db
      .from("paper_portfolios")
      .insert({ name: body.name.trim(), description: body.description ?? null, initial_cash: cash, cash_balance: cash })
      .select()
      .single();

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true, portfolio: data });
  }

  if (body.action === "trade") {
    const { portfolio_id, ticker, direction, quantity, price, note } = body;
    if (!portfolio_id || !ticker || !direction || !quantity || !price) {
      return Response.json({ error: "portfolio_id, ticker, direction, quantity, price required" }, { status: 400 });
    }

    const upperTicker = ticker.toUpperCase().trim();
    const totalValue  = quantity * price;

    // Fetch portfolio
    const { data: portfolio, error: pfErr } = await db
      .from("paper_portfolios")
      .select("id, cash_balance")
      .eq("id", portfolio_id)
      .maybeSingle();

    if (pfErr || !portfolio) return Response.json({ error: "Portfolio not found" }, { status: 404 });

    // Fetch current position
    const { data: posRow } = await db
      .from("paper_positions")
      .select("quantity, avg_cost, total_invested")
      .eq("portfolio_id", portfolio_id)
      .eq("ticker", upperTicker)
      .maybeSingle();

    const currentQty       = posRow?.quantity       ?? 0;
    const currentAvgCost   = posRow?.avg_cost       ?? 0;
    const currentInvested  = posRow?.total_invested ?? 0;

    if (direction === "BUY") {
      if ((portfolio.cash_balance as number) < totalValue) {
        return Response.json({ error: "Niewystarczające środki" }, { status: 400 });
      }

      // New avg cost: (oldQty * oldAvgCost + newQty * newPrice) / (oldQty + newQty)
      const newQty       = currentQty + quantity;
      const newInvested  = Number(currentInvested) + totalValue;
      const newAvgCost   = newInvested / newQty;
      const newCash      = Number(portfolio.cash_balance) - totalValue;

      // Record trade
      await db.from("paper_trades").insert({
        portfolio_id, ticker: upperTicker, direction, quantity, price, total_value: totalValue, note: note ?? null,
      });

      // Upsert position
      await db.from("paper_positions").upsert(
        { portfolio_id, ticker: upperTicker, quantity: newQty, avg_cost: newAvgCost, total_invested: newInvested, updated_at: new Date().toISOString() },
        { onConflict: "portfolio_id,ticker" },
      );

      // Update cash
      await db.from("paper_portfolios").update({ cash_balance: newCash, updated_at: new Date().toISOString() }).eq("id", portfolio_id);

      return Response.json({ ok: true, new_cash: newCash, new_quantity: newQty, avg_cost: newAvgCost });
    }

    if (direction === "SELL") {
      if (currentQty < quantity) {
        return Response.json({ error: `Za mało akcji (masz ${currentQty}, sprzedajesz ${quantity})` }, { status: 400 });
      }

      const newQty       = currentQty - quantity;
      const soldInvested = (Number(currentAvgCost)) * quantity;
      const newInvested  = Number(currentInvested) - soldInvested;
      const newCash      = Number(portfolio.cash_balance) + totalValue;

      await db.from("paper_trades").insert({
        portfolio_id, ticker: upperTicker, direction, quantity, price, total_value: totalValue, note: note ?? null,
      });

      if (newQty === 0) {
        await db.from("paper_positions").delete().eq("portfolio_id", portfolio_id).eq("ticker", upperTicker);
      } else {
        await db.from("paper_positions").update(
          { quantity: newQty, total_invested: newInvested, updated_at: new Date().toISOString() },
        ).eq("portfolio_id", portfolio_id).eq("ticker", upperTicker);
      }

      await db.from("paper_portfolios").update({ cash_balance: newCash, updated_at: new Date().toISOString() }).eq("id", portfolio_id);

      return Response.json({ ok: true, new_cash: newCash, new_quantity: newQty });
    }

    return Response.json({ error: "direction must be BUY or SELL" }, { status: 400 });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}

// ─── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const { portfolio_id } = await req.json() as { portfolio_id: number };
  if (!portfolio_id) return Response.json({ error: "portfolio_id required" }, { status: 400 });

  const { error } = await supabase()
    .from("paper_portfolios")
    .delete()
    .eq("id", portfolio_id);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
