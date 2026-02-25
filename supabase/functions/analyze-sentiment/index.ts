// supabase/functions/analyze-sentiment/index.ts
// Analyzes sentiment for a given ticker based on recent company events.
//
// POST body: { ticker: string }
// Returns: { ok, ticker, score, label, summary, analyzed_at }
//
// Uses Claude Haiku (cheap) for sentiment classification.
// Deploy: supabase functions deploy analyze-sentiment --project-ref pftgmorsthoezhmojjpg

import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { createLogger }      from "../_shared/logger.ts";
import { callAnthropic }     from "../_shared/anthropic.ts";

const log = createLogger("analyze-sentiment");

// ─── CORS ─────────────────────────────────────────────────────────────────────

const CORS = {
  "Content-Type":                "application/json",
  "Access-Control-Allow-Origin": "*",
};

// ─── Sentiment prompt ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "Jesteś analitykiem sentymentu giełdowego. Analizujesz informacje korporacyjne spółek GPW.",
  "Odpowiadaj WYŁĄCZNIE w formacie JSON (bez komentarzy).",
  "Format: {",
  "  \"overall_score\": number (-1.0 do +1.0, gdzie -1=bardzo negatywny, 0=neutralny, +1=bardzo pozytywny),",
  "  \"overall_label\": \"BULLISH\" | \"NEUTRAL\" | \"BEARISH\",",
  "  \"news_analysis\": [{\"title\": string, \"sentiment\": \"positive\" | \"neutral\" | \"negative\"}],",
  "  \"summary\": string (1-2 zdania po polsku, konkretna ocena sentymentu)",
  "}",
].join(" ");

interface SentimentResult {
  overall_score:  number;
  overall_label:  "BULLISH" | "NEUTRAL" | "BEARISH";
  news_analysis:  Array<{ title: string; sentiment: "positive" | "neutral" | "negative" }>;
  summary:        string;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status:  204,
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  let body: { ticker?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), { status: 400, headers: CORS });
  }

  const ticker = (body.ticker ?? "").toUpperCase().trim();
  if (!ticker) {
    return new Response(JSON.stringify({ ok: false, error: "ticker required" }), { status: 400, headers: CORS });
  }

  log.info(`Analyzing sentiment for ${ticker}`);

  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: CORS },
    );
  }

  // Fetch last 10 events
  const { data: events, error: evErr } = await supabase
    .from("company_events")
    .select("title, event_type, published_at, impact_score")
    .eq("ticker", ticker)
    .order("published_at", { ascending: false })
    .limit(10);

  if (evErr) {
    return new Response(JSON.stringify({ ok: false, error: evErr.message }), { status: 500, headers: CORS });
  }

  if (!events || events.length === 0) {
    return new Response(
      JSON.stringify({ ok: false, error: `No events found for ${ticker}` }),
      { status: 404, headers: CORS },
    );
  }

  // Build event context
  const eventList = events
    .map(e => {
      const date = e.published_at ? e.published_at.slice(0, 10) : "n/d";
      return `[${date}] [${(e.event_type ?? "inne").toUpperCase()}] impact=${e.impact_score ?? "?"}/10: ${e.title}`;
    })
    .join("\n");

  const userMsg = `Spółka: ${ticker}\n\nOstatnie wydarzenia:\n${eventList}\n\nOcień sentyment rynkowy tej spółki.`;

  // Call Claude Haiku
  let result: SentimentResult;
  try {
    const raw = await callAnthropic("health_score", SYSTEM_PROMPT, [{ role: "user", content: userMsg }], 600);
    // Strip potential markdown code fences
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    result = JSON.parse(cleaned) as SentimentResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Claude Haiku failed:", msg);
    return new Response(JSON.stringify({ ok: false, error: `AI analysis failed: ${msg}` }), { status: 502, headers: CORS });
  }

  // Validate / clamp
  const score = Math.max(-1, Math.min(1, Number(result.overall_score) || 0));
  const label = ["BULLISH", "NEUTRAL", "BEARISH"].includes(result.overall_label)
    ? result.overall_label
    : "NEUTRAL";

  // Upsert to company_sentiment
  const { error: upsertErr } = await supabase
    .from("company_sentiment")
    .upsert({
      ticker,
      score,
      label,
      summary:     result.summary ?? "",
      raw_json:    result,
      analyzed_at: new Date().toISOString(),
    }, { onConflict: "ticker" });

  if (upsertErr) {
    log.error("Upsert error:", upsertErr.message);
    // Don't fail — return the result anyway
  }

  log.info(`Done: ${ticker} score=${score} label=${label}`);

  return new Response(
    JSON.stringify({
      ok:          true,
      ticker,
      score,
      label,
      summary:     result.summary ?? "",
      analyzed_at: new Date().toISOString(),
    }),
    { status: 200, headers: CORS },
  );
});
