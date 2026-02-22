// app/app/api/news/route.ts

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/admin";

// WYMAGANE dla output: "export" (GitHub Pages static export)
export const dynamic = "force-static";
export const revalidate = 60;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ data: null, error: message }, { status });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const tickers = searchParams.getAll("ticker").filter(Boolean);
    const limit = Math.min(Number(searchParams.get("limit") || 25), 200);
    const offset = Math.max(Number(searchParams.get("offset") || 0), 0);

    let q = supabaseAdmin
      .from("news")
      .select(
        "id,ticker,title,source,url,published_at,created_at,impact_score,category"
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (tickers.length > 0) {
      q = q.in("ticker", tickers);
    }

    const { data, error } = await q;

    if (error) return jsonError(error.message, 500);

    return NextResponse.json({
      data: data ?? [],
      error: null,
      meta: { limit, offset, returned: (data ?? []).length },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Unknown error", 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const ticker = String(body?.ticker || "").trim().toUpperCase();
    const title = String(body?.title || "").trim();
    const source = body?.source ? String(body.source).trim() : null;
    const url = body?.url ? String(body.url).trim() : null;
    const published_at = body?.published_at ? String(body.published_at).trim() : null;
    const impact_score =
      body?.impact_score === null || body?.impact_score === undefined || body?.impact_score === ""
        ? null
        : Number(body.impact_score);
    const category = body?.category ? String(body.category).trim() : null;

    if (!ticker) return jsonError("Missing ticker", 400);
    if (!title) return jsonError("Missing title", 400);

    if (impact_score !== null && Number.isNaN(impact_score)) {
      return jsonError("Invalid impact_score", 400);
    }

    const { data, error } = await supabaseAdmin
      .from("news")
      .insert([
        {
          ticker,
          title,
          source,
          url,
          published_at,
          impact_score,
          category,
        },
      ])
      .select(
        "id,ticker,title,source,url,published_at,created_at,impact_score,category"
      )
      .single();

    if (error) {
      // Unikalny indeks na url -> duplicate
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("duplicate") || msg.includes("unique")) {
        return jsonError("Duplikat URL (unikalny indeks bazy)", 409);
      }
      return jsonError(error.message, 500);
    }

    return NextResponse.json({ data, error: null }, { status: 201 });
  } catch (e: any) {
    return jsonError(e?.message || "Unknown error", 500);
  }
}