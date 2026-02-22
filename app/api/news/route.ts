import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// Guard: GitHub Pages = static export, brak backendu i brak sekretów.
function isGitHubPagesBuild() {
  return process.env.GITHUB_PAGES === "true";
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

type NewsInsert = {
  ticker: string;
  title: string;
  source?: string | null;
  url?: string | null;
  published_at?: string | null;
  impact_score?: number | null;
  category?: string | null;
};

export async function GET(req: Request) {
  try {
    if (isGitHubPagesBuild()) {
      return NextResponse.json(
        { ok: false, error: "API disabled on GitHub Pages (static export)." },
        { status: 501 }
      );
    }

    const { searchParams } = new URL(req.url);
    const tickers = searchParams.getAll("ticker");
    const limit = Number(searchParams.get("limit") ?? "25");
    const offset = Number(searchParams.get("offset") ?? "0");

    const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    let query = supabase
      .from("news")
      .select("*")
      .order("published_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (tickers.length > 0) {
      query = query.in("ticker", tickers);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    if (isGitHubPagesBuild()) {
      return NextResponse.json(
        { ok: false, error: "API disabled on GitHub Pages (static export)." },
        { status: 501 }
      );
    }

    const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const body = (await req.json()) as Partial<NewsInsert>;

    // Minimalna walidacja + normalizacja
    const payload: NewsInsert = {
      ticker: String(body.ticker ?? "").trim().toUpperCase(),
      title: String(body.title ?? "").trim(),
      source: body.source ?? null,
      url: body.url ? String(body.url).trim() : null,
      published_at: body.published_at ? String(body.published_at).trim() : null,
      impact_score: body.impact_score ?? null,
      category: body.category ?? null,
    };

    if (!payload.ticker || !payload.title) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields: ticker, title" },
        { status: 400 }
      );
    }

    // UPSERT po kolumnie "url"
    // Wymaga: UNIQUE constraint albo UNIQUE index na news(url)
    // (Postgres pozwala na wiele NULL w UNIQUE, więc url może być NULL)
    const { data, error } = await supabase
      .from("news")
      .upsert(payload, { onConflict: "url" })
      .select("*");

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}