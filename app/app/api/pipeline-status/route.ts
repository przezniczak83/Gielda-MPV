// GET /api/pipeline-status
// Returns pipeline_runs monitoring data: per-function stats, KPIs, last 20 runs.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const revalidate = 30;

interface PipelineRun {
  id:            number;
  function_name: string;
  source:        string | null;
  started_at:    string;
  finished_at:   string | null;
  status:        string;
  items_in:      number | null;
  items_out:     number | null;
  errors:        number | null;
  details:       Record<string, unknown> | null;
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const since24h   = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  const [
    { data: recentRuns },
    { data: runStats },
    { count: aiBacklog },
    { count: pricesToday },
  ] = await Promise.all([
    supabase
      .from("pipeline_runs")
      .select("id, function_name, source, started_at, finished_at, status, items_in, items_out, errors, details")
      .order("started_at", { ascending: false })
      .limit(20),

    supabase
      .from("pipeline_runs")
      .select("function_name, status, started_at, finished_at, items_in, items_out, errors")
      .gte("started_at", since24h)
      .order("started_at", { ascending: false }),

    supabase
      .from("news_items")
      .select("*", { count: "exact", head: true })
      .eq("ai_processed", false),

    supabase
      .from("companies")
      .select("*", { count: "exact", head: true })
      .gte("price_updated_at", todayStart),
  ]);

  // Compute per-function 24h stats
  const KNOWN_FUNCTIONS = ["fetch-news", "fetch-espi", "fetch-prices", "process-news"];

  type FnStat = {
    runs:         number;
    successes:    number;
    last_run:     string | null;
    last_status:  string | null;
    items_in_24h: number;
    items_out_24h:number;
  };

  const fnMap = new Map<string, FnStat>(
    KNOWN_FUNCTIONS.map(fn => [fn, {
      runs: 0, successes: 0, last_run: null, last_status: null,
      items_in_24h: 0, items_out_24h: 0,
    }]),
  );

  for (const run of (runStats ?? []) as PipelineRun[]) {
    const existing = fnMap.get(run.function_name) ?? {
      runs: 0, successes: 0, last_run: null, last_status: null,
      items_in_24h: 0, items_out_24h: 0,
    };
    fnMap.set(run.function_name, {
      runs:          existing.runs + 1,
      successes:     existing.successes + (run.status === "success" ? 1 : 0),
      last_run:      existing.last_run ?? run.started_at,
      last_status:   existing.last_status ?? run.status,
      items_in_24h:  existing.items_in_24h  + (run.items_in  ?? 0),
      items_out_24h: existing.items_out_24h + (run.items_out ?? 0),
    });
  }

  const functions = [...fnMap.entries()].map(([name, stats]) => ({
    name,
    ...stats,
    success_rate: stats.runs > 0 ? Math.round(stats.successes / stats.runs * 100) : null,
  }));

  return NextResponse.json({
    functions,
    recent_runs: (recentRuns ?? []) as PipelineRun[],
    kpis: {
      ai_backlog:   aiBacklog   ?? 0,
      prices_today: pricesToday ?? 0,
    },
    ts: new Date().toISOString(),
  });
}
