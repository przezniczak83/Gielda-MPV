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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  value:  number;    // raw metric value (ratio/percent)
  score:  number;    // 1-10
  weight: number;    // fraction
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────

/** Score Dług/EBITDA (lower is better) */
function scoreDebtEbitda(debtEbitda: number): number {
  if (debtEbitda < 2)  return 10;
  if (debtEbitda < 3)  return 7;
  if (debtEbitda < 5)  return 4;
  return 1;
}

/** Score FCF/Revenue or Net margin (higher is better, as %) */
function scoreMarginPct(pct: number): number {
  if (pct > 15) return 10;
  if (pct > 5)  return 7;
  if (pct >= 0) return 4;
  return 1;
}

/** Score ROE or net margin (higher threshold) */
function scoreROE(pct: number): number {
  if (pct > 20) return 10;
  if (pct > 10) return 7;
  if (pct > 5)  return 4;
  return 1;
}

/** Score revenue growth YoY (as %) */
function scoreRevenueGrowth(pct: number): number {
  if (pct > 20) return 10;
  if (pct > 5)  return 7;
  if (pct >= 0) return 4;
  return 1;
}

/** Compute weighted average, skip null components */
function weightedAverage(components: ScoreComponent[]): number {
  const valid = components.filter(c => c.score > 0);
  if (!valid.length) return 0;

  // Normalize weights to sum to 1
  const totalWeight = valid.reduce((s, c) => s + c.weight, 0);
  const sum = valid.reduce((s, c) => s + c.score * (c.weight / totalWeight), 0);
  return Math.round(sum * 10) / 10;
}

// ─── Claude Haiku comment ─────────────────────────────────────────────────────

async function getHaikuComment(
  ticker: string,
  score: number,
  debtEbitda: number | null,
  fcfMargin: number | null,
  apiKey: string,
): Promise<string> {
  const userMsg = [
    `Spółka ${ticker}.`,
    `Financial Health Score: ${score}/10.`,
    debtEbitda !== null ? `Dług/EBITDA: ${debtEbitda.toFixed(2)}x.` : null,
    fcfMargin  !== null ? `FCF/Revenue: ${fcfMargin.toFixed(1)}%.`  : null,
  ].filter(Boolean).join(" ");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 100,
      system:     "Jesteś analitykiem finansowym. Napisz 1 krótkie zdanie po polsku o kondycji finansowej spółki na podstawie podanych danych.",
      messages:   [{ role: "user", content: userMsg }],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Claude API ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json() as { content: Array<{ text: string }> };
  return data.content?.[0]?.text?.trim() ?? "";
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")              ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  let body: { ticker?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON body" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const ticker = body.ticker?.toUpperCase()?.trim();
  if (!ticker) {
    return new Response(JSON.stringify({ ok: false, error: "ticker required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // ── Fetch financial data ───────────────────────────────────────────────────
  const { data: financials, error: finErr } = await supabase
    .from("company_financials")
    .select("period, revenue, net_income, ebitda, eps, net_debt, currency")
    .eq("ticker", ticker)
    .order("period", { ascending: false })
    .limit(4);

  if (finErr) {
    return new Response(JSON.stringify({ ok: false, error: finErr.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  if (!financials?.length) {
    return new Response(JSON.stringify({ ok: false, error: "no_financial_data", ticker }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const latest  = financials[0] as FinancialRow;
  const prev    = financials.length > 1 ? financials[financials.length - 1] as FinancialRow : null;

  // ── Compute score components ───────────────────────────────────────────────
  const components: ScoreComponent[] = [];

  // 1. Dług/EBITDA (weight 25%)
  let debtEbitdaRatio: number | null = null;
  if (latest.net_debt !== null && latest.ebitda !== null && latest.ebitda !== 0) {
    debtEbitdaRatio = latest.net_debt / latest.ebitda;
    components.push({
      name:   "debt_ebitda",
      value:  debtEbitdaRatio,
      score:  scoreDebtEbitda(debtEbitdaRatio),
      weight: 0.25,
    });
  }

  // 2. FCF/Revenue proxy: net_income/revenue (weight 25%)
  let fcfMarginPct: number | null = null;
  if (latest.net_income !== null && latest.revenue !== null && latest.revenue !== 0) {
    fcfMarginPct = (latest.net_income / latest.revenue) * 100;
    components.push({
      name:   "fcf_revenue",
      value:  fcfMarginPct,
      score:  scoreMarginPct(fcfMarginPct),
      weight: 0.25,
    });
  }

  // 3. ROE proxy: net_margin (weight 20%)
  let roeProxy: number | null = null;
  if (latest.net_income !== null && latest.revenue !== null && latest.revenue !== 0) {
    roeProxy = (latest.net_income / latest.revenue) * 100;
    components.push({
      name:   "roe",
      value:  roeProxy,
      score:  scoreROE(roeProxy),
      weight: 0.20,
    });
  }

  // 4. Revenue growth YoY (weight 15%)
  let revenueGrowthPct: number | null = null;
  if (prev && latest.revenue !== null && prev.revenue !== null && prev.revenue !== 0) {
    revenueGrowthPct = ((latest.revenue - prev.revenue) / Math.abs(prev.revenue)) * 100;
    components.push({
      name:   "revenue_growth",
      value:  revenueGrowthPct,
      score:  scoreRevenueGrowth(revenueGrowthPct),
      weight: 0.15,
    });
  }

  // 5. Net margin (weight 15%)
  let netMarginPct: number | null = null;
  if (latest.net_income !== null && latest.revenue !== null && latest.revenue !== 0) {
    netMarginPct = (latest.net_income / latest.revenue) * 100;
    components.push({
      name:   "net_margin",
      value:  netMarginPct,
      score:  scoreMarginPct(netMarginPct),
      weight: 0.15,
    });
  }

  if (components.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "no_financial_data", ticker }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  const score = weightedAverage(components);

  // ── Claude Haiku comment ───────────────────────────────────────────────────
  let comment = "";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (anthropicKey) {
    try {
      comment = await getHaikuComment(ticker, score, debtEbitdaRatio, fcfMarginPct, anthropicKey);
      console.log(`[analyze-health] ${ticker}: Haiku comment OK`);
    } catch (err) {
      console.warn(`[analyze-health] Haiku failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Upsert to company_kpis ─────────────────────────────────────────────────
  const metadata = {
    components: components.map(c => ({
      name:  c.name,
      value: Math.round(c.value * 100) / 100,
      score: c.score,
    })),
    comment,
    periods_used: financials.map((f: FinancialRow) => f.period),
  };

  const { error: upsertErr } = await supabase
    .from("company_kpis")
    .upsert({
      ticker,
      kpi_type:      "health_score",
      value:         score,
      metadata,
      calculated_at: new Date().toISOString(),
    }, { onConflict: "ticker,kpi_type" });

  if (upsertErr) {
    console.error(`[analyze-health] Upsert error: ${upsertErr.message}`);
  } else {
    console.log(`[analyze-health] ${ticker}: score=${score} upserted`);
  }

  return new Response(
    JSON.stringify({ ok: true, ticker, score, components, comment, ts: new Date().toISOString() }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
