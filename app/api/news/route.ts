import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

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
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
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

    // 1) WALIDUJ surowy ticker (bez uppercasingu)
    const rawTicker = String(body.ticker ?? "").trim();
    const tickerStrictRegex = /^[A-Z]{1,6}$/;
    if (!tickerStrictRegex.test(rawTicker)) {
      return NextResponse.json(
        { ok: false, error: "Invalid ticker format (must be A-Z only, 1–6 chars, no lowercase)." },
        { status: 400 }
      );
    }

    // 2) Buduj payload dopiero po walidacji
    const payload: NewsInsert = {
      ticker: rawTicker, // już jest A-Z
      title: String(body.title ?? "").trim(),
      source: body.source ?? null,
      url: body.url ? String(body.url).trim() : null,
      published_at: body.published_at ? String(body.published_at).trim() : null,
      impact_score: body.impact_score ?? null,
      category: body.category ?? null,
    };

    if (!payload.title) {
      return NextResponse.json(
        { ok: false, error: "Missing required field: title" },
        { status: 400 }
      );
    }

    // UPSERT po kolumnie url (onConflict = nazwa kolumny, nie constraint!)
    const { data, error } = await supabase
      .from("news")
      .upsert(payload, { onConflict: "url" })
      .select("*");

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Server error" }, { status: 500 });
  }
}