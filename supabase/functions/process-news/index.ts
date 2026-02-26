// supabase/functions/process-news/index.ts
// AI analysis pipeline for news_items — v2.
//
// Changes from v1:
//   - Loads ticker_aliases for better heuristic pre-extraction
//   - Extended AI prompt: key_facts, topics, is_breaking, impact_assessment
//   - Updates companies.last_news_at for matched tickers
//   - Writes ingestion_log after each batch
//
// Model: GPT-4o-mini (OPENAI_API_KEY)
// Batch: 20 items/run, 200ms between OpenAI calls
//
// Deploy: supabase functions deploy process-news --project-ref pftgmorsthoezhmojjpg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NewsItem {
  id:       number;
  title:    string;
  summary:  string | null;
  source:   string;
  url:      string;
  published_at: string | null;
}

interface KeyFact {
  type:        string;
  description: string;
  detail?:     string;
  impact:      "positive" | "negative" | "neutral";
}

interface AIAnalysis {
  tickers:           string[];
  sector:            string | null;
  sentiment:         number;
  impact_score:      number;
  category:          string;
  ai_summary:        string;
  key_facts:         KeyFact[];
  topics:            string[];
  is_breaking:       boolean;
  impact_assessment: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BATCH_SIZE    = 20;
const SLEEP_BETWEEN = 200; // ms between OpenAI calls

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Heuristic ticker extraction ─────────────────────────────────────────────

function extractTickersHeuristic(
  title:    string,
  body:     string | null,
  aliasMap: Map<string, string>,
): string[] {
  const text     = (title + " " + (body ?? "")).toLowerCase();
  const found    = new Set<string>();

  // Sort aliases by length (longest first) to avoid partial matches
  const sorted = [...aliasMap.keys()].sort((a, b) => b.length - a.length);

  for (const alias of sorted) {
    if (alias.length < 3) continue; // skip very short aliases (noise)
    // Word-boundary check: alias must be preceded and followed by non-word char
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(text)) {
      found.add(aliasMap.get(alias)!);
      if (found.size >= 5) break;
    }
  }

  return [...found];
}

// ─── AI Analysis ──────────────────────────────────────────────────────────────

async function analyzeItem(
  item:               NewsItem,
  preExtracted:       string[],
  allTickers:         string[],
  openaiKey:          string,
): Promise<AIAnalysis | null> {
  const systemPrompt =
    `Jesteś analitykiem rynku kapitałowego GPW. ` +
    `Analizujesz polskie wiadomości finansowe i zwracasz ustrukturyzowane dane JSON. ` +
    `Odpowiadasz WYŁĄCZNIE JSON, bez żadnego tekstu przed ani po.`;

  const userPrompt =
    `TICKER KONTEKST: ${preExtracted.join(", ") || "brak"}
ZNANE TICKERY GPW: ${allTickers.slice(0, 200).join(", ")}
ŹRÓDŁO: ${item.source}
TYTUŁ: ${item.title}
TREŚĆ: ${(item.summary ?? "").slice(0, 2000)}

Zwróć JSON:
{
  "tickers": ["PKN"],
  "sector": "energy",
  "sentiment": 0.7,
  "impact_score": 7,
  "category": "earnings",
  "ai_summary": "PKN Orlen ogłosił wyniki Q4 2025 z zyskiem 2.1 mld zł, powyżej oczekiwań.",
  "key_facts": [
    {
      "type": "revenue",
      "description": "Przychody Q4 2025 wyniosły 45 mld zł",
      "detail": "+8% r/r",
      "impact": "positive"
    }
  ],
  "topics": ["wyniki_finansowe"],
  "is_breaking": false,
  "impact_assessment": "moderate_positive"
}

TYPY key_facts: revenue|profit|ebitda|dividend|ceo_change|board_change|share_issue|buyback|acquisition|contract|regulatory|guidance|rating_change|nwz|other
TYPY topics: wyniki_finansowe|dywidenda|zmiana_zarządu|emisja_akcji|skup_akcji|fuzja_przejęcie|kontrakt|regulacje|prognoza|rekomendacja|walne_zgromadzenie|debiut|inne
is_breaking: true gdy przełomowe (duży kontrakt >100mln PLN, M&A, zmiana CEO, wyniki znacznie vs konsensus)
impact_assessment: very_positive|moderate_positive|neutral|moderate_negative|very_negative
tickers: [] jeśli makro/ogólne, max 5 tickerów`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model:           "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      max_tokens:      500,
      temperature:     0.1,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  const raw = data.choices?.[0]?.message?.content ?? "{}";

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`JSON parse failed: ${raw.slice(0, 100)}`);
  }

  // Sanitize key_facts
  const rawFacts = Array.isArray(parsed.key_facts) ? parsed.key_facts : [];
  const key_facts: KeyFact[] = rawFacts.slice(0, 10).map((f: Record<string, unknown>) => ({
    type:        typeof f.type        === "string" ? f.type        : "other",
    description: typeof f.description === "string" ? f.description.slice(0, 200) : "",
    detail:      typeof f.detail      === "string" ? f.detail.slice(0, 100) : undefined,
    impact: (["positive", "negative", "neutral"] as const).includes(f.impact as "positive" | "negative" | "neutral")
      ? (f.impact as "positive" | "negative" | "neutral")
      : "neutral",
  })).filter(f => f.description.length > 0);

  return {
    tickers:      Array.isArray(parsed.tickers) ? (parsed.tickers as string[]).slice(0, 10) : [],
    sector:       typeof parsed.sector           === "string" ? parsed.sector : null,
    sentiment:    typeof parsed.sentiment        === "number"
      ? Math.max(-1, Math.min(1, parsed.sentiment)) : 0,
    impact_score: typeof parsed.impact_score     === "number"
      ? Math.max(1, Math.min(10, Math.round(parsed.impact_score as number))) : 5,
    category:         typeof parsed.category          === "string" ? parsed.category         : "other",
    ai_summary:       typeof parsed.ai_summary         === "string" ? parsed.ai_summary.slice(0, 500) : "",
    impact_assessment:typeof parsed.impact_assessment  === "string" ? parsed.impact_assessment : "neutral",
    is_breaking:      parsed.is_breaking === true,
    key_facts,
    topics: Array.isArray(parsed.topics) ? (parsed.topics as string[]).slice(0, 10) : [],
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  const startTime = Date.now();
  console.log("[process-news] Invoked at:", new Date().toISOString());

  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!openaiKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "OPENAI_API_KEY not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")              ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // ── Load ticker_aliases for heuristic matching ────────────────────────────
  const { data: aliasRows } = await supabase
    .from("ticker_aliases")
    .select("ticker, alias")
    .limit(3000);

  const aliasMap = new Map<string, string>();
  for (const a of (aliasRows ?? [])) {
    aliasMap.set(a.alias.toLowerCase(), a.ticker);
  }

  const allTickers = [...new Set((aliasRows ?? []).map(a => a.ticker))];
  console.log(`[process-news] ${aliasMap.size} aliases, ${allTickers.length} tickers loaded`);

  // ── Fetch unprocessed batch ────────────────────────────────────────────────
  const { data: items, error: fetchErr } = await supabase
    .from("news_items")
    .select("id, title, summary, source, url, published_at")
    .eq("ai_processed", false)
    .order("published_at", { ascending: false })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    return new Response(
      JSON.stringify({ ok: false, error: fetchErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const batch = (items ?? []) as NewsItem[];
  console.log(`[process-news] ${batch.length} unprocessed items to analyze`);

  if (batch.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, processed: 0, failed: 0, ts: new Date().toISOString() }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── Process each item ─────────────────────────────────────────────────────
  let processed = 0;
  let failed    = 0;

  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    if (i > 0) await sleep(SLEEP_BETWEEN);

    // Heuristic pre-extraction using alias map
    const preExtracted = extractTickersHeuristic(item.title, item.summary, aliasMap);

    let analysis: AIAnalysis | null = null;
    try {
      analysis = await analyzeItem(item, preExtracted, allTickers, openaiKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[process-news] item ${item.id} AI error: ${msg}`);
      failed++;
    }

    // Merge heuristic tickers into AI result
    const finalTickers = analysis
      ? [...new Set([...analysis.tickers, ...preExtracted])].slice(0, 10)
      : preExtracted;

    // Update news_items (always mark processed to prevent infinite retry)
    const update: Record<string, unknown> = { ai_processed: true };
    if (analysis) {
      update.tickers           = finalTickers;
      update.sector            = analysis.sector;
      update.sentiment         = analysis.sentiment;
      update.impact_score      = analysis.impact_score;
      update.category          = analysis.category;
      update.ai_summary        = analysis.ai_summary;
      update.key_facts         = analysis.key_facts;
      update.topics            = analysis.topics;
      update.is_breaking       = analysis.is_breaking;
      update.impact_assessment = analysis.impact_assessment;
    } else if (preExtracted.length > 0) {
      update.tickers = preExtracted;
    }

    const { error: updateErr } = await supabase
      .from("news_items")
      .update(update)
      .eq("id", item.id);

    if (updateErr) {
      console.error(`[process-news] item ${item.id} update error:`, updateErr.message);
      failed++;
      continue;
    }

    // Update companies.last_news_at for matched tickers
    if (finalTickers.length > 0) {
      const newsAt = item.published_at ?? new Date().toISOString();
      for (const ticker of finalTickers) {
        await supabase
          .from("companies")
          .update({ last_news_at: newsAt })
          .eq("ticker", ticker)
          .or(`last_news_at.is.null,last_news_at.lt.${newsAt}`);
      }
    }

    if (analysis) {
      const breaking = analysis.is_breaking ? " 🚨BREAKING" : "";
      console.log(`[process-news] item ${item.id}: impact=${analysis.impact_score} tickers=${finalTickers.join(",") || "none"}${breaking} ✓`);
      processed++;
    }
  }

  // ── Write ingestion_log ───────────────────────────────────────────────────
  await supabase.from("ingestion_log").insert({
    source_name:      "process-news",
    status:           failed === 0 ? "success" : "partial_failure",
    messages_fetched: batch.length,
    messages_new:     processed,
    messages_failed:  failed,
    finished_at:      new Date().toISOString(),
    duration_ms:      Date.now() - startTime,
  });

  console.log(`[process-news] Done: processed=${processed}, failed=${failed}, ms=${Date.now() - startTime}`);

  return new Response(
    JSON.stringify({
      ok:        true,
      processed,
      failed,
      total:     batch.length,
      ts:        new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
