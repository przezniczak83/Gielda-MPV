// supabase/functions/analyze-dividend/index.ts
// Dividend Sustainability Score calculator.
//
// POST { ticker: string }
//
// Logic:
//   Payout ratio  = total_dividends / net_income
//   FCF coverage  = net_income / total_dividends  (proxy when FCF unavailable)
//
//   Cut risk:
//     HIGH   — payout >80%  OR  FCF coverage <1.2
//     MEDIUM — payout 50-80% OR FCF coverage 1.2-1.5
//     LOW    — payout <50%  AND FCF coverage >1.5
//
//   cut_risk → numeric: HIGH=3, MEDIUM=2, LOW=1
//
// Returns {ok:true, dividend:false} when no dividend data found.
//
// Saves to company_kpis:
//   {ticker, kpi_type:'dividend_score', value:cut_risk_numeric,
//    metadata:{payout_ratio, fcf_coverage, cut_risk, comment}}
//
// Deploy: supabase functions deploy analyze-dividend --project-ref pftgmorsthoezhmojjpg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

type CutRisk = "HIGH" | "MEDIUM" | "LOW";

interface FinancialRow {
  period:           string;
  revenue:          number | null;
  net_income:       number | null;
  ebitda:           number | null;
  eps:              number | null;
  net_debt:         number | null;
  dividend_paid:    number | null;   // total dividends paid (may be null)
  dividend_per_share: number | null; // DPS (may be null)
  shares_outstanding: number | null; // used to derive total div if only DPS known
  currency:         string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeCutRisk(payoutRatio: number, fcfCoverage: number): CutRisk {
  if (payoutRatio > 80 || fcfCoverage < 1.2)            return "HIGH";
  if (payoutRatio > 50 || fcfCoverage < 1.5)            return "MEDIUM";
  return "LOW";
}

function cutRiskToNumeric(risk: CutRisk): number {
  if (risk === "HIGH")   return 3;
  if (risk === "MEDIUM") return 2;
  return 1;
}

// ─── Claude Haiku comment ─────────────────────────────────────────────────────

async function getHaikuComment(
  ticker:       string,
  payoutRatio:  number,
  fcfCoverage:  number,
  cutRisk:      CutRisk,
  apiKey:       string,
): Promise<string> {
  const riskPL = cutRisk === "HIGH" ? "wysokie" : cutRisk === "MEDIUM" ? "umiarkowane" : "niskie";
  const msg = `Spółka ${ticker}. Payout ratio: ${payoutRatio.toFixed(1)}%. FCF coverage: ${fcfCoverage.toFixed(2)}x. Ryzyko obcięcia dywidendy: ${riskPL}. Napisz 1 zdanie po polsku.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 80,
      system:     "Jesteś analitykiem dywidendowym. Piszesz krótkie oceny po polsku.",
      messages:   [{ role: "user", content: msg }],
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}`);
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

  // ── Fetch financial data (only guaranteed columns) ────────────────────────
  const { data: financials, error: finErr } = await supabase
    .from("company_financials")
    .select("period, revenue, net_income, ebitda, eps, net_debt, currency")
    .eq("ticker", ticker)
    .order("period", { ascending: false })
    .limit(4);

  if (finErr) {
    console.warn(`[analyze-dividend] ${ticker}: financials query error: ${finErr.message}`);
    return new Response(
      JSON.stringify({ ok: true, ticker, dividend: false, reason: "no_financial_data" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!financials?.length) {
    return new Response(
      JSON.stringify({ ok: true, ticker, dividend: false, reason: "no_financial_data" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const latest = financials[0] as FinancialRow;

  // ── Derive total dividends paid ────────────────────────────────────────────
  // Columns dividend_paid / dividend_per_share may not exist yet in the schema.
  // Primary strategy: check company_events for dividend events.
  let totalDiv: number | null =
    (latest as unknown as Record<string, unknown>)["dividend_paid"] as number | null ?? null;

  // Fallback: DPS × shares
  if (totalDiv === null) {
    const dps    = (latest as unknown as Record<string, unknown>)["dividend_per_share"] as number | null;
    const shares = (latest as unknown as Record<string, unknown>)["shares_outstanding"]  as number | null;
    if (dps !== null && shares !== null) totalDiv = dps * shares;
  }

  // Fallback: check company_events for dividend events with extracted values
  if (totalDiv === null) {
    const { data: divEvents } = await supabase
      .from("company_events")
      .select("title")
      .eq("ticker", ticker)
      .eq("event_type", "dividend")
      .order("published_at", { ascending: false })
      .limit(3);

    if (divEvents?.length) {
      // Try extracting value from title: "dywidenda 2.50 PLN" or "DPS: 2.50"
      for (const ev of divEvents) {
        const m = ev.title.match(/(\d+[\.,]\d+)\s*(?:pln|zł|zl)/i)
               ?? ev.title.match(/dps[:\s]+(\d+[\.,]\d+)/i)
               ?? ev.title.match(/dywidend[a-z]*[:\s]+(\d+[\.,]\d+)/i);
        if (m) {
          const dps = parseFloat(m[1].replace(",", "."));
          if (!isNaN(dps) && dps > 0) {
            // Use EPS-derived share count proxy if shares_outstanding unknown
            if (latest.eps && latest.eps > 0 && latest.net_income) {
              const impliedShares = latest.net_income / latest.eps;
              totalDiv = dps * impliedShares;
            }
            break;
          }
        }
      }
    }
  }

  // No dividend data at all → early return
  if (totalDiv === null || totalDiv <= 0) {
    console.log(`[analyze-dividend] ${ticker}: no dividend data found`);
    return new Response(
      JSON.stringify({ ok: true, ticker, dividend: false, reason: "no_dividend_data" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!latest.net_income || latest.net_income <= 0) {
    // Can't compute meaningful ratios without positive net income
    return new Response(
      JSON.stringify({ ok: true, ticker, dividend: false, reason: "negative_earnings" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── Compute ratios ─────────────────────────────────────────────────────────
  const payoutRatio = (totalDiv / latest.net_income) * 100;
  const fcfCoverage = latest.net_income / totalDiv;   // proxy: earnings coverage
  const cutRisk     = computeCutRisk(payoutRatio, fcfCoverage);
  const cutRiskNum  = cutRiskToNumeric(cutRisk);

  console.log(`[analyze-dividend] ${ticker}: payout=${payoutRatio.toFixed(1)}% fcf=${fcfCoverage.toFixed(2)}x risk=${cutRisk}`);

  // ── Claude Haiku comment ───────────────────────────────────────────────────
  let comment = "";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (anthropicKey) {
    try {
      comment = await getHaikuComment(ticker, payoutRatio, fcfCoverage, cutRisk, anthropicKey);
    } catch (err) {
      console.warn(`[analyze-dividend] Haiku failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Upsert to company_kpis ─────────────────────────────────────────────────
  const metadata = {
    payout_ratio: Math.round(payoutRatio * 10) / 10,
    fcf_coverage: Math.round(fcfCoverage * 100) / 100,
    cut_risk:     cutRisk,
    total_div:    Math.round(totalDiv),
    period:       latest.period,
    comment,
  };

  const { error: upsertErr } = await supabase
    .from("company_kpis")
    .upsert({
      ticker,
      kpi_type:      "dividend_score",
      value:         cutRiskNum,
      metadata,
      calculated_at: new Date().toISOString(),
    }, { onConflict: "ticker,kpi_type" });

  if (upsertErr) {
    console.error(`[analyze-dividend] Upsert error: ${upsertErr.message}`);
  }

  return new Response(
    JSON.stringify({
      ok:           true,
      ticker,
      dividend:     true,
      payout_ratio: metadata.payout_ratio,
      fcf_coverage: metadata.fcf_coverage,
      cut_risk:     cutRisk,
      cut_risk_num: cutRiskNum,
      comment,
      ts:           new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
