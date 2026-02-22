import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSnapshot } from "@/lib/metrics";

export const runtime = "nodejs";

// ─── GET /api/metrics ─────────────────────────────────────────────────────────
// Chroniony tym samym x-api-key co POST /api/news.
// Zwraca in-memory liczniki bieżącej Lambda instance.

export async function GET(req: Request) {
  const requestId = randomUUID();

  // ── Auth ────────────────────────────────────────────────────────────────────
  const envKey    = (process.env.INGEST_API_KEY ?? "").trim();
  const headerKey = (req.headers.get("x-api-key") ?? "").trim();

  if (!envKey || !headerKey || headerKey !== envKey) {
    const res = NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
    res.headers.set("X-Request-Id", requestId);
    return res;
  }

  // ── Snapshot ────────────────────────────────────────────────────────────────
  const snapshot = getSnapshot();

  const res = NextResponse.json({ ok: true, data: snapshot }, { status: 200 });
  res.headers.set("X-Request-Id",          requestId);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Cache-Control",          "no-store");

  return res;
}
