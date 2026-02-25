// supabase/functions/detect-flags/index.ts
// Red Flags Detector — identifies financial and operational risk signals for a ticker.
//
// POST { ticker: string }
//
// Checks 10 red flags:
//   RF01  Revenue decline >10% YoY
//   RF02  Net margin negative 2+ consecutive periods
//   RF03  FCF proxy (net_income) negative
//   RF04  Dług/EBITDA >5x
//   RF05  Revenue miss >10% vs previous quarter
//   RF06  Event keywords: restrukturyzacja, zwolnienia, odpis
//   RF07  Event keywords: postępowanie, pozew, KNF, UOKiK
//   RF08  Insider selling >500k PLN (last 30 days)
//   RF09  More than 3 low-impact events (score <=3) in last 7 days
//   RF10  No financial reports uploaded in >90 days
//
// Saves to company_kpis (kpi_type='red_flags').
//
// Deploy: supabase functions deploy detect-flags --project-ref pftgmorsthoezhmojjpg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RedFlag {
  code:     string;
  name:     string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  detail:   string;
}

interface FinancialRow {
  period:     string;
  revenue:    number | null;
  net_income: number | null;
  ebitda:     number | null;
  net_debt:   number | null;
  created_at: string;
}

// ─── Flag checkers ────────────────────────────────────────────────────────────

function checkFinancialFlags(rows: FinancialRow[]): RedFlag[] {
  const flags: RedFlag[] = [];
  if (!rows.length) return flags;

  const latest = rows[0];
  const prev   = rows.length > 1 ? rows[1] : null;
  const older  = rows.length > 2 ? rows[2] : null;

  // RF01: Revenue decline >10% YoY
  if (latest.revenue !== null && prev?.revenue !== null && prev.revenue !== 0) {
    const growthPct = ((latest.revenue! - prev.revenue!) / Math.abs(prev.revenue!)) * 100;
    if (growthPct < -10) {
      flags.push({
        code:     "RF01",
        name:     "Revenue Decline",
        severity: growthPct < -20 ? "HIGH" : "MEDIUM",
        detail:   `Przychody spadły o ${Math.abs(growthPct).toFixed(1)}% r/r (${prev.period} → ${latest.period})`,
      });
    }
  }

  // RF02: Net margin negative 2 consecutive quarters
  const negMargin = rows.filter(r => r.net_income !== null && r.net_income! < 0);
  if (negMargin.length >= 2 && rows[0].net_income! < 0 && rows[1]?.net_income! < 0) {
    flags.push({
      code:     "RF02",
      name:     "Persistent Losses",
      severity: "HIGH",
      detail:   `Ujemna marża netto przez co najmniej 2 kolejne okresy (${rows[1].period}, ${rows[0].period})`,
    });
  }

  // RF03: FCF proxy (net_income) negative in latest period
  if (latest.net_income !== null && latest.net_income < 0) {
    flags.push({
      code:     "RF03",
      name:     "Negative FCF",
      severity: "MEDIUM",
      detail:   `Ujemny zysk netto w ${latest.period}: ${latest.net_income.toLocaleString("pl-PL")} PLN`,
    });
  }

  // RF04: Dług/EBITDA >5x
  if (latest.net_debt !== null && latest.ebitda !== null && latest.ebitda > 0) {
    const ratio = latest.net_debt / latest.ebitda;
    if (ratio > 5) {
      flags.push({
        code:     "RF04",
        name:     "High Leverage",
        severity: ratio > 8 ? "HIGH" : "MEDIUM",
        detail:   `Dług netto/EBITDA = ${ratio.toFixed(2)}x (próg: 5x) w ${latest.period}`,
      });
    }
  }

  // RF05: Revenue miss >10% vs previous quarter
  if (prev && latest.revenue !== null && prev.revenue !== null && prev.revenue !== 0) {
    const qoqPct = ((latest.revenue - prev.revenue) / Math.abs(prev.revenue)) * 100;
    if (qoqPct < -10) {
      flags.push({
        code:     "RF05",
        name:     "Revenue Miss",
        severity: "MEDIUM",
        detail:   `Przychody niższe o ${Math.abs(qoqPct).toFixed(1)}% q/q (${prev.period} → ${latest.period})`,
      });
    }
  }

  return flags;
}

// ─── Claude Haiku summary ─────────────────────────────────────────────────────

