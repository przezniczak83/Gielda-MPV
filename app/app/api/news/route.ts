import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

// ─── Security headers (dołączane do każdej odpowiedzi) ───────────────────────

const SEC: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy":        "no-referrer",
  "X-Frame-Options":        "DENY",
};

function respond(body: unknown, init: ResponseInit = {}, requestId?: string): NextResponse {
  const res = NextResponse.json(body, init);
  for (const [k, v] of Object.entries(SEC)) res.headers.set(k, v);
  if (requestId) res.headers.set("X-Request-Id", requestId);
  return res;
}

// ─── In-memory rate limiter (30 POST / min / IP) ─────────────────────────────

const RL_MAX    = 30;
const RL_WIN_MS = 60_000;
const rlMap     = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();

  // Usuń wygasłe wpisy gdy mapa jest duża
  if (rlMap.size > 5_000) {
    for (const [k, v] of rlMap) if (now > v.resetAt) rlMap.delete(k);
  }

  const entry = rlMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rlMap.set(ip, { count: 1, resetAt: now + RL_WIN_MS });
    return true;
  }
  if (entry.count >= RL_MAX) return false;
  entry.count++;
  return true;
}

// ─── Structured logger ────────────────────────────────────────────────────────

function logReq(entry: {
  requestId: string;
  method:    string;
  path:      string;
  ip:        string;
  ua:        string;
  status:    number;
  ms:        number;
  error?:    string;
}) {
  // Nigdy nie logujemy klucza API
  console.log(JSON.stringify(entry));
}

// ─── Walidacja POST ───────────────────────────────────────────────────────────

const ALLOWED_FIELDS = new Set([
  "ticker", "title", "url", "source",
  "published_at", "impact_score", "category",
]);

type ValidationError = { field: string; message: string };

function validatePost(raw: unknown): ValidationError | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { field: "body", message: "Request body must be a JSON object" };
  }
  const b = raw as Record<string, unknown>;

  // Odrzuć nieznane pola
  for (const key of Object.keys(b)) {
    if (!ALLOWED_FIELDS.has(key)) {
      return { field: key, message: `Unknown field: ${key}` };
    }
  }

  // ticker: wymagany, A-Z, 1-10 znaków
  const ticker = String(b.ticker ?? "").trim();
  if (!ticker)                       return { field: "ticker", message: "ticker is required" };
  if (!/^[A-Z]{1,10}$/.test(ticker)) return { field: "ticker", message: "ticker must be 1–10 uppercase letters (A–Z)" };

  // title: wymagany, 5-300 znaków
  const title = String(b.title ?? "").trim();
  if (!title)              return { field: "title", message: "title is required" };
  if (title.length < 5)    return { field: "title", message: "title must be at least 5 characters" };
  if (title.length > 300)  return { field: "title", message: "title must be at most 300 characters" };

  // url: opcjonalny, ale jeśli podany musi być http/https
  if (b.url !== undefined && b.url !== null && b.url !== "") {
    try {
      const u = new URL(String(b.url));
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        return { field: "url", message: "url must use http or https" };
      }
    } catch {
      return { field: "url", message: "url must be a valid URL" };
    }
  }

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function isGitHubPagesBuild() {
  return process.env.GITHUB_PAGES === "true";
}

// ─── Types ────────────────────────────────────────────────────────────────────

type NewsInsert = {
  ticker:       string;
  title:        string;
  source?:      string | null;
  url?:         string | null;
  published_at?: string | null;
  impact_score?: number | null;
  category?:    string | null;
};

// ─── GET /api/news ────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const requestId = randomUUID();
  const t0        = Date.now();
  const ip        = getIp(req);
  const ua        = req.headers.get("user-agent") ?? "";
  const url       = new URL(req.url);
  const path      = url.pathname;

  try {
    if (isGitHubPagesBuild()) {
      return respond({ ok: false, error: "API disabled on GitHub Pages." }, { status: 501 }, requestId);
    }

    const { searchParams } = url;
    const tickers = searchParams.getAll("ticker");

    // limit max 50 (poprzednio 100)
    const limit  = Math.min(Math.max(Number(searchParams.get("limit")  ?? "25"), 1),    50);
    const offset = Math.min(Math.max(Number(searchParams.get("offset") ?? "0"),  0), 10_000);

    // ?since=ISO_DATE — opcjonalny filtr created_at >= since
    let since: string | null = null;
    const sinceRaw = searchParams.get("since");
    if (sinceRaw) {
      const d = new Date(sinceRaw);
      if (isNaN(d.getTime())) {
        return respond(
          { ok: false, error: "Validation error", field: "since", message: "since must be a valid ISO 8601 date" },
          { status: 400 },
          requestId
        );
      }
      since = d.toISOString();
    }

    const supabaseUrl    = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    let query = supabase
      .from("news")
      .select("id, ticker, title, url, source, published_at, created_at")
      .order("published_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (tickers.length > 0) query = query.in("ticker", tickers);
    if (since)              query = query.gte("created_at", since);

    const { data, error } = await query;

    if (error) {
      console.error("[GET /api/news] DB error:", error.code, error.message);
      logReq({ requestId, method: "GET", path, ip, ua, status: 500, ms: Date.now() - t0, error: error.code });
      return respond({ ok: false, error: "Internal error" }, { status: 500 }, requestId);
    }

    logReq({ requestId, method: "GET", path, ip, ua, status: 200, ms: Date.now() - t0 });
    return respond({ ok: true, data }, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    }, requestId);
  } catch (err) {
    console.error("[GET /api/news] exception:", err);
    logReq({ requestId, method: "GET", path, ip, ua, status: 500, ms: Date.now() - t0, error: "exception" });
    return respond({ ok: false, error: "Internal error" }, { status: 500 }, requestId);
  }
}

