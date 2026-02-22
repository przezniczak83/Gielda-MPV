// app/api/news/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/admin";

type NewsInsert = {
  ticker: string;
  title: string;
  source: string;
  url?: string | null;
  published_at?: string | null;
  impact_score?: number | null;
  category?: string | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ data: null, error: message }, { status });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const tickersRaw = searchParams.getAll("ticker"); // może być wiele ticker=...
    const tickers = tickersRaw
      .flatMap((t) => String(t).split(","))
      .map((t) => t.trim())
      .filter(Boolean);

    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || "25", 10) || 25, 1),
      200
    );
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);

    let q = supabaseAdmin
      .from("news")
      .select("*")
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (tickers.length > 0) {
      q = q.in("ticker", tickers);
    }

    const { data, error } = await q;

    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ data, error: null }, { status: 200 });
  } catch (e: any) {
    return jsonError(e?.message ?? "Unknown error", 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<NewsInsert>;

    const payload: NewsInsert = {
      ticker: String(body.ticker ?? "").trim(),
      title: String(body.title ?? "").trim(),
      source: String(body.source ?? "").trim(),
      url: body.url ? String(body.url).trim() : null,
      published_at: body.published_at ? String(body.published_at).trim() : null,
      impact_score:
        body.impact_score === undefined || body.impact_score === null
          ? null
          : Number(body.impact_score),
      category: body.category ? String(body.category).trim() : null,
    };

    if (!payload.ticker) return jsonError("Missing ticker", 400);
    if (!payload.title) return jsonError("Missing title", 400);
    if (!payload.source) return jsonError("Missing source", 400);

    const { data, error } = await supabaseAdmin
      .from("news")
      .insert(payload)
      .select("*")
      .single();

    // Jeżeli baza blokuje (unikalny indeks URL) -> czytelny 409
    if (error) {
      const msg = (error.message ?? "").toLowerCase();

      // 23505 = unique_violation (Postgres)
      if (msg.includes("duplicate") || msg.includes("unique") || msg.includes("23505")) {
        return jsonError("Duplikat URL (unikalny indeks bazy)", 409);
      }

      return jsonError(error.message ?? "Unknown error", 400);
    }

    return NextResponse.json({ data, error: null }, { status: 200 });
  } catch (e: any) {
    return jsonError(e?.message ?? "Unknown error", 500);
  }
}