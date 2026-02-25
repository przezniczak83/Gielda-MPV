// supabase/functions/compute-snapshot/index.ts
// Precomputes denormalized company_snapshot rows.
//
// POST body: { ticker?: string }
//   ticker present  → compute only for that ticker
//   ticker absent   → compute for all companies (batches of 10)
//
// Runs every 30 min via pg_cron.
// Deploy: supabase functions deploy compute-snapshot --project-ref pftgmorsthoezhmojjpg

import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { createLogger }      from "../_shared/logger.ts";
import { okResponse, errorResponse } from "../_shared/response.ts";

const log = createLogger("compute-snapshot");

// ─── Types ────────────────────────────────────────────────────────────────────

interface CompanyRow {
  ticker: string;
  name:   string;
  sector: string | null;
  market: string;
}

// ─── Compute snapshot for one ticker ─────────────────────────────────────────

async function computeOne(
  supabase: ReturnType<typeof getSupabaseClient>,
  company: CompanyRow,
): Promise<{ ticker: string; ok: boolean; error?: string }> {
  const ticker      = company.ticker;
  const oneYearAgo  = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  // Fetch all data sources in parallel
  const [
    pricesRes,
    eventsRes,
    kpisRes,
    forecastsRes,
    multiplesRes,
    ourForecastRes,
  ] = await Promise.all([
    supabase
      .from("price_history")
      .select("close, date")
      .eq("ticker", ticker)
      .order("date", { ascending: false })
      .limit(2),

    supabase
      .from("company_events")
      .select("id, title, event_type, impact_score, published_at, url")
      .eq("ticker", ticker)
      .order("published_at", { ascending: false })
      .limit(5),

    supabase
      .from("company_kpis")
      .select("kpi_type, value, metadata")
      .eq("ticker", ticker)
      .in("kpi_type", ["health_score", "red_flags", "earnings_quality", "moat_score", "dividend_score"]),

    supabase
      .from("analyst_forecasts")
      .select("recommendation, price_target, upside_pct")
      .eq("ticker", ticker)
      .gte("published_at", oneYearAgo.toISOString())
      .order("published_at", { ascending: false })
      .limit(20),

    supabase
      .from("valuation_multiples")
      .select("pe_ratio, ev_ebitda, market_cap")
      .eq("ticker", ticker)
      .maybeSingle(),

    supabase
      .from("our_forecasts")
      .select("price_target, upside_pct, confidence")
      .eq("ticker", ticker)
      .eq("scenario", "base")
      .maybeSingle(),
  ]);

  // ── Price + change % ──────────────────────────────────────────────────────
  const prices      = pricesRes.data ?? [];
  const latestPrice = prices[0] ?? null;
  const prevPrice   = prices[1] ?? null;

  const changePct =
    latestPrice && prevPrice &&
    prevPrice.close != null && Number(prevPrice.close) !== 0
      ? ((Number(latestPrice.close) - Number(prevPrice.close)) /
          Math.abs(Number(prevPrice.close))) * 100
      : null;

  // ── Consensus ─────────────────────────────────────────────────────────────
  const analystRows = forecastsRes.data ?? [];
  let buy = 0, hold = 0, sell = 0;
  const pts: number[] = [];

  for (const f of analystRows) {
    const rec = (f.recommendation ?? "").toUpperCase();
    if (rec === "BUY" || rec === "OVERWEIGHT")        buy++;
    else if (rec === "SELL" || rec === "UNDERWEIGHT")  sell++;
    else                                               hold++;
    if (f.price_target != null) pts.push(Number(f.price_target));
  }

  const consRating: "BUY" | "HOLD" | "SELL" | null =
    analystRows.length === 0 ? null
    : buy > hold && buy > sell  ? "BUY"
    : sell > buy && sell > hold ? "SELL"
    : "HOLD";

  const avgPt = pts.length > 0 ? pts.reduce((s, v) => s + v, 0) / pts.length : null;
  const upsidePct =
    avgPt !== null && latestPrice?.close != null && Number(latestPrice.close) !== 0
      ? ((avgPt - Number(latestPrice.close)) / Number(latestPrice.close)) * 100
      : null;

  // ── KPIs map ──────────────────────────────────────────────────────────────
  const kpisMap: Record<string, { value: number | null; metadata: unknown }> = {};
  for (const k of (kpisRes.data ?? [])) {
    kpisMap[k.kpi_type] = { value: k.value, metadata: k.metadata };
  }

  const divMeta = kpisMap["dividend_score"]?.metadata as { cut_risk?: string } | null;

  // ── Multiples ─────────────────────────────────────────────────────────────
  const mult = multiplesRes.data;

  // ── Our forecast (base) ───────────────────────────────────────────────────
  const of_ = ourForecastRes.data;

  // ── Assemble snapshot ─────────────────────────────────────────────────────
  const snapshot = {
    company: {
      ticker:  company.ticker,
      name:    company.name,
      sector:  company.sector,
      market:  company.market,
    },
    price: latestPrice ? {
      close:      Number(latestPrice.close),
      date:       latestPrice.date,
      change_pct: changePct !== null ? Math.round(changePct * 100) / 100 : null,
    } : null,
    recent_events: (eventsRes.data ?? []).map(e => ({
      id:           e.id,
      title:        e.title,
      event_type:   e.event_type,
      impact_score: e.impact_score,
      published_at: e.published_at,
      url:          e.url,
    })),
    health_score:     kpisMap["health_score"]?.value    ?? null,
    red_flags_count:  kpisMap["red_flags"]?.value       ?? null,
    earnings_quality: kpisMap["earnings_quality"]?.value ?? null,
    moat_score:       kpisMap["moat_score"]?.value      ?? null,
    dividend_cut_risk: divMeta?.cut_risk ?? null,
    consensus: {
      rating:                consRating,
      avg_price_target:      avgPt !== null ? Math.round(avgPt * 100) / 100 : null,
      upside_pct:            upsidePct !== null ? Math.round(upsidePct * 100) / 100 : null,
      recommendations_count: analystRows.length,
    },
    multiples: {
      pe_ratio:   mult?.pe_ratio    ?? null,
      ev_ebitda:  mult?.ev_ebitda   ?? null,
      market_cap: mult?.market_cap  ?? null,
    },
    forecast_base: {
      price_target: of_?.price_target ?? null,
      upside_pct:   of_?.upside_pct   ?? null,
      confidence:   of_?.confidence   ?? null,
    },
  };

  const { error: upsertErr } = await supabase
    .from("company_snapshot")
    .upsert(
      { ticker, snapshot, computed_at: new Date().toISOString() },
      { onConflict: "ticker" },
    );

  if (upsertErr) {
    log.warn(`${ticker}: upsert error: ${upsertErr.message}`);
    return { ticker, ok: false, error: upsertErr.message };
  }

  return { ticker, ok: true };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  log.info("Invoked at:", new Date().toISOString());

  let body: { ticker?: string } = {};
  try { body = await req.json(); } catch { /* no body = all companies */ }

  let supabase: ReturnType<typeof getSupabaseClient>;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err));
  }

  // ── Single ticker ──────────────────────────────────────────────────────────
  if (body.ticker) {
    const ticker = body.ticker.toUpperCase().trim();
    const { data: company, error: compErr } = await supabase
      .from("companies")
      .select("ticker, name, sector, market")
      .eq("ticker", ticker)
      .maybeSingle();

    if (compErr) return errorResponse(compErr.message);
    if (!company) return errorResponse(`Ticker ${ticker} not found`, 404);

    const result = await computeOne(supabase, company as CompanyRow);
    log.info(`Single: ${ticker} → ${result.ok ? "ok" : result.error}`);
    return okResponse({ computed: 1, results: [result] });
  }

  // ── All companies (batch 10) ───────────────────────────────────────────────
  const { data: companies, error: compErr } = await supabase
    .from("companies")
    .select("ticker, name, sector, market")
    .order("ticker");

  if (compErr) return errorResponse(compErr.message);

  const all    = (companies ?? []) as CompanyRow[];
  const results: { ticker: string; ok: boolean; error?: string }[] = [];
  const BATCH  = 10;

  for (let i = 0; i < all.length; i += BATCH) {
    const batch   = all.slice(i, i + BATCH);
    const batchResults = await Promise.all(batch.map(c => computeOne(supabase, c)));
    results.push(...batchResults);
    log.info(`Batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(all.length / BATCH)} done`);
  }

  const ok  = results.filter(r => r.ok).length;
  const err = results.filter(r => !r.ok).length;
  log.info(`All done: ${ok} ok, ${err} errors`);

  return okResponse({ computed: ok, errors: err, results });
});
