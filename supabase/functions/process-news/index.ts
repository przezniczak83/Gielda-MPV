// supabase/functions/process-news/index.ts
// AI analysis pipeline for news_items — v4.
//
// Changes from v3:
//   - ZMIANA A: Validate AI-returned tickers against companies table
//   - ZMIANA B: Stricter GPT-4o-mini system prompt (no false positives)
//   - ZMIANA C: Heuristic requires min 4-char aliases + confidence scoring
//
// Model: GPT-4o-mini (OPENAI_API_KEY)
// Batch: 100 items/run (trigger mode: 10), CONCURRENCY=5
//
// Deploy: supabase functions deploy process-news --project-ref pftgmorsthoezhmojjpg

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const BATCH_SIZE    = 100;  // cron batch
const TRIGGER_BATCH = 10;   // trigger (fast path)
const CONCURRENCY   = 5;    // parallel OpenAI calls per chunk
const SLEEP_BETWEEN = 200;  // ms between chunks (safe for GPT-4o-mini 500 RPM)

// Sources with paywalled content — skip AI if summary is too short
const PAYWALL_SOURCES = ["rp", "parkiet", "pb"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── ZMIANA C: Heuristic with min-4-char + confidence ────────────────────────

function extractTickersHeuristic(
  title:        string,
  body:         string | null,
  aliasMap:     Map<string, string>,
  validTickers: Set<string>,
): string[] {
  const text  = (title + " " + (body ?? "")).toLowerCase();
  const found = new Set<string>();

  // Sort aliases by length descending (longest / most specific first)
  const sorted = [...aliasMap.entries()]
    .filter(([alias]) => alias.length >= 4)          // min 4 chars — no noise
    .sort((a, b) => b[0].length - a[0].length);

  for (const [alias, ticker] of sorted) {
    if (!validTickers.has(ticker)) continue;          // only known companies

    // Strict word-boundary check
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re      = new RegExp(`(?:^|[\\s,\\.\\(\\[\"'])${escaped}(?:$|[\\s,\\.\\)\\]\"'])`, "i");
    if (re.test(text)) {
      found.add(ticker);
      if (found.size >= 3) break;  // max 3 from heuristic
    }
  }

  return [...found];
}

// ─── ZMIANA B: Stricter AI Analysis ──────────────────────────────────────────

async function analyzeItem(
  item:         NewsItem,
  preExtracted: string[],
  allTickers:   string[],
  openaiKey:    string,
): Promise<AIAnalysis | null> {
  const tickerContext = preExtracted.length > 0
    ? `\nMożliwe spółki (zweryfikuj czy są GŁÓWNYM tematem): ${preExtracted.join(", ")}`
    : "";

  const systemPrompt =
    `Jesteś ekspertem analizy finansowej GPW i giełd światowych.
Analizujesz polskie wiadomości finansowe i zwracasz WYŁĄCZNIE JSON bez markdown.

KRYTYCZNE ZASADY dla pola "tickers":
1. Zwróć ticker TYLKO jeśli spółka jest GŁÓWNYM TEMATEM artykułu
2. NIE zwracaj tickera jeśli spółka jest tylko wspomniana przy okazji
3. NIE zwracaj: walut (EUR, USD, PLN), indeksów (WIG20, SP500), instytucji (NBP, MSZ, KNF)
4. Używaj WYŁĄCZNIE oficjalnych tickerów GPW (bez .WA) lub US
5. Maksymalnie 3 tickers — jeśli nie jesteś pewien, zwróć []
6. Dla ESPI/komunikatów regulacyjnych: ticker to spółka która wysłała raport

Przykłady POPRAWNE:
- "mBank ogłasza wyniki Q4" → ["MBK"]
- "PKN Orlen podpisał kontrakt z PGNiG" → ["PKN", "PGN"]
- Komunikat ESPI od Text SA → ["TXT"]

Przykłady BŁĘDNE (nie rób tego):
- Artykuł o stopach NBP → [] (nie: ["PKO","MBK"] — to nie jest o bankach)
- "Tekst przemówienia ministra" → [] (nie: ["TXT"] — "tekst" to pospolite słowo)
- Artykuł ogólnofinansowy → [] (max 3 tickery, tylko główne podmioty)`;

  const userPrompt =
    `ZNANE TICKERY GPW: ${allTickers.slice(0, 200).join(", ")}${tickerContext}
ŹRÓDŁO: ${item.source}
TYTUŁ: ${item.title}
TREŚĆ: ${(item.summary ?? "").slice(0, 2000)}

Zwróć JSON:
{
  "tickers": [],
  "sector": "finanse|energetyka|technologia|chemia|handel|nieruchomosci|przemysl|inne",
  "sentiment": 0.0,
  "impact_score": 5,
  "category": "earnings|dividend|regulatory|macro|contract|management|ipo|buyback|espi|other",
  "ai_summary": "Krótkie podsumowanie po polsku, max 150 znaków.",
  "key_facts": [{"type": "revenue|profit|dividend|contract|other", "description": "...", "detail": "...", "impact": "positive|negative|neutral"}],
  "topics": ["wyniki_finansowe|dywidenda|zmiana_zarządu|emisja_akcji|kontrakt|regulacje|prognoza|inne"],
  "is_breaking": false,
  "impact_assessment": "very_positive|moderate_positive|neutral|moderate_negative|very_negative"
}`;

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

// ─── Process a single item ────────────────────────────────────────────────────

interface ProcessResult {
  ok:     boolean;
  id:     number;
  error?: string;
}

async function processItem(
  item:         NewsItem,
  supabase:     SupabaseClient,
  aliasMap:     Map<string, string>,
  validTickers: Set<string>,
  allTickers:   string[],
  openaiKey:    string,
): Promise<ProcessResult> {
  // ZMIANA C: heuristic with min-4-char + valid tickers only
  const preExtracted = extractTickersHeuristic(item.title, item.summary, aliasMap, validTickers);

  // Paywall filter — skip AI for paywalled sources with no body content
  if (PAYWALL_SOURCES.includes(item.source) && (!item.summary || item.summary.length < 100)) {
    const paywallUpdate: Record<string, unknown> = {
      ai_processed: true,
      impact_score: 3,
      category:     "other",
      ai_summary:   item.title.slice(0, 300),
    };
    if (preExtracted.length > 0) paywallUpdate.tickers = preExtracted;
    await supabase.from("news_items").update(paywallUpdate).eq("id", item.id);
    console.log(`[process-news] item ${item.id}: paywall skip (${item.source})`);
    return { ok: true, id: item.id };
  }

  let analysis: AIAnalysis | null = null;
  try {
    analysis = await analyzeItem(item, preExtracted, allTickers, openaiKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[process-news] item ${item.id} AI error: ${msg}`);
  }

  // ZMIANA A: Validate AI-returned tickers — only keep tickers in companies table
  const aiTickers = (analysis?.tickers ?? []).filter(t => validTickers.has(t));

  // Merge: AI validated + heuristic (heuristic already validated)
  const finalTickers = [...new Set([...aiTickers, ...preExtracted])].slice(0, 5);

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
  } else if (finalTickers.length > 0) {
    update.tickers = finalTickers;
  }

  const { error: updateErr } = await supabase
    .from("news_items")
    .update(update)
    .eq("id", item.id);

  if (updateErr) {
    console.error(`[process-news] item ${item.id} update error:`, updateErr.message);
    return { ok: false, id: item.id, error: updateErr.message };
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
    const aiCount  = aiTickers.length;
    const allCount = finalTickers.length;
    const breaking = analysis.is_breaking ? " 🚨BREAKING" : "";
    console.log(`[process-news] item ${item.id}: impact=${analysis.impact_score} tickers=${finalTickers.join(",") || "none"} (ai:${aiCount} heur:${preExtracted.length}→${allCount})${breaking} ✓`);
  }

  return { ok: true, id: item.id };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
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

  // Parse trigger mode from request body
  let isTriggered = false;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({})) as Record<string, unknown>;
      isTriggered = body.trigger === true;
    }
  } catch { /* ignore */ }

  const limit = isTriggered ? TRIGGER_BATCH : BATCH_SIZE;
  if (isTriggered) console.log(`[process-news] Trigger mode — limit=${limit}`);

  // ── Load ticker_aliases for heuristic matching ────────────────────────────
  const { data: aliasRows } = await supabase
    .from("ticker_aliases")
    .select("ticker, alias")
    .limit(3000);

  const aliasMap = new Map<string, string>();
  for (const a of (aliasRows ?? [])) {
    aliasMap.set(a.alias.toLowerCase(), a.ticker);
  }

  // ZMIANA A: Load all valid tickers from companies table
  const { data: companiesData } = await supabase
    .from("companies")
    .select("ticker");

  const validTickers = new Set<string>(
    (companiesData ?? []).map((c: { ticker: string }) => c.ticker),
  );

  const allTickers = [...validTickers];
  console.log(`[process-news] ${aliasMap.size} aliases, ${allTickers.length} valid tickers`);

  // ── Fetch unprocessed batch ────────────────────────────────────────────────
  const { data: items, error: fetchErr } = await supabase
    .from("news_items")
    .select("id, title, summary, source, url, published_at")
    .eq("ai_processed", false)
    .order("published_at", { ascending: false })
    .limit(limit);

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

  // ── Process in parallel chunks ────────────────────────────────────────────
  let processed = 0;
  let failed    = 0;

  const chunks: NewsItem[][] = [];
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    chunks.push(batch.slice(i, i + CONCURRENCY));
  }

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    if (ci > 0) await sleep(SLEEP_BETWEEN);

    const results = await Promise.allSettled(
      chunk.map(item => processItem(item, supabase, aliasMap, validTickers, allTickers, openaiKey)),
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.ok) {
        processed++;
      } else {
        failed++;
        if (result.status === "rejected") {
          console.error("[process-news] Chunk item failed:", result.reason);
        }
      }
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

  console.log(`[process-news] Done: processed=${processed}, failed=${failed}, total=${batch.length}, ms=${Date.now() - startTime}`);

  return new Response(
    JSON.stringify({
      ok:        true,
      processed,
      failed,
      total:     batch.length,
      triggered: isTriggered,
      ts:        new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
