// GET /api/status
// Full pipeline observability: v_pipeline_status, KPIs, DB counts, recent errors.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function GET() {
  try {
    const db = supabase();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const since7d = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    const [
      pipelineRes,
      aiBacklogRes,
      tickerTotal7dRes,
      tickerCovered7dRes,
      pricesTodayRes,
      dbCompaniesRes,
      dbNewsRes,
      dbPriceHistRes,
      dbEventsRes,
      recentErrorsRes,
    ] = await Promise.all([
      // Pipeline status from view (gracefully empty if tables not yet populated)
      db.from("v_pipeline_status")
        .select("function_name, last_success_at, runs_24h, successes_24h, items_out_24h, health"),

      // AI backlog: news not yet processed
      db.from("news_items")
        .select("*", { count: "exact", head: true })
        .eq("ai_processed", false),

      // Ticker coverage: total articles in last 7 days
      db.from("news_items")
        .select("*", { count: "exact", head: true })
        .gte("published_at", since7d),

      // Ticker coverage: articles with tickers assigned (not null)
      db.from("news_items")
        .select("*", { count: "exact", head: true })
        .gte("published_at", since7d)
        .not("tickers", "is", null),

      // Companies with price updated today
      db.from("companies")
        .select("*", { count: "exact", head: true })
        .gte("price_updated_at", todayStart.toISOString()),

      // DB counts
      db.from("companies").select("*", { count: "exact", head: true }),
      db.from("news_items").select("*", { count: "exact", head: true }),
      db.from("price_history").select("*", { count: "exact", head: true }),
      db.from("company_events").select("*", { count: "exact", head: true }),

      // Recent pipeline failures
      db.from("pipeline_runs")
        .select("function_name, started_at, finished_at, error_message, errors, items_in, items_out")
        .eq("status", "failed")
        .order("started_at", { ascending: false })
        .limit(10),
    ]);

    const pipeline = (pipelineRes.data ?? []) as Array<{
      function_name: string;
      last_success_at: string | null;
      runs_24h: number;
      successes_24h: number;
      items_out_24h: number;
      health: string;
    }>;

    // Determine overall health from pipeline statuses
    let overall: "healthy" | "degraded" | "critical" = "healthy";
    if (pipeline.some(p => p.health === "dead"))                          overall = "critical";
    else if (pipeline.some(p => p.health === "degraded" || p.health === "stale")) overall = "degraded";

    const totalNews7d   = tickerTotal7dRes.count   ?? 0;
    const coveredNews7d = tickerCovered7dRes.count  ?? 0;
    const tickerCoverage7d = totalNews7d > 0
      ? Math.round((coveredNews7d / totalNews7d) * 100)
      : null;

    return NextResponse.json({
      overall,
      ts: new Date().toISOString(),
      pipeline,
      kpi: {
        ai_backlog:          aiBacklogRes.count    ?? 0,
        ticker_coverage_7d:  tickerCoverage7d,
        prices_updated_today: pricesTodayRes.count ?? 0,
        total_news:          dbNewsRes.count       ?? 0,
      },
      db: {
        companies:      dbCompaniesRes.count  ?? 0,
        news_items:     dbNewsRes.count       ?? 0,
        price_history:  dbPriceHistRes.count  ?? 0,
        company_events: dbEventsRes.count     ?? 0,
      },
      recent_errors: recentErrorsRes.data ?? [],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
