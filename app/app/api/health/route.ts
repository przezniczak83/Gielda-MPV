import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

// Czas startu modułu — przybliżony uptime Lambda instance
const MODULE_START = Date.now();

// ─── GET /api/health ─────────────────────────────────────────────────────────

export async function GET() {
  const requestId = randomUUID();
  const t0        = Date.now();

  const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL    ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY   ?? "";
  const ingestKeySet   = !!(process.env.INGEST_API_KEY ?? "").trim();

  const envOk = !!(supabaseUrl && serviceRoleKey && ingestKeySet);

  // Sprawdź połączenie z DB
  let dbStatus: "ok" | "error" = "error";
  let dbLatencyMs = 0;

  if (supabaseUrl && serviceRoleKey) {
    const tDb = Date.now();
    try {
      const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
      const { error } = await supabase.from("news").select("id").limit(1);
      dbLatencyMs = Date.now() - tDb;
      dbStatus = error ? "error" : "ok";
    } catch {
      dbLatencyMs = Date.now() - tDb;
    }
  }

  const healthy    = dbStatus === "ok" && envOk;
  const httpStatus = healthy ? 200 : 503;

  const body = {
    status:          healthy ? "ok" : "degraded",
    db:              dbStatus,
    db_latency_ms:   dbLatencyMs,
    env:             envOk ? "ok" : "missing_vars",
    uptime_seconds:  Math.floor((Date.now() - MODULE_START) / 1000),
    version:         "0.1.0",
    timestamp:       new Date().toISOString(),
    request_id:      requestId,
  };

  const res = NextResponse.json(body, { status: httpStatus });
  res.headers.set("X-Request-Id",          requestId);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Cache-Control",          "no-store");

  console.log(JSON.stringify({
    requestId,
    method:  "GET",
    path:    "/api/health",
    status:  httpStatus,
    ms:      Date.now() - t0,
    db:      dbStatus,
  }));

  return res;
}
