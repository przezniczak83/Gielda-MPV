import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

// GET /api/chat-history?ticker=PKN — returns last 20 messages for a ticker
export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker") ?? "";
  if (!ticker) return NextResponse.json([], { status: 400 });

  const db = supabase();
  const { data, error } = await db
    .from("chat_history")
    .select("id, role, content, created_at")
    .eq("ticker", ticker.toUpperCase())
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Return in chronological order
  return NextResponse.json((data ?? []).reverse(), {
    headers: { "Cache-Control": "no-store" },
  });
}

// POST /api/chat-history — save a message
export async function POST(req: NextRequest) {
  const { ticker, role, content } = await req.json() as {
    ticker:  string;
    role:    "user" | "assistant";
    content: string;
  };

  if (!ticker || !role || !content) {
    return NextResponse.json({ error: "ticker, role, content required" }, { status: 400 });
  }

  const db = supabase();
  const { error } = await db
    .from("chat_history")
    .insert({ ticker: ticker.toUpperCase(), role, content });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/chat-history?ticker=PKN — clear history for a ticker
export async function DELETE(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker") ?? "";
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

  const db = supabase();
  const { error } = await db
    .from("chat_history")
    .delete()
    .eq("ticker", ticker.toUpperCase());

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
