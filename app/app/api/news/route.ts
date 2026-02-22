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

    // T3: clamp limit i offset — zapobiega nadużyciom
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "25"), 1), 100);
    const offset = Math.min(Math.max(Number(searchParams.get("offset") ?? "0"), 0), 10000);

    const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // T4: explicit columns zamiast SELECT *
    let query = supabase
      .from("news")
      .select("id, ticker, title, url, source, published_at, created_at")
      .order("published_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (tickers.length > 0) {
      query = query.in("ticker", tickers);
    }

    const { data, error } = await query;

    if (error) {
      // T5: nie ujawniaj szczegółów błędu DB
      return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
    }

    // T2: Cache-Control dla Vercel Edge CDN
    return NextResponse.json({ ok: true, data }, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Internal error" },
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

    // T1: x-api-key — fail fast przed jakimkolwiek wywołaniem DB
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey || apiKey !== process.env.INGEST_API_KEY) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const body = (await req.json()) as Partial<NewsInsert>;

    // 1) surowy ticker (bez toUpperCase) – łapiemy małe litery
    const rawTicker = String(body.ticker ?? "").trim();

    // 2) format: brak spacji i brak małych liter; dopuszczamy A-Z, cyfry, kropkę i myślnik
    //    (realne tickery: BRK.B, RDS-A itd.)
    const tickerFormat = /^[A-Z0-9.-]{1,15}$/;
    if (!tickerFormat.test(rawTicker)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid ticker format (A-Z/0-9/./-, 1–15 chars; no lowercase; no spaces)",
        },
        { status: 400 }
      );
    }

    // 3) walidacja po bazie: ticker musi istnieć w tabeli `tickers`
    const { data: tData, error: tErr } = await supabase
      .from("tickers")
      .select("ticker")
      .eq("ticker", rawTicker)
      .maybeSingle();

    if (tErr) {
      // T5: nie ujawniaj szczegółów błędu DB
      return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
    }

    if (!tData?.ticker) {
      return NextResponse.json(
        { ok: false, error: `Unknown ticker: ${rawTicker}` },
        { status: 400 }
      );
    }

    const payload: NewsInsert = {
      ticker: rawTicker,
      title: String(body.title ?? "").trim(),
      source: body.source ?? null,
      url: body.url ? String(body.url).trim() : null,
      published_at: body.published_at ? String(body.published_at).trim() : null,
      impact_score: body.impact_score ?? null,
      category: body.category ?? null,
    };

    if (!payload.title) {
      return NextResponse.json({ ok: false, error: "Missing required field: title" }, { status: 400 });
    }

    // T0-D: upsert po dedupe_key (DB-level constraint, obsługuje url=null)
    const { data, error } = await supabase
      .from("news")
      .upsert(payload, { onConflict: "dedupe_key" })
      .select("id, ticker, title, url, source, published_at, created_at");

    if (error) {
      // T5: nie ujawniaj szczegółów błędu DB
      return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
