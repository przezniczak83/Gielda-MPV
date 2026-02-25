// supabase/functions/gen-forecast/index.ts
// Generates 3-scenario AI forecasts (base/bull/bear) for a company.
// Uses Claude Sonnet with company financials + valuation multiples context.
//
// POST body: { ticker: string }
//
// Flow:
//   1. Fetch company data (financials, multiples, health_score, current price)
//   2. Claude Sonnet: generate base/bull/bear scenarios as JSON
//   3. Upsert to our_forecasts (UNIQUE ticker,scenario)
//   4. Send Telegram alert
//
// Secrets: ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const JSON_HEADERS = { "Content-Type": "application/json", ...CORS };

interface Scenario {
  scenario:             string;   // base | bull | bear
  revenue_growth_pct:   number | null;
  ebitda_margin_pct:    number | null;
  eps:                  number | null;
  price_target:         number | null;
  rationale:            string;
  confidence:           number;   // 1-10
  key_assumptions:      string[];
}

interface SonnetOutput {
  base: Scenario;
  bull: Scenario;
  bear: Scenario;
  generated_at?: string;
}

// ─── Build context for Claude ─────────────────────────────────────────────────

async function buildContext(
  db:     ReturnType<typeof createClient>,
  ticker: string,
): Promise<string> {
  const [
    { data: company },
    { data: financials },
    { data: multiples },
    { data: priceRow },
    { data: kpiRows },
  ] = await Promise.all([
    db.from("companies").select("name, sector, market, description").eq("ticker", ticker).single(),
    db.from("company_financials").select("*").eq("ticker", ticker).order("created_at", { ascending: false }).limit(2),
    db.from("valuation_multiples").select("*").eq("ticker", ticker).single(),
    db.from("price_history").select("close, date").eq("ticker", ticker).order("date", { ascending: false }).limit(1).single(),
    db.from("company_kpis").select("kpi_type, value, metadata").eq("ticker", ticker),
  ]);

  const lines: string[] = [
    `Spółka: ${ticker} — ${company?.name ?? "nieznana"}`,
    `Sektor: ${company?.sector ?? "nieznany"} | Rynek: ${company?.market ?? "GPW"}`,
    `Aktualna cena: ${priceRow?.close != null ? `${priceRow.close} PLN (${priceRow.date})` : "brak danych"}`,
  ];

  if (multiples) {
    const m = multiples as Record<string, unknown>;
    lines.push("\n--- Wskaźniki wyceny ---");
    if (m.pe_ratio  != null) lines.push(`P/E: ${m.pe_ratio}`);
    if (m.pb_ratio  != null) lines.push(`P/B: ${m.pb_ratio}`);
    if (m.ev_ebitda != null) lines.push(`EV/EBITDA: ${m.ev_ebitda}`);
    if (m.market_cap != null) lines.push(`Kapitalizacja: ${(Number(m.market_cap) / 1e6).toFixed(0)} mln PLN`);
  }

  if (financials?.length) {
    lines.push("\n--- Dane finansowe (ostatnie okresy) ---");
    for (const f of financials as Record<string, unknown>[]) {
      lines.push(`Okres: ${f.period} (${f.currency})`);
      if (f.revenue    != null) lines.push(`  Przychody: ${Number(f.revenue)    / 1e6} mln`);
      if (f.ebitda     != null) lines.push(`  EBITDA: ${Number(f.ebitda)       / 1e6} mln`);
      if (f.net_income != null) lines.push(`  Zysk netto: ${Number(f.net_income) / 1e6} mln`);
      if (f.eps        != null) lines.push(`  EPS: ${f.eps}`);
      if (f.net_debt   != null) lines.push(`  Dług netto: ${Number(f.net_debt)  / 1e6} mln`);
    }
  }

  if (kpiRows?.length) {
    lines.push("\n--- AI Scores ---");
    for (const k of kpiRows as { kpi_type: string; value: number | null; metadata: Record<string, unknown> | null }[]) {
      if (k.kpi_type === "health_score") lines.push(`Health Score: ${k.value}/10`);
      if (k.kpi_type === "red_flags" && k.value != null && k.value > 0) lines.push(`Red Flags: ${k.value}`);
      if (k.kpi_type === "dividend_score") {
        const risk = (k.metadata as { cut_risk?: string } | null)?.cut_risk;
        if (risk) lines.push(`Ryzyko cięcia dywidendy: ${risk}`);
      }
    }
  }

  return lines.join("\n");
}

// ─── Claude Sonnet call ───────────────────────────────────────────────────────

const FORECAST_PROMPT_TEMPLATE = (context: string) => `Jesteś analitykiem rynku kapitałowego GPW. Na podstawie poniższych danych wygeneruj 3 scenariusze prognozy dla spółki.

${context}

Wygeneruj prognozy w 3 scenariuszach: base (bazowy), bull (optymistyczny), bear (pesymistyczny).

Zwróć WYŁĄCZNIE JSON (bez markdown, bez komentarzy):
{
  "base": {
    "scenario": "base",
    "revenue_growth_pct": <prognozowany wzrost przychodów r/r w %, liczba lub null>,
    "ebitda_margin_pct": <prognozowana marża EBITDA w %, liczba lub null>,
    "eps": <prognozowany EPS, liczba lub null>,
    "price_target": <cena docelowa w PLN, liczba>,
    "rationale": "2-3 zdania po polsku uzasadniające scenariusz bazowy",
    "confidence": <pewność 1-10>,
    "key_assumptions": ["założenie 1", "założenie 2", "założenie 3"]
  },
  "bull": {
    "scenario": "bull",
    "revenue_growth_pct": <wyższy wzrost>,
    "ebitda_margin_pct": <wyższa marża>,
    "eps": <wyższy EPS>,
    "price_target": <wyższa cena docelowa>,
    "rationale": "2-3 zdania po polsku o scenariuszu optymistycznym",
    "confidence": <pewność 1-10>,
    "key_assumptions": ["katalizator 1", "katalizator 2"]
  },
  "bear": {
    "scenario": "bear",
    "revenue_growth_pct": <niższy wzrost lub negatywny>,
    "ebitda_margin_pct": <niższa marża>,
    "eps": <niższy EPS>,
    "price_target": <niższa cena docelowa>,
    "rationale": "2-3 zdania po polsku o scenariuszu pesymistycznym",
    "confidence": <pewność 1-10>,
    "key_assumptions": ["ryzyko 1", "ryzyko 2"]
  }
}`;

async function callSonnet(apiKey: string, context: string): Promise<SonnetOutput> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 1200,
      messages:   [{ role: "user", content: FORECAST_PROMPT_TEMPLATE(context) }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json() as { content?: Array<{ text: string }> };
  const text = data.content?.[0]?.text ?? "";
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Sonnet JSON parse failed: ${clean.slice(0, 200)}`);
  return JSON.parse(jsonMatch[0]) as SonnetOutput;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  console.log("[gen-forecast] Invoked at:", new Date().toISOString());

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")              ?? "";
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")         ?? "";
  const tgToken      = Deno.env.get("TELEGRAM_BOT_TOKEN")        ?? "";
  const tgChatId     = Deno.env.get("TELEGRAM_CHAT_ID")          ?? "";

  if (!anthropicKey) {
    return new Response(JSON.stringify({ ok: false, error: "ANTHROPIC_API_KEY not configured" }), { status: 500, headers: JSON_HEADERS });
  }

  let body: { ticker?: string };
  try { body = await req.json(); } catch { body = {}; }

  const ticker = body.ticker?.toUpperCase().trim();
  if (!ticker) {
    return new Response(JSON.stringify({ ok: false, error: "ticker required" }), { status: 400, headers: JSON_HEADERS });
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // ── 1. Build context ────────────────────────────────────────────────────────
  let context: string;
  try {
    context = await buildContext(db, ticker);
    console.log(`[gen-forecast] Context built for ${ticker}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: `Context: ${msg}` }), { status: 500, headers: JSON_HEADERS });
  }

  // ── 2. Claude Sonnet ────────────────────────────────────────────────────────
  let output: SonnetOutput;
  try {
    output = await callSonnet(anthropicKey, context);
    console.log(`[gen-forecast] Sonnet generated 3 scenarios for ${ticker}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: `Sonnet: ${msg}` }), { status: 502, headers: JSON_HEADERS });
  }

  // ── 3. Upsert to our_forecasts ──────────────────────────────────────────────
  const now = new Date().toISOString();
  const upsertRows = (["base", "bull", "bear"] as const).map(s => {
    const sc = output[s];
    return {
      ticker,
      scenario:             s,
      revenue_growth_pct:   sc.revenue_growth_pct,
      ebitda_margin_pct:    sc.ebitda_margin_pct,
      eps:                  sc.eps,
      price_target:         sc.price_target,
      rationale:            sc.rationale,
      confidence:           sc.confidence,
      key_assumptions:      sc.key_assumptions ?? [],
      generated_at:         now,
    };
  });

  const { error: upsertErr } = await db
    .from("our_forecasts")
    .upsert(upsertRows, { onConflict: "ticker,scenario" });

  if (upsertErr) {
    console.error("[gen-forecast] Upsert error:", upsertErr.message);
    return new Response(JSON.stringify({ ok: false, error: upsertErr.message }), { status: 500, headers: JSON_HEADERS });
  }

  console.log(`[gen-forecast] Upserted 3 scenarios for ${ticker}`);

  // ── 4. Telegram alert ───────────────────────────────────────────────────────
  if (tgToken && tgChatId) {
    const base = output.base;
    const bull = output.bull;
    const bear = output.bear;

    const text = [
      `🤖 *PROGNOZA AI: ${ticker}*`,
      ``,
      `🎯 *Bazowy*: ${base.price_target ?? "—"} PLN (pewność: ${base.confidence}/10)`,
      `${base.rationale}`,
      ``,
      `🟢 *Optymistyczny*: ${bull.price_target ?? "—"} PLN`,
      `🔴 *Pesymistyczny*: ${bear.price_target ?? "—"} PLN`,
    ].join("\n");

    try {
      await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ chat_id: tgChatId, text, parse_mode: "Markdown" }),
      });
    } catch (tgErr) {
      console.warn("[gen-forecast] Telegram failed:", tgErr instanceof Error ? tgErr.message : String(tgErr));
    }
  }

  return new Response(JSON.stringify({
    ok:       true,
    ticker,
    scenarios: ["base", "bull", "bear"],
    base_pt:  output.base.price_target,
    bull_pt:  output.bull.price_target,
    bear_pt:  output.bear.price_target,
    ts:       now,
  }), { status: 200, headers: JSON_HEADERS });
});
