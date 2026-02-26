// app/api/correlations/route.ts
// GET /api/correlations?ticker=PKN
// Returns top correlations for a ticker from price_correlations table.
// If no cached data, triggers calc-correlations EF and returns empty.

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

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.toUpperCase().trim() ?? "";
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

  const db = supabase();

  const { data, error } = await db
    .from("price_correlations")
    .select("ticker_b, correlation, sample_size, computed_at")
    .eq("ticker_a", ticker)
    .order("correlation", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];

  // If no data, trigger async computation (fire-and-forget)
  if (rows.length === 0) {
    const efUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/calc-correlations`;
    fetch(efUrl, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ ticker }),
    }).catch(() => { /* fire-and-forget */ });
  }

  return NextResponse.json(rows, {
    headers: { "Cache-Control": "s-maxage=3600, stale-while-revalidate" },
  });
}
