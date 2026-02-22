// app/api/news/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/admin";

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("news")
    .select("*")
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  return NextResponse.json({ data, error });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Minimalny walidator (żeby nie wrzucać śmieci)
    const ticker = String(body?.ticker ?? "").trim();
    const title = String(body?.title ?? "").trim();

    if (!ticker || !title) {
      return NextResponse.json(
        { data: null, error: "ticker i title są wymagane" },
        { status: 400 }
      );
    }

    const payload = {
      ticker,
      title,
      source: body?.source ? String(body.source).trim() : null,
      url: body?.url ? String(body.url).trim() : null,
      published_at: body?.published_at ? String(body.published_at) : null,
      impact_score:
        body?.impact_score === null || body?.impact_score === undefined
          ? null
          : Number(body.impact_score),
      category: body?.category ? String(body.category).trim() : null,
    };

    const { data, error } = await supabaseAdmin
      .from("news")
      .insert(payload)
      .select("*")
      .single();

    return NextResponse.json({ data, error });
  } catch (e: any) {
    return NextResponse.json(
      { data: null, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}