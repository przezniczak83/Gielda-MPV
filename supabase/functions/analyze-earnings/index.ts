// supabase/functions/analyze-earnings/index.ts
// Computes Earnings Quality Score (1-10) for a company from company_financials.
//
// Components:
//   1. FCF vs Net Income ratio (35%) — cash earnings vs reported
//   2. Accruals ratio (30%)           — net_income vs fcf vs assets
//   3. Revenue consistency (20%)      — std dev of revenues
//   4. One-time items frequency (15%) — restructuring keywords in events
//
// Stores result in company_kpis { kpi_type: 'earnings_quality' }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ─── Scoring functions ────────────────────────────────────────────────────────

function scoreFcfNi(ratio: number): number {
  if (ratio > 1.0)             return 10;
  if (ratio >= 0.7)            return 7;
  if (ratio >= 0.4)            return 4;
  return 1;
}

function scoreAccruals(absRatio: number): number {
  if (absRatio < 0.05)         return 10;
  if (absRatio < 0.10)         return 7;
  if (absRatio < 0.15)         return 4;
  return 1;
}

function scoreRevConsistency(cvRatio: number): number {
  if (cvRatio < 0.05)          return 10;
  if (cvRatio < 0.15)          return 7;
  if (cvRatio < 0.25)          return 4;
  return 1;
}

function scoreOneTimers(count: number): number {
  if (count === 0)             return 10;
  if (count === 1)             return 7;
  if (count === 2)             return 4;
  return 1;
}

const ONE_TIME_KEYWORDS = [
  "odpis", "restrukturyzacja", "jednorazow",
  "impairment", "write-off", "exceptional",
  "zwolnienia", "likwidacja", "wypowiedzenie umów",
];

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  console.log("[analyze-earnings] Invoked at:", new Date().toISOString());

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")              ?? "";
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")         ?? "";

  let body: { ticker?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const ticker = body.ticker?.toUpperCase().trim();
  if (!ticker) {
    return new Response(JSON.stringify({ ok: false, error: "ticker required" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // ── 1. Fetch last 4 financial periods ──────────────────────────────────────
  const { data: financials } = await db
    .from("company_financials")
    .select("period, revenue, net_income, ebitda, net_debt")
    .eq("ticker", ticker)
    .order("created_at", { ascending: false })
    .limit(4);

  // ── 2. Fetch company events for one-timers (last 365 days) ─────────────────
  const since365 = new Date();
  since365.setDate(since365.getDate() - 365);
  const { data: events } = await db
    .from("company_events")
    .select("title")
    .eq("ticker", ticker)
    .gte("published_at", since365.toISOString());

  const oneTimeCount = (events ?? []).filter(ev =>
    ONE_TIME_KEYWORDS.some(k => ev.title.toLowerCase().includes(k))
  ).length;

  // ── 3. Compute components ──────────────────────────────────────────────────
  const components: { name: string; score: number; weight: number; detail: unknown }[] = [];

  const rows = financials ?? [];
  const latest = rows[0];

  // Component 1: FCF / NI ratio
  // We approximate FCF = EBITDA * 0.6 (rough proxy) if no direct FCF column
  // Actually we'll use EBITDA as proxy for operating cash flow
  if (latest?.net_income != null && latest?.ebitda != null && latest.net_income !== 0) {
    const fcfProxy = Number(latest.ebitda) * 0.65; // rough operating cash flow proxy
    const ni       = Number(latest.net_income);
    const ratio    = ni !== 0 ? fcfProxy / ni : 0;
    components.push({
      name: "fcf_ni_ratio", score: scoreFcfNi(ratio), weight: 0.35,
      detail: { fcf_proxy: fcfProxy.toFixed(0), net_income: ni.toFixed(0), ratio: ratio.toFixed(2) }
    });
  }

  // Component 2: Accruals ratio (need net_income - fcf proxy / avg assets)
  // Proxy: accruals = (NI - EBITDA*0.65) / NI  — simplified version
  if (latest?.net_income != null && latest?.ebitda != null) {
    const ni       = Number(latest.net_income);
    const fcfProxy = Number(latest.ebitda) * 0.65;
    const accruals = ni !== 0 ? Math.abs((ni - fcfProxy) / Math.abs(ni)) : 0;
    components.push({
      name: "accruals", score: scoreAccruals(accruals), weight: 0.30,
      detail: { accruals_ratio: accruals.toFixed(3) }
    });
  }

  // Component 3: Revenue consistency (CV of revenues across periods)
  const revenues = rows
    .map(r => r.revenue != null ? Number(r.revenue) : null)
    .filter((v): v is number => v != null);

  if (revenues.length >= 2) {
    const avg = revenues.reduce((s, v) => s + v, 0) / revenues.length;
    const variance = revenues.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / revenues.length;
    const stddev = Math.sqrt(variance);
    const cv = avg > 0 ? stddev / Math.abs(avg) : 0;
    components.push({
      name: "revenue_consistency", score: scoreRevConsistency(cv), weight: 0.20,
      detail: { periods: revenues.length, cv: cv.toFixed(3) }
    });
  }

  // Component 4: One-time items frequency
  components.push({
    name: "one_time_items", score: scoreOneTimers(oneTimeCount), weight: 0.15,
    detail: { count: oneTimeCount }
  });

  if (components.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "Insufficient data for earnings quality" }), {
      status: 422,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  // Normalize weights
  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  const score = parseFloat(
    (components.reduce((s, c) => s + c.score * (c.weight / totalWeight), 0)).toFixed(1)
  );

  console.log(`[analyze-earnings] ${ticker}: EQ score=${score}/10 components=${components.length}`);

  // ── 4. Claude Haiku: 1-sentence Polish comment ──────────────────────────────
  let comment = "";
  if (anthropicKey) {
    const fcfNiComp = components.find(c => c.name === "fcf_ni_ratio");
    const ratio = (fcfNiComp?.detail as { ratio?: string } | undefined)?.ratio ?? "—";
    const prompt = `Spółka ${ticker}. Earnings Quality Score: ${score}/10. FCF/NI ratio: ${ratio}. Liczba jednorazowych zdarzeń: ${oneTimeCount}. Napisz DOKŁADNIE 1 zdanie po polsku o jakości zysku tej spółki (max 20 słów).`;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model:      "claude-haiku-4-5-20251001",
          max_tokens: 100,
          messages:   [{ role: "user", content: prompt }],
        }),
      });
      if (res.ok) {
        const data = await res.json() as { content?: Array<{ text: string }> };
        comment = data.content?.[0]?.text?.trim() ?? "";
      }
    } catch { /* ignore */ }
  }

  // ── 5. Upsert to company_kpis ───────────────────────────────────────────────
  const { error: upsertErr } = await db
    .from("company_kpis")
    .upsert({
      ticker,
      kpi_type:      "earnings_quality",
      value:         score,
      metadata:      { components, comment, one_time_events: oneTimeCount },
      calculated_at: new Date().toISOString(),
    }, { onConflict: "ticker,kpi_type" });

  if (upsertErr) {
    console.error("[analyze-earnings] Upsert error:", upsertErr.message);
    return new Response(JSON.stringify({ ok: false, error: upsertErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  return new Response(JSON.stringify({
    ok:      true,
    ticker,
    score,
    comment,
    components: components.map(c => ({ name: c.name, score: c.score, weight: c.weight })),
  }), { status: 200, headers: { "Content-Type": "application/json", ...CORS } });
});