// ─── POST /api/news ───────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const requestId = randomUUID();
  const t0        = Date.now();
  const ip        = getIp(req);
  const ua        = req.headers.get("user-agent") ?? "";
  const path      = new URL(req.url).pathname;

  try {
    if (isGitHubPagesBuild()) {
      return respond({ ok: false, error: "API disabled on GitHub Pages." }, { status: 501 }, requestId);
    }

    // ── Auth: fail-closed (dwa kroki) ────────────────────────────────────────
    const envKey = (process.env.INGEST_API_KEY ?? "").trim();
    if (!envKey) {
      console.error("[POST /api/news] INGEST_API_KEY not configured — rejecting all requests");
      return respond({ ok: false, error: "Unauthorized" }, { status: 401 }, requestId);
    }
    const headerKey = (req.headers.get("x-api-key") ?? "").trim();
    if (!headerKey || headerKey !== envKey) {
      logReq({ requestId, method: "POST", path, ip, ua, status: 401, ms: Date.now() - t0, error: "auth" });
      return respond({ ok: false, error: "Unauthorized" }, { status: 401 }, requestId);
    }

    // ── Rate limit ────────────────────────────────────────────────────────────
    if (!checkRateLimit(ip)) {
      logReq({ requestId, method: "POST", path, ip, ua, status: 429, ms: Date.now() - t0, error: "rate_limit" });
      return respond({ ok: false, error: "Too many requests" }, { status: 429 }, requestId);
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return respond(
        { ok: false, error: "Validation error", field: "body", message: "Invalid JSON" },
        { status: 400 },
        requestId
      );
    }

    // ── Validate ──────────────────────────────────────────────────────────────
    const ve = validatePost(rawBody);
    if (ve) {
      logReq({ requestId, method: "POST", path, ip, ua, status: 400, ms: Date.now() - t0, error: `validation:${ve.field}` });
      return respond(
        { ok: false, error: "Validation error", field: ve.field, message: ve.message },
        { status: 400 },
        requestId
      );
    }

    const b          = rawBody as Record<string, unknown>;
    const rawTicker  = String(b.ticker).trim();

    const supabaseUrl    = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    // ── Ticker lookup ─────────────────────────────────────────────────────────
    const { data: tData, error: tErr } = await supabase
      .from("tickers")
      .select("ticker")
      .eq("ticker", rawTicker)
      .maybeSingle();

    if (tErr) {
      console.error("[POST /api/news] ticker lookup error:", tErr.code, tErr.message);
      logReq({ requestId, method: "POST", path, ip, ua, status: 500, ms: Date.now() - t0, error: "ticker_lookup" });
      return respond({ ok: false, error: "Internal error" }, { status: 500 }, requestId);
    }

    if (!tData?.ticker) {
      logReq({ requestId, method: "POST", path, ip, ua, status: 400, ms: Date.now() - t0, error: "unknown_ticker" });
      return respond(
        { ok: false, error: "Validation error", field: "ticker", message: `Unknown ticker: ${rawTicker}` },
        { status: 400 },
        requestId
      );
    }

    // ── Build payload ─────────────────────────────────────────────────────────
    const payload: NewsInsert = {
      ticker:       rawTicker,
      title:        String(b.title ?? "").trim(),
      source:       b.source ? String(b.source) : "manual",      // domyślnie "manual"
      url:          b.url    ? String(b.url).trim() : null,
      published_at: b.published_at ? String(b.published_at).trim() : null,
      impact_score: typeof b.impact_score === "number" ? b.impact_score : null,
      category:     b.category ? String(b.category) : null,
    };

    // ── Upsert idempotentny po dedupe_key ─────────────────────────────────────
    const { data, error } = await supabase
      .from("news")
      .upsert(payload, { onConflict: "dedupe_key" })
      .select("id, ticker, title, url, source, published_at, created_at");

    if (error) {
      if (error.code === "23505") {
        // Duplikat — operacja idempotentna → 200
        logReq({ requestId, method: "POST", path, ip, ua, status: 200, ms: Date.now() - t0 });
        return respond({ ok: true, data: [], duplicate: true }, {}, requestId);
      }
      console.error("[POST /api/news] upsert error:", error.code, "|", error.message, "|", error.details, "|", error.hint);
      logReq({ requestId, method: "POST", path, ip, ua, status: 500, ms: Date.now() - t0, error: `db:${error.code}` });
      return respond({ ok: false, error: "Internal error" }, { status: 500 }, requestId);
    }

    logReq({ requestId, method: "POST", path, ip, ua, status: 200, ms: Date.now() - t0 });
    return respond({ ok: true, data }, {}, requestId);
  } catch (err) {
    console.error("[POST /api/news] exception:", err);
    logReq({ requestId, method: "POST", path, ip, ua, status: 500, ms: Date.now() - t0, error: "exception" });
    return respond({ ok: false, error: "Internal error" }, { status: 500 }, requestId);
  }
}
