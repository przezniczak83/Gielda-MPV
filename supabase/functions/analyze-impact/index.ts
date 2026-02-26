// supabase/functions/analyze-impact/index.ts
// Aggregate event impact statistics per event_type from company_events.
//
// POST {} — recomputes all event types
// POST { event_type: "earnings" } — recompute a specific type
//
// Reads: company_events (event_type, impact_score, ticker)
// Writes: event_impact_analysis (upsert per event_type)
//
// Deploy: supabase functions deploy analyze-impact --project-ref pftgmorsthoezhmojjpg

import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { createLogger }      from "../_shared/logger.ts";
import { okResponse, errorResponse } from "../_shared/response.ts";

const log = createLogger("analyze-impact");

interface EventRow {
  ticker:       string;
  event_type:   string | null;
  impact_score: number | null;
}

interface TickerStat {
  ticker:    string;
  count:     number;
  avg_score: number;
}

function median(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

Deno.serve(async (req: Request): Promise<Response> => {
  let body: { event_type?: string } = {};
  try { body = await req.json(); } catch { /* ignore empty body */ }

  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err));
  }

  // ── Fetch all events with impact scores ────────────────────────────────────
  let query = supabase
    .from("company_events")
    .select("ticker, event_type, impact_score")
    .not("impact_score", "is", null)
    .not("event_type",   "is", null);

  if (body.event_type) {
    query = query.eq("event_type", body.event_type);
  }

  const { data: rows, error } = await query;
  if (error) return errorResponse(error.message);
  if (!rows || rows.length === 0) {
    return okResponse({ message: "no events with impact scores", count: 0 });
  }

  log.info(`Loaded ${rows.length} events with impact scores`);

  // ── Group by event_type ────────────────────────────────────────────────────
  const groups = new Map<string, EventRow[]>();
  for (const row of rows as EventRow[]) {
    const key = row.event_type!;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const upsertRows: Record<string, unknown>[] = [];

  for (const [event_type, events] of groups.entries()) {
    const scores = events
      .map(e => e.impact_score as number)
      .sort((a, b) => a - b);

    const avg    = scores.reduce((s, v) => s + v, 0) / scores.length;
    const med    = median(scores);
    const posPct = (scores.filter(s => s > 0).length / scores.length) * 100;
    const hiPct  = (scores.filter(s => s >= 7).length  / scores.length) * 100;

    // Top 5 tickers by event count for this event_type
    const tickerMap = new Map<string, { count: number; sum: number }>();
    for (const e of events) {
      const t = tickerMap.get(e.ticker) ?? { count: 0, sum: 0 };
      t.count++;
      t.sum += e.impact_score as number;
      tickerMap.set(e.ticker, t);
    }
    const topTickers: TickerStat[] = [...tickerMap.entries()]
      .map(([ticker, { count, sum }]) => ({ ticker, count, avg_score: round2(sum / count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    upsertRows.push({
      event_type,
      sample_count:     scores.length,
      avg_impact_score: round2(avg),
      median_impact:    med !== null ? round2(med) : null,
      positive_pct:     round2(posPct),
      high_impact_pct:  round2(hiPct),
      top_tickers:      topTickers,
      computed_at:      new Date().toISOString(),
    });
  }

  const { error: upsertErr } = await supabase
    .from("event_impact_analysis")
    .upsert(upsertRows, { onConflict: "event_type" });

  if (upsertErr) {
    log.error("Upsert error:", upsertErr.message);
    return errorResponse(upsertErr.message);
  }

  log.info(`Upserted ${upsertRows.length} event_type rows`);
  return okResponse({
    processed:    upsertRows.length,
    total_events: rows.length,
    types:        upsertRows.map(r => r.event_type),
  });
});