async function getHaikuSummary(
  ticker: string,
  flags: RedFlag[],
  apiKey: string,
): Promise<string> {
  const flagList = flags.map(f => `${f.code} (${f.severity}): ${f.name}`).join(", ");
  const userMsg  = `Spółka ${ticker} ma ${flags.length} red flags: ${flagList}. Napisz 2 zdania po polsku o ryzyku inwestycyjnym.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 150,
      system:     "Jesteś analitykiem finansowym. Piszesz krótkie oceny ryzyka dla inwestorów detalicznych.",
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

  const flags: RedFlag[] = [];
  const now = new Date();

  // ── RF01–RF05: Financial flags ─────────────────────────────────────────────
  const { data: financials, error: finErr } = await supabase
    .from("company_financials")
    .select("period, revenue, net_income, ebitda, net_debt, created_at")
    .eq("ticker", ticker)
    .order("period", { ascending: false })
    .limit(4);

  if (!finErr && financials?.length) {
    flags.push(...checkFinancialFlags(financials as FinancialRow[]));

    // RF10: No financial reports >90 days
    const latestReport = financials[0] as FinancialRow;
    const daysSince    = (now.getTime() - new Date(latestReport.created_at).getTime()) / 86_400_000;
    if (daysSince > 90) {
      flags.push({
        code:     "RF10",
        name:     "Stale Financials",
        severity: "LOW",
        detail:   `Ostatni raport finansowy: ${Math.round(daysSince)} dni temu (${latestReport.period})`,
      });
    }
  } else {
    // No financials at all → RF10
    flags.push({
      code:     "RF10",
      name:     "No Financial Data",
      severity: "MEDIUM",
      detail:   "Brak danych finansowych w systemie. Wgraj raport PDF.",
    });
  }

  // ── RF06–RF07: Event keyword flags ────────────────────────────────────────
  const since30d = new Date(now.getTime() - 30 * 86_400_000).toISOString();

  const { data: events } = await supabase
    .from("company_events")
    .select("title, impact_score, published_at")
    .eq("ticker", ticker)
    .gte("created_at", since30d)
    .order("created_at", { ascending: false })
    .limit(100);

  if (events?.length) {
    const restructureKw  = ["restrukturyzacja", "zwolnienia", "odpis", "impairment", "restructuring"];
    const legalKw        = ["postępowanie", "pozew", "kara", "knf", "uokik", "sankcja", "prokuratura"];

    const restructureHit = events.find(e =>
      restructureKw.some(k => e.title?.toLowerCase().includes(k))
    );
    if (restructureHit) {
      flags.push({
        code:     "RF06",
        name:     "Restructuring Signal",
        severity: "HIGH",
        detail:   `Wykryto słowo kluczowe restrukturyzacyjne: "${restructureHit.title?.slice(0, 80)}"`,
      });
    }

    const legalHit = events.find(e =>
      legalKw.some(k => e.title?.toLowerCase().includes(k))
    );
    if (legalHit) {
      flags.push({
        code:     "RF07",
        name:     "Legal/Regulatory Risk",
        severity: "HIGH",
        detail:   `Wykryto słowo kluczowe prawne: "${legalHit.title?.slice(0, 80)}"`,
      });
    }

    // RF09: >3 low-impact events (score <=3) in last 7 days
    const since7d    = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const lowImpact7d = events.filter(e =>
      e.impact_score !== null && e.impact_score <= 3 && e.published_at >= since7d
    );
    if (lowImpact7d.length > 3) {
      flags.push({
        code:     "RF09",
        name:     "Low Impact Event Cluster",
        severity: "LOW",
        detail:   `${lowImpact7d.length} zdarzeń z niskim impact_score (<=3) w ostatnich 7 dniach`,
      });
    }
  }

  // ── RF08: Insider selling >500k PLN ───────────────────────────────────────
  const { data: insiderSells } = await supabase
    .from("insider_transactions")
    .select("value_pln, transaction_date, person_name")
    .eq("ticker", ticker)
    .eq("transaction_type", "SELL")
    .gte("transaction_date", since30d.slice(0, 10))
    .gt("value_pln", 500_000)
    .limit(5);

  if (insiderSells?.length) {
    const totalSellValue = insiderSells.reduce((s: number, r: { value_pln: number | null }) => s + (r.value_pln ?? 0), 0);
    flags.push({
      code:     "RF08",
      name:     "Significant Insider Selling",
      severity: totalSellValue > 5_000_000 ? "HIGH" : "MEDIUM",
      detail:   `${insiderSells.length} insider sprzedaży >500k PLN w ostatnich 30 dniach (łącznie: ${totalSellValue.toLocaleString("pl-PL")} PLN)`,
    });
  }

  console.log(`[detect-flags] ${ticker}: ${flags.length} flags detected`);

  // ── Claude Haiku summary ───────────────────────────────────────────────────
  let summary = "";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (anthropicKey && flags.length > 0) {
    try {
      summary = await getHaikuSummary(ticker, flags, anthropicKey);
      console.log(`[detect-flags] ${ticker}: Haiku summary OK`);
    } catch (err) {
      console.warn(`[detect-flags] Haiku failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (flags.length === 0) {
    summary = `${ticker} nie wykazuje aktualnie żadnych sygnałów ostrzegawczych.`;
  }

  // ── Upsert to company_kpis ─────────────────────────────────────────────────
  const { error: upsertErr } = await supabase
    .from("company_kpis")
    .upsert({
      ticker,
      kpi_type:      "red_flags",
      value:         flags.length,
      metadata:      { flags, summary },
      calculated_at: now.toISOString(),
    }, { onConflict: "ticker,kpi_type" });

  if (upsertErr) {
    console.error(`[detect-flags] Upsert error: ${upsertErr.message}`);
  }

  return new Response(
    JSON.stringify({
      ok:          true,
      ticker,
      flags_count: flags.length,
      flags,
      summary,
      ts:          now.toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
