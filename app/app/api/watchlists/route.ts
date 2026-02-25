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

export async function GET() {
  const db = supabase();

  // Get all watchlists with item counts
  const { data: lists, error } = await db
    .from("watchlists")
    .select("id, name, description, is_smart, created_at, watchlist_items(count)")
    .order("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const result = (lists ?? []).map((l: {
    id: number; name: string; description: string | null;
    is_smart: boolean; created_at: string;
    watchlist_items: { count: number }[];
  }) => ({
    id:          l.id,
    name:        l.name,
    description: l.description,
    is_smart:    l.is_smart,
    created_at:  l.created_at,
    item_count:  l.watchlist_items?.[0]?.count ?? 0,
  }));

  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const db = supabase();
  let body: { name?: string; description?: string };
  try { body = await request.json(); } catch { body = {}; }

  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const { data, error } = await db
    .from("watchlists")
    .insert({ name, description: body.description ?? null })
    .select("id, name, description, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
