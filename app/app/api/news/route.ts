import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function isGitHubPagesBuild() {
  return process.env.GITHUB_PAGES === "true";
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
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

// ─── GET /api/news ────────────────────────────────────────────────────────────

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
    const limit  = Math.min(Math.max(Number(searchParams.get("limit")  ?? "25"), 1),   100);
    const offset = Math.min(Math.max(Number(searchParams.get("offset") ?? "0"),  0), 10000);

    const supabaseUrl    = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

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
      console.error("[GET /api/news] DB error:", error.code, error.message);
      return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data }, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (err) {
    console.error("[GET /api/news] unhandled exception:", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

// ─── POST /api/news ───────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    if (isGitHubPagesBuild()) {
      return NextResponse.json(
        { ok: false, error: "API disabled on GitHub Pages (static export)." },
        { status: 501 }
      );
    }

    // ── AUTH: fail-closed, dwa osobne kroki ──────────────────────────────────
    // Krok 1: env key musi być skonfigurowany — jeśli nie, odrzuć wszystkie żądania
    const envKey = (process.env.INGEST_API_KEY ?? "").trim();
    if (!envKey) {
      console.error("[POST /api/news] INGEST_API_KEY not set — all POST requests rejected");
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    // Krok 2: nagłówek musi być obecny i dokładnie pasować (po trim)
    const headerKey = (req.headers.get("x-api-key") ?? "").trim();
    if (!headerKey || headerKey !== envKey) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    // ─────────────────────────────────────────────────────────────────────────

    const supabaseUrl    = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const body = (await req.json()) as Partial<NewsInsert>;

    // Walidacja tickera — format
    const rawTicker = String(body.ticker ?? "").trim();
    const tickerFormat = /^[A-Z0-9.-]{1,15}$/;
    if (!tickerFormat.test(rawTicker)) {
      return NextResponse.json(
        { ok: false, error: "Invalid ticker format (A-Z/0-9/./-, 1–15 chars; no lowercase; no spaces)" },
        { status: 400 }
      );
    }

    // Walidacja tickera — istnienie w DB
    const { data: tData, error: tErr } = await supabase
      .from("tickers")
      .select("ticker")
      .eq("ticker", rawTicker)
      .maybeSingle();

    if (tErr) {
      console.error("[POST /api/news] ticker lookup error:", tErr.code, tErr.message);
      return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
    }

    if (!tData?.ticker) {
      return NextResponse.json(
        { ok: false, error: `Unknown ticker: ${rawTicker}` },
        { status: 400 }
      );
    }

    const payload: NewsInsert = {
      ticker:       rawTicker,
      title:        String(body.title ?? "").trim(),
      source:       body.source       ?? null,
      url:          body.url          ? String(body.url).trim() : null,
      published_at: body.published_at ? String(body.published_at).trim() : null,
      impact_score: body.impact_score ?? null,
      category:     body.category     ?? null,
    };

    if (!payload.title) {
      return NextResponse.json(
        { ok: false, error: "Missing required field: title" },
        { status: 400 }
      );
    }

    // Upsert idempotentny po dedupe_key (kolumna GENERATED ALWAYS AS w DB).
    // Duplikat (23505 unique_violation) traktujemy jako sukces — żądanie jest idempotentne.
    const { data, error } = await supabase
      .from("news")
      .upsert(payload, { onConflict: "dedupe_key" })
      .select("id, ticker, title, url, source, published_at, created_at");

    if (error) {
      if (error.code === "23505") {
        // Duplikat — operacja idempotentna, zwróć sukces
        return NextResponse.json({ ok: true, data: [], duplicate: true });
      }
      // Loguj pełen kontekst błędu server-side (widoczne w Vercel Function Logs)
      console.error(
        "[POST /api/news] upsert error — code:", error.code,
        "| message:", error.message,
        "| details:", error.details,
        "| hint:", error.hint
      );
      return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[POST /api/news] unhandled exception:", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
