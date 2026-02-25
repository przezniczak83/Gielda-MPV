// supabase/functions/analyze-moat/index.ts
// MOAT-7 AI Disruption Analysis — evaluates 7 competitive moat dimensions (1-10)
// using Claude Sonnet. Only runs for tech/gaming/SaaS companies.
//
// POST { ticker: string }
// Returns { ok, skipped?, dimensions, overall_moat, moat_strength, summary }
//
// Stores result in company_kpis { kpi_type: 'moat_score' }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Sectors eligible for MOAT analysis
const TECH_SECTORS = new Set([
  "Technology", "Gaming", "E-commerce", "Fintech",
  "SaaS", "Streaming", "Data/Cloud", "AI/Defense",
  "Semiconductors", "Enterprise", "Tech",
]);

interface MoatDimension {
  score:     number;
  rationale: string;
}

interface MoatResult {
  d1_network_effects:  MoatDimension;
  d2_switching_costs:  MoatDimension;
  d3_cost_advantages:  MoatDimension;
  d4_intangible_assets:MoatDimension;
  d5_efficient_scale:  MoatDimension;
  d6_ai_disruption_risk: MoatDimension;
  d7_data_moat:        MoatDimension;
  overall_moat:        number;
  moat_strength:       "WIDE" | "NARROW" | "NONE";
  summary:             string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), { status: 405, headers: CORS });
  }

  let ticker: string;
  try {
    const body = await req.json();
    ticker = (body.ticker ?? "").toUpperCase().trim();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), { status: 400, headers: CORS });
  }

  if (!ticker) {
    return new Response(JSON.stringify({ ok: false, error: "ticker required" }), { status: 400, headers: CORS });
  }

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")             ?? "";
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")         ?? "";

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // ── Fetch company info ────────────────────────────────────────────────────

  const { data: company } = await db
    .from("companies")
    .select("ticker, name, sector, market")
    .eq("ticker", ticker)
    .maybeSingle();

  if (!company) {
    return new Response(JSON.stringify({ ok: false, error: "Company not found" }), { status: 404, headers: CORS });
  }

  // ── Sector gate ───────────────────────────────────────────────────────────

  if (!TECH_SECTORS.has(company.sector ?? "")) {
    return new Response(
      JSON.stringify({ ok: true, skipped: true, reason: "not_tech", sector: company.sector }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }

  // ── Fetch supporting data in parallel ────────────────────────────────────

  const [eventsRes, financialsRes] = await Promise.allSettled([
    db
      .from("company_events")
      .select("title, event_type, impact_score, published_at")
      .eq("ticker", ticker)
      .order("published_at", { ascending: false })
      .limit(10),
    db
      .from("company_financials")
      .select("period, revenue, net_income, ebitda, net_debt")
      .eq("ticker", ticker)
      .order("period", { ascending: false })
      .limit(4),
  ]);

  const events     = eventsRes.status     === "fulfilled" ? (eventsRes.value.data     ?? []) : [];
  const financials = financialsRes.status === "fulfilled" ? (financialsRes.value.data ?? []) : [];

  // ── Build context for Claude ──────────────────────────────────────────────

  const eventsText = events.length > 0
    ? events.map((e: { title: string; event_type: string | null; published_at: string | null }) =>
        `- [${e.event_type ?? "event"}] ${e.title} (${e.published_at?.slice(0, 10) ?? "?"})`,
      ).join("\n")
    : "Brak eventów.";

  const latest = financials[0] as {
    period: string; revenue: number | null; net_income: number | null;
    ebitda: number | null; net_debt: number | null;
  } | undefined;

  const financialsText = latest
    ? `Okres: ${latest.period}, Przychody: ${latest.revenue ?? "brak"}, Net Income: ${latest.net_income ?? "brak"}, EBITDA: ${latest.ebitda ?? "brak"}, Dług netto: ${latest.net_debt ?? "brak"}`
    : "Brak danych finansowych.";

  // ── Claude Sonnet call ────────────────────────────────────────────────────

  let moatResult: MoatResult;

  if (!anthropicKey) {
    // Fallback: neutral scores when no API key
    const neutral: MoatDimension = { score: 5, rationale: "Brak klucza API — ocena domyślna" };
    moatResult = {
      d1_network_effects:   neutral,
      d2_switching_costs:   neutral,
      d3_cost_advantages:   neutral,
      d4_intangible_assets: neutral,
      d5_efficient_scale:   neutral,
      d6_ai_disruption_risk:neutral,
      d7_data_moat:         neutral,
      overall_moat:         5.0,
      moat_strength:        "NARROW",
      summary:              "Brak klucza Anthropic — domyślna ocena.",
    };
  } else {
    const prompt = `Spółka: ${company.ticker} (${company.name}), sektor: ${company.sector}

Ostatnie eventy:
${eventsText}

Dane finansowe:
${financialsText}

Oceń 7 wymiarów MOAT w skali 1-10.
Zwróć TYLKO poprawny JSON (bez komentarzy, bez markdown):
{
  "d1_network_effects":   {"score": <1-10>, "rationale": "<po polsku, max 80 znaków>"},
  "d2_switching_costs":   {"score": <1-10>, "rationale": "<po polsku, max 80 znaków>"},
  "d3_cost_advantages":   {"score": <1-10>, "rationale": "<po polsku, max 80 znaków>"},
  "d4_intangible_assets": {"score": <1-10>, "rationale": "<po polsku, max 80 znaków>"},
  "d5_efficient_scale":   {"score": <1-10>, "rationale": "<po polsku, max 80 znaków>"},
  "d6_ai_disruption_risk":{"score": <1-10>, "rationale": "<po polsku, max 80 znaków>"},
  "d7_data_moat":         {"score": <1-10>, "rationale": "<po polsku, max 80 znaków>"},
  "overall_moat":         <number 1-10, średnia ważona D1=20% D2=20% D3=15% D4=15% D5=10% D6=10% D7=10%>,
  "moat_strength":        "WIDE"|"NARROW"|"NONE",
  "summary":              "<po polsku, max 200 znaków>"
}`;

    try {
      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method:  "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model:      "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: "Jesteś analitykiem technologicznym. Oceniasz przewagi konkurencyjne spółek tech. WAŻNE: Oceniaj tylko na podstawie dostarczonych danych. Nie wymyślaj faktów. Zwróć tylko poprawny JSON.",
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!aiRes.ok) throw new Error(`Anthropic ${aiRes.status}`);
      const aiData = await aiRes.json() as { content: Array<{ type: string; text: string }> };
      let raw = aiData.content.find((c) => c.type === "text")?.text ?? "{}";
      // Strip markdown fences if present
      raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      moatResult = JSON.parse(raw) as MoatResult;
    } catch (err) {
      console.error("[analyze-moat] AI call failed:", err);
      // Fallback on AI error
      const fb: MoatDimension = { score: 5, rationale: "Błąd AI — ocena domyślna" };
      moatResult = {
        d1_network_effects:   fb,
        d2_switching_costs:   fb,
        d3_cost_advantages:   fb,
        d4_intangible_assets: fb,
        d5_efficient_scale:   fb,
        d6_ai_disruption_risk:fb,
        d7_data_moat:         fb,
        overall_moat:         5.0,
        moat_strength:        "NARROW",
        summary:              "Błąd połączenia z AI — użyto wartości domyślnych.",
      };
    }
  }

  // ── Validate / clamp scores ───────────────────────────────────────────────

  function clamp(v: unknown): number {
    const n = Number(v);
    return isNaN(n) ? 5 : Math.max(1, Math.min(10, n));
  }

  const dimensions = {
    d1: clamp(moatResult.d1_network_effects?.score),
    d2: clamp(moatResult.d2_switching_costs?.score),
    d3: clamp(moatResult.d3_cost_advantages?.score),
    d4: clamp(moatResult.d4_intangible_assets?.score),
    d5: clamp(moatResult.d5_efficient_scale?.score),
    d6: clamp(moatResult.d6_ai_disruption_risk?.score),
    d7: clamp(moatResult.d7_data_moat?.score),
  };

  // Recompute overall with correct weights (don't trust AI arithmetic)
  const overall = Math.round(
    (dimensions.d1 * 0.20 +
     dimensions.d2 * 0.20 +
     dimensions.d3 * 0.15 +
     dimensions.d4 * 0.15 +
     dimensions.d5 * 0.10 +
     dimensions.d6 * 0.10 +
     dimensions.d7 * 0.10) * 10,
  ) / 10;

  const moat_strength: "WIDE" | "NARROW" | "NONE" =
    overall >= 7 ? "WIDE" : overall >= 4 ? "NARROW" : "NONE";

  const summary = (typeof moatResult.summary === "string" && moatResult.summary.length > 0)
    ? moatResult.summary.slice(0, 200)
    : `MOAT score: ${overall}/10`;

  // ── Upsert to company_kpis ────────────────────────────────────────────────

  const metadata = {
    dimensions: {
      d1_network_effects:   { score: dimensions.d1, rationale: moatResult.d1_network_effects?.rationale ?? "" },
      d2_switching_costs:   { score: dimensions.d2, rationale: moatResult.d2_switching_costs?.rationale ?? "" },
      d3_cost_advantages:   { score: dimensions.d3, rationale: moatResult.d3_cost_advantages?.rationale ?? "" },
      d4_intangible_assets: { score: dimensions.d4, rationale: moatResult.d4_intangible_assets?.rationale ?? "" },
      d5_efficient_scale:   { score: dimensions.d5, rationale: moatResult.d5_efficient_scale?.rationale ?? "" },
      d6_ai_disruption_risk:{ score: dimensions.d6, rationale: moatResult.d6_ai_disruption_risk?.rationale ?? "" },
      d7_data_moat:         { score: dimensions.d7, rationale: moatResult.d7_data_moat?.rationale ?? "" },
    },
    moat_strength,
    summary,
  };

  await db
    .from("company_kpis")
    .upsert(
      { ticker, kpi_type: "moat_score", value: overall, metadata, calculated_at: new Date().toISOString() },
      { onConflict: "ticker,kpi_type" },
    );

  // ── Telegram alert ────────────────────────────────────────────────────────

  const telegramToken  = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const telegramChatId = Deno.env.get("TELEGRAM_CHAT_ID")   ?? "";

  if (telegramToken && telegramChatId) {
    try {
      const msg = `🏰 *MOAT ANALYSIS*
📊 *${ticker}* — ${moat_strength}
⭐ Overall MOAT: ${overall}/10
🔗 Network Effects: ${dimensions.d1}/10
🔒 Switching Costs: ${dimensions.d2}/10
🤖 AI Risk: ${dimensions.d6}/10
📝 ${summary}`;

      await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ chat_id: telegramChatId, text: msg, parse_mode: "Markdown" }),
      });
    } catch (err) {
      console.warn("[analyze-moat] Telegram alert failed:", err);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, ticker, overall_moat: overall, moat_strength, summary, dimensions, metadata }),
    { headers: { ...CORS, "Content-Type": "application/json" } },
  );
});
