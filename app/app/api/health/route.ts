import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const EDGE_FUNCTIONS = [
  "fetch-espi", "fetch-email", "fetch-prices",
  "process-raw", "send-alerts", "analyze-health",
  "detect-flags", "analyze-dividend", "analyze-earnings",
  "analyze-moat", "gen-forecast", "calc-multiples",
  "fetch-insider", "fetch-ownership", "fetch-sec",
  "ai-query", "extract-pdf", "process-dm-pdf",
  "analyze-impact", "calc-correlations", "weekly-report",
];

// Staleness thresholds
const ESPI_STALE_HOURS  = 6;   // ESPI data is stale if older than 6 hours
const PRICE_STALE_HOURS = 25;  // Price is stale if older than 25 hours (allow for market close)

function pipelineStatus(lastIso: string | null, thresholdHours: number): "ok" | "stale" | "error" {
  if (!lastIso) return "error";
  const ageHours = (Date.now() - new Date(lastIso).getTime()) / 3600_000;
  return ageHours < thresholdHours ? "ok" : "stale";
}

export async function GET() {
  const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL    ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY   ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Run all stat queries in parallel
  const [
    companiesRes,
    eventsRes,
    rawIngestRes,
    priceHistoryRes,
    forecastsRes,
    lastIngestRes,
    lastPriceRes,
    lastAlertRes,
    calendarRes,
    kpisRes,
  ] = await Promise.allSettled([
    supabase.from("companies").select("*",          { count: "exact", head: true }),
    supabase.from("company_events").select("*",     { count: "exact", head: true }),
    supabase.from("raw_ingest").select("*",         { count: "exact", head: true }),
    supabase.from("price_history").select("*",      { count: "exact", head: true }),
    supabase.from("analyst_forecasts").select("*",  { count: "exact", head: true }),
    supabase.from("company_events")
      .select("created_at").order("created_at", { ascending: false }).limit(1),
    supabase.from("price_history")
      .select("date").order("date", { ascending: false }).limit(1),
    supabase.from("company_events")
      .select("alerted_at").order("alerted_at", { ascending: false })
      .not("alerted_at", "is", null).limit(1),
    supabase.from("calendar_events").select("*",    { count: "exact", head: true }),
    supabase.from("company_kpis").select("*",       { count: "exact", head: true }),
  ]);

  function count(res: typeof companiesRes): number {
    return res.status === "fulfilled" ? (res.value.count ?? 0) : 0;
  }

  function row<T>(res: PromiseSettledResult<{ data: T[] | null }>): T | null {
    if (res.status !== "fulfilled") return null;
    return (res.value as { data: T[] | null }).data?.[0] ?? null;
  }

  const lastIngestRow   = row<{ created_at: string }>(lastIngestRes as PromiseSettledResult<{ data: { created_at: string }[] | null }>);
  const lastPriceRow    = row<{ date: string }>(lastPriceRes as PromiseSettledResult<{ data: { date: string }[] | null }>);
  const lastAlertRow    = row<{ alerted_at: string }>(lastAlertRes as PromiseSettledResult<{ data: { alerted_at: string }[] | null }>);

  const lastEspi  = lastIngestRow?.created_at ?? null;
  const lastPrice = lastPriceRow?.date ? `${lastPriceRow.date}T18:00:00Z` : null; // approximate time
  const lastAlert = lastAlertRow?.alerted_at ?? null;

  const dbOk = companiesRes.status === "fulfilled" && !("error" in (companiesRes.value ?? {}));

  return NextResponse.json({
    ok:      dbOk,
    ts:      new Date().toISOString(),
    version: "3.1",
    stats: {
      companies:          count(companiesRes),
      events:             count(eventsRes),
      raw_ingest:         count(rawIngestRes),
      price_history:      count(priceHistoryRes),
      analyst_forecasts:  count(forecastsRes),
      calendar_events:    count(calendarRes),
      company_kpis:       count(kpisRes),
    },
    pipeline: {
      last_espi_fetch:    lastEspi,
      last_price_update:  lastPriceRow?.date ?? null,
      last_telegram_alert:lastAlert,
      espi_status:        pipelineStatus(lastEspi,  ESPI_STALE_HOURS),
      price_status:       pipelineStatus(lastPrice, PRICE_STALE_HOURS),
    },
    edge_functions: EDGE_FUNCTIONS,
  }, {
    status:  dbOk ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
