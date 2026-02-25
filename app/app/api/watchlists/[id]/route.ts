import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL    ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY   ?? "",
    { auth: { persistSession: false } },
  );
}

type Params = Promise<{ id: string }>;

export async function GET(_req: Request, { params }: { params: Params }) {
  const db = supabase();
  const { id } = await params;
  const wid = parseInt(id, 10);

  const [{ data: list, error: listErr }, { data: items, error: itemsErr }] = await Promise.all([
    db.from("watchlists").select("*").eq("id", wid).maybeSingle(),
    db.from("watchlist_items")
      .select(`
        ticker, notes, alert_price_above, alert_price_below, added_at,
        companies ( name, sector, market ),
        price_history ( close, date )
      `)
      .eq("watchlist_id", wid)
      .order("added_at", { ascending: false }),
  ]);

  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });
  if (!list)   return NextResponse.json({ error: "Not found" },      { status: 404 });
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });

  return NextResponse.json({ ...list, items: items ?? [] });
}

export async function POST(request: Request, { params }: { params: Params }) {
  const db = supabase();
  const { id } = await params;
  const wid = parseInt(id, 10);

  let body: { ticker?: string; notes?: string };
  try { body = await request.json(); } catch { body = {}; }

  const ticker = body.ticker?.toUpperCase()?.trim();
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

  const { data, error } = await db
    .from("watchlist_items")
    .upsert({ watchlist_id: wid, ticker, notes: body.notes ?? null },
             { onConflict: "watchlist_id,ticker" })
    .select("ticker, added_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Params }) {
  const db = supabase();
  const { id } = await params;
  const wid = parseInt(id, 10);

  let body: { ticker?: string };
  try { body = await request.json(); } catch { body = {}; }

  const ticker = body.ticker?.toUpperCase()?.trim();
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

  const { error } = await db
    .from("watchlist_items")
    .delete()
    .eq("watchlist_id", wid)
    .eq("ticker", ticker);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
