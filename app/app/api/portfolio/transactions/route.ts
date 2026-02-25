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
  const { data, error } = await supabase()
    .from("portfolio_transactions")
    .select("id, ticker, transaction_type, shares, price, commission, currency, executed_at, notes")
    .order("executed_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const db = supabase();

  let body: {
    ticker?: string;
    type?: string;
    shares?: number;
    price?: number;
    commission?: number;
    executed_at?: string;
    notes?: string;
    currency?: string;
  };
  try { body = await request.json(); } catch { body = {}; }

  const ticker      = body.ticker?.toUpperCase().trim();
  const type        = body.type?.toUpperCase();
  const shares      = Number(body.shares);
  const price       = Number(body.price);
  const commission  = Number(body.commission ?? 0);
  const executedAt  = body.executed_at ?? new Date().toISOString();

  if (!ticker || !type || !shares || shares <= 0 || !price || price <= 0) {
    return NextResponse.json({ error: "ticker, type, shares and price required" }, { status: 400 });
  }
  if (!["BUY", "SELL"].includes(type)) {
    return NextResponse.json({ error: "type must be BUY or SELL" }, { status: 400 });
  }

  const { data, error } = await db
    .from("portfolio_transactions")
    .insert({
      ticker,
      transaction_type: type,
      shares,
      price,
      commission,
      currency:    body.currency ?? "PLN",
      executed_at: executedAt,
      notes:       body.notes ?? null,
    })
    .select("id, ticker, transaction_type, shares, price")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
