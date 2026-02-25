// supabase/functions/analyze-health/index.ts
// Financial Health Score calculator for a given ticker.
//
// POST { ticker: string }
//
// Fetches last 4 periods from company_financials, computes a weighted score (1–10),
// asks Claude Haiku for a 1-sentence comment in Polish, and upserts to company_kpis.
//
// Score components (weighted average):
//   Dług/EBITDA       weight 25%  — <2x=10, 2-3x=7, 3-5x=4, >5x=1
//   FCF/Revenue       weight 25%  — proxy: net_income/revenue  >15%=10, 5-15%=7, 0-5%=4, <0=1
//   ROE               weight 20%  — proxy: net_income/revenue (margin) >20%=10, 10-20%=7, 5-10%=4, <5%=1
//   Revenue growth YoY weight 15% — >20%=10, 5-20%=7, 0-5%=4, <0=1
//   Net margin        weight 15%  — >15%=10, 5-15%=7, 0-5%=4, <0=1
//
// Deploy: supabase functions deploy analyze-health --project-ref pftgmorsthoezhmojjpg

import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { createLogger }      from "../_shared/logger.ts";
import { okResponse, errorResponse } from "../_shared/response.ts";
import { callAnthropic }     from "../_shared/anthropic.ts";

const log = createLogger("analyze-health");

// ─── Types ────────────────────────────────────────────────────────────────────

interface FinancialRow {
  period:     string;
  revenue:    number | null;
  net_income: number | null;
  ebitda:     number | null;
  eps:        number | null;
  net_debt:   number | null;
  currency:   string;
}

interface ScoreComponent {
  name:   string;
  value:  number;
  score:  number;
  weight: number;
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────

function scoreDebtEbitda(debtEbitda: number): number {
  if (debtEbitda < 2)  return 10;
  if (debtEbitda < 3)  return 7;
  if (debtEbitda < 5)  return 4;
  return 1;
}

function scoreMarginPct(pct: number): number {
  if (pct > 15) return 10;
  if (pct > 5)  return 7;
  if (pct >= 0) return 4;
  return 1;
}

function scoreROE(pct: number): number {
  if (pct > 20) return 10;
  if (pct > 10) return 7;
  if (pct > 5)  return 4;
  return 1;
}

function scoreRevenueGrowth(pct: number): number {
  if (pct > 20) return 10;
  if (pct > 5)  return 7;
  if (pct >= 0) return 4;
  return 1;
}

function weightedAverage(components: ScoreComponent[]): number {
  const valid = components.filter(c => c.score > 0);
  if (!valid.length) return 0;
  const totalWeight = valid.reduce((s, c) => s + c.weight, 0);
  const sum         = valid.reduce((s, c) => s + c.score * (c.weight / totalWeight), 0);
  return Math.round(sum * 10) / 10;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  let body: { ticker?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const ticker = body.ticker?.toUpperCase()?.trim();
  if (!ticker) return errorResponse("ticker required", 400);

  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err));
  }

  // ── Fetch financial data ───────────────────────────────────────────────────
  const { data: financials, error: finErr } = await supabase
    .from("company_financials")
    .select("period, revenue, net_income, ebitda, eps, net_debt, currency")
    .eq("ticker", ticker)
    .order("period", { ascending: false })
    .limit(4);

  if (finErr) return errorResponse(finErr.message);
  if (!financials?.length) {
    return okResponse({ error: "no_financial_data", ticker });
  }

  const latest = financials[0] as FinancialRow;
  const prev   = financials.length > 1 ? financials[financials.length - 1] as FinancialRow : null;

  // ── Compute score components ───────────────────────────────────────────────
  const components: ScoreComponent[] = [];

  let debtEbitdaRatio: number | null = null;
  if (latest.net_debt !== null && latest.ebitda !== null && latest.ebitda !== 0) {
    debtEbitdaRatio = latest.net_debt / latest.ebitda;
    components.push({ name: "debt_ebitda", value: debtEbitdaRatio, score: scoreDebtEbitda(debtEbitdaRatio), weight: 0.25 });
  }

  let fcfMarginPct: number | null = null;
  if (latest.net_income !== null && latest.revenue !== null && latest.revenue !== 0) {
    fcfMarginPct = (latest.net_income / latest.revenue) * 100;
    components.push({ name: "fcf_revenue", value: fcfMarginPct, score: scoreMarginPct(fcfMarginPct), weight: 0.25 });
  }

  let roeProxy: number | null = null;
  if (latest.net_income !== null && latest.revenue !== null && latest.revenue !== 0) {
    roeProxy = (latest.net_income / latest.revenue) * 100;
    components.push({ name: "roe", value: roeProxy, score: scoreROE(roeProxy), weight: 0.20 });
  }

  if (prev && latest.revenue !== null && prev.revenue !== null && prev.revenue !== 0) {
    const growthPct = ((latest.revenue - prev.revenue) / Math.abs(prev.revenue)) * 100;
    components.push({ name: "revenue_growth", value: growthPct, score: scoreRevenueGrowth(growthPct), weight: 0.15 });
  }

  if (latest.net_income !== null && latest.revenue !== null && latest.revenue !== 0) {
    const netMarginPct = (latest.net_income / latest.revenue) * 100;
    components.push({ name: "net_margin", value: netMarginPct, score: scoreMarginPct(netMarginPct), weight: 0.15 });
  }

  if (components.length === 0) {
    return okResponse({ error: "no_computable_components", ticker });
  }

  const score = weightedAverage(components);

  // ── Claude Haiku comment via _shared/anthropic.ts ─────────────────────────
  let comment = "";
  try {
    const userMsg = [
      `Spółka ${ticker}.`,
      `Financial Health Score: ${score}/10.`,
      debtEbitdaRatio !== null ? `Dług/EBITDA: ${debtEbitdaRatio.toFixed(2)}x.` : null,
      fcfMarginPct    !== null ? `FCF/Revenue: ${fcfMarginPct.toFixed(1)}%.`     : null,
    ].filter(Boolean).join(" ");

    comment = await callAnthropic(
      "health_score",
      "Jesteś analitykiem finansowym. Napisz 1 krótkie zdanie po polsku o kondycji finansowej spółki na podstawie podanych danych.",
      [{ role: "user", content: userMsg }],
      100,
    );
    log.info(`${ticker}: Haiku comment OK`);
  } catch (err) {
    log.warn(`Haiku failed:`, err instanceof Error ? err.message : String(err));
  }

  // ── Upsert to company_kpis ─────────────────────────────────────────────────
  const metadata = {
    components:   components.map(c => ({ name: c.name, value: Math.round(c.value * 100) / 100, score: c.score })),
    comment,
    periods_used: financials.map((f: FinancialRow) => f.period),
  };

  const { error: upsertErr } = await supabase
    .from("company_kpis")
    .upsert(
      { ticker, kpi_type: "health_score", value: score, metadata, calculated_at: new Date().toISOString() },
      { onConflict: "ticker,kpi_type" },
    );

  if (upsertErr) {
    log.error("Upsert error:", upsertErr.message);
  } else {
    log.info(`${ticker}: score=${score} upserted`);
  }

  return okResponse({ ticker, score, components, comment });
});
