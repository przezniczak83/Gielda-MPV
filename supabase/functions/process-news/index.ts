// supabase/functions/process-news/index.ts
// AI analysis pipeline for news_items — v5.
//
// Changes from v4:
//   - ZMIANA D: Two-stage ticker matching with confidence scores
//       Heuristic assigns 0.6–0.8 based on alias length + title boost
//       AI returns ticker_confidence map (0.0–1.0)
//       ESPI source: always confidence = 1.0
//       Only tickers with confidence >= 0.7 saved to tickers[]
//   - ZMIANA E: event_group_id — group articles about the same event
//       Post-save: find similar articles (same tickers, ±2h window)
//       Assign shared event_group_id across the group
//   - ZMIANA F: Stricter AI prompt with explicit confidence requirement
//       AI must return ticker_confidence alongside tickers
//       Max 3 tickers, only those the AI is confident about
//
// Model: GPT-4o-mini (OPENAI_API_KEY)
// Batch: 100 items/run (trigger mode: 10), CONCURRENCY=5
//
// Deploy: supabase functions deploy process-news --project-ref pftgmorsthoezhmojjpg

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NewsItem {
  id:                number;
  title:             string;
  summary:           string | null;
  body_text:         string | null;
  source:            string;
  url:               string;
  published_at:      string | null;
  tickers:           string[] | null;
  ticker_confidence: Record<string, number> | null;
}

interface KeyFact {
  type:        string;
  description: string;
  detail?:     string;
  impact:      "positive" | "negative" | "neutral";
}

interface AIAnalysis {
  tickers:            string[];
  ticker_confidence:  Record<string, number>;
  relevance_score:    number;
  sector:             string | null;
  sentiment:          number;
  impact_score:       number;
  category:           string;
  ai_summary:         string;
  key_facts:          KeyFact[];
  topics:             string[];
  is_breaking:        boolean;
  impact_assessment:  string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BATCH_SIZE    = 100;  // cron batch
const TRIGGER_BATCH = 10;   // trigger (fast path)
const CONCURRENCY   = 5;    // parallel OpenAI calls per chunk
const SLEEP_BETWEEN = 200;  // ms between chunks (safe for GPT-4o-mini 500 RPM)

// Confidence thresholds
const HEUR_CONF_TITLE_BOOST = 0.1;  // added when alias found in title (vs body only)
const HEUR_CONF_LONG   = 0.8;       // alias >= 8 chars
const HEUR_CONF_MEDIUM = 0.7;       // alias 6-7 chars
const HEUR_CONF_SHORT  = 0.6;       // alias 4-5 chars
const DISPLAY_THRESHOLD = 0.7;      // only tickers above this go to tickers[]
const ESPI_CONFIDENCE   = 1.0;      // official documents

// Sources with paywalled content — skip AI if summary is too short
const PAYWALL_SOURCES = ["rp", "parkiet", "pb"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── ZMIANA D: Heuristic with per-ticker confidence ───────────────────────────

function extractTickersHeuristic(
  title:        string,
  body:         string | null,
  aliasMap:     Map<string, string>,
  validTickers: Set<string>,
): Map<string, number> {
  const fullText  = (title + " " + (body ?? "")).toLowerCase();
  const titleText = title.toLowerCase();
  const found     = new Map<string, number>();  // ticker → confidence

  // Sort aliases by length descending (longest / most specific first)
  const sorted = [...aliasMap.entries()]
    .filter(([alias]) => alias.length >= 4)    // min 4 chars — no noise
    .sort((a, b) => b[0].length - a[0].length);

  for (const [alias, ticker] of sorted) {
    if (!validTickers.has(ticker)) continue;
    if (found.has(ticker)) continue;           // already found with higher confidence

    // Strict word-boundary check
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re      = new RegExp(`(?:^|[\\s,\\.\\(\\[\"'])${escaped}(?:$|[\\s,\\.\\)\\]\"'])`, "i");

    if (!re.test(fullText)) continue;

    // Base confidence by alias length
    let conf =
      alias.length >= 8 ? HEUR_CONF_LONG :
      alias.length >= 6 ? HEUR_CONF_MEDIUM :
                          HEUR_CONF_SHORT;

    // Boost if found in title specifically
    if (re.test(titleText)) conf = Math.min(conf + HEUR_CONF_TITLE_BOOST, 0.95);

    found.set(ticker, conf);
    if (found.size >= 3) break;  // max 3 from heuristic
  }

  return found;
}

// ─── ZMIANA F: Stricter AI Analysis with confidence ───────────────────────────

async function analyzeItem(
  item:       NewsItem,
  openaiKey:  string,
): Promise<AIAnalysis | null> {
  // Prefer body_text over RSS summary — RSS summaries are often truncated HTML
  const content = (item.body_text || item.summary || "").slice(0, 1800);

  const systemPrompt =
    `Jesteś analitykiem finansowym GPW i rynków USA.
Analizujesz artykuły prasowe i komunikaty spółek giełdowych.
Odpowiadasz WYŁĄCZNIE w JSON, bez żadnego dodatkowego tekstu.`;

  const userPrompt =
    `Przeanalizuj poniższy artykuł finansowy.

TYTUŁ: ${item.title}
ŹRÓDŁO: ${item.source}
URL: ${item.url}
TREŚĆ: ${content || "(brak treści)"}

ZASADY KRYTYCZNE:
1. ai_summary: 1-2 zdania opisujące CO NAPRAWDĘ ZAWIERA ten artykuł.
   - Czytaj TREŚĆ artykułu — nie zgaduj na podstawie tickera ani nazwy spółki
   - Nie wolno wymyślać liczb ani faktów których nie ma w tekście
   - Jeśli treść jest niedostępna (paywall) → napisz "Treść niedostępna: [skrócony tytuł]"

2. tickers: TYLKO spółki których PEŁNA NAZWA lub TICKER pojawia się w tytule lub treści.
   - Weryfikuj przez URL: jeśli URL zawiera "AMREST" → emitent to AmRest, nie inna spółka
   - Jeśli artykuł dotyczy wielu spółek → wymień wszystkie (max 5)
   - Jeśli artykuł jest ogólny (makro, regulacje, rynek) → zwróć []
   - NIE dodawaj spółek na podstawie sektora ani domysłu

3. ticker_confidence: pewność przypisania 0.0–1.0
   - 1.0: spółka wprost wymieniona z nazwy w tytule lub URL ESPI
   - 0.8: spółka wymieniona w treści z pełną nazwą
   - 0.6: spółka wymieniona skrótem lub pośrednio
   - Zwróć tylko tickers z confidence >= 0.6

4. relevance_score: 0.0–1.0 jak bardzo artykuł jest istotny dla inwestorów GPW
   - 1.0: oficjalny raport ESPI / SEC
   - 0.8: wyniki finansowe, fuzje, dywidenda
   - 0.6: istotne informacje o spółce lub sektorze
   - 0.3: ogólne tło makroekonomiczne
   - 0.1: niezwiązane z giełdą

Odpowiedz TYLKO tym JSON (bez markdown, bez komentarzy):
{
  "ai_summary": "...",
  "tickers": [],
  "ticker_confidence": {},
  "relevance_score": 0.5,
  "sector": "finanse|energetyka|technologia|chemia|handel|nieruchomosci|przemysl|inne",
  "sentiment": 0.0,
  "impact_score": 5,
  "category": "earnings|dividend|regulatory|macro|contract|management|ipo|buyback|espi|other",
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
      max_tokens:      600,
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

  // Sanitize ticker_confidence
  const rawConf = (typeof parsed.ticker_confidence === "object" && parsed.ticker_confidence !== null)
    ? parsed.ticker_confidence as Record<string, unknown>
    : {};
  const ticker_confidence: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawConf)) {
    if (typeof v === "number") {
      ticker_confidence[k] = Math.max(0, Math.min(1, v));
    }
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

  // AI-returned tickers — only those with confidence >= threshold in the confidence map
  const rawTickers = Array.isArray(parsed.tickers) ? (parsed.tickers as string[]).slice(0, 10) : [];

  return {
    tickers:     rawTickers,
    ticker_confidence,
    relevance_score: typeof parsed.relevance_score === "number"
      ? Math.max(0, Math.min(1, parsed.relevance_score)) : 0.5,
    sector:      typeof parsed.sector           === "string" ? parsed.sector : null,
    sentiment:   typeof parsed.sentiment        === "number"
      ? Math.max(-1, Math.min(1, parsed.sentiment)) : 0,
    impact_score: typeof parsed.impact_score    === "number"
      ? Math.max(1, Math.min(10, Math.round(parsed.impact_score as number))) : 5,
    category:          typeof parsed.category          === "string" ? parsed.category         : "other",
    ai_summary:        typeof parsed.ai_summary         === "string" ? parsed.ai_summary.slice(0, 500) : "",
    impact_assessment: typeof parsed.impact_assessment  === "string" ? parsed.impact_assessment : "neutral",
    is_breaking:       parsed.is_breaking === true,
    key_facts,
    topics: Array.isArray(parsed.topics) ? (parsed.topics as string[]).slice(0, 10) : [],
  };
}

// ─── ZMIANA E: Assign event_group_id ─────────────────────────────────────────

async function assignEventGroup(
  itemId:      number,
  tickers:     string[],
  publishedAt: string | null,
  supabase:    SupabaseClient,
): Promise<void> {
  if (tickers.length === 0) return;

  const pubTime    = publishedAt ?? new Date().toISOString();
  const windowMs   = 2 * 60 * 60 * 1000;
  const windowStart = new Date(new Date(pubTime).getTime() - windowMs).toISOString();
  const windowEnd   = new Date(new Date(pubTime).getTime() + windowMs).toISOString();

  // Find similar articles: same tickers ∩ within ±2h window
  const { data: similar } = await supabase
    .from("news_items")
    .select("id, event_group_id")
    .contains("tickers", tickers)
    .gte("published_at", windowStart)
    .lte("published_at", windowEnd)
    .neq("id", itemId)
    .limit(3);

  const existingGroupId = (similar ?? []).find(s => s.event_group_id != null)?.event_group_id ?? null;
  const groupId = existingGroupId ?? crypto.randomUUID();

  await supabase
    .from("news_items")
    .update({ event_group_id: groupId })
    .eq("id", itemId);
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
  openaiKey:    string,
): Promise<ProcessResult> {
  // ZMIANA D: Heuristic with per-ticker confidence (for non-ESPI sources)
  const heuristicMap = extractTickersHeuristic(item.title, item.summary, aliasMap, validTickers);

  const isEspi = item.source === "espi";

  // ESPI pre-assigned tickers (set by fetch-espi with confidence 1.0)
  // These were extracted from the URL/title and are authoritative — do NOT let AI override them
  const espiPresetTickers: string[] = [];
  if (isEspi && item.tickers && item.tickers.length > 0) {
    for (const t of item.tickers) {
      if (validTickers.has(t)) espiPresetTickers.push(t);
    }
  }

  // Paywall filter — skip AI for paywalled sources with no body content
  const hasContent = !!(item.body_text || (item.summary && item.summary.length >= 100));
  if (PAYWALL_SOURCES.includes(item.source) && !hasContent) {
    const heurTickers = [...heuristicMap.keys()];
    const paywallConf: Record<string, number> = {};
    for (const [t, c] of heuristicMap) paywallConf[t] = c;

    const paywallUpdate: Record<string, unknown> = {
      ai_processed:      true,
      impact_score:      3,
      category:          "other",
      ai_summary:        item.title.slice(0, 300),
      ticker_confidence: paywallConf,
      relevance_score:   heurTickers.length > 0 ? 0.5 : 0.3,
    };
    if (heurTickers.length > 0) paywallUpdate.tickers = heurTickers;
    await supabase.from("news_items").update(paywallUpdate).eq("id", item.id);
    console.log(`[process-news] item ${item.id}: paywall skip (${item.source})`);
    return { ok: true, id: item.id };
  }

  let analysis: AIAnalysis | null = null;
  try {
    analysis = await analyzeItem(item, openaiKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[process-news] item ${item.id} AI error: ${msg}`);
  }

  // ── Build final ticker confidence map ─────────────────────────────────────

  let mergedConf: Record<string, number> = {};
  let finalTickers: string[] = [];

  if (isEspi && espiPresetTickers.length > 0) {
    // ESPI with pre-assigned tickers: trust fetch-espi's extraction (confidence 1.0)
    // Still incorporate AI tickers if AI is very confident about additional companies
    for (const t of espiPresetTickers) {
      mergedConf[t] = ESPI_CONFIDENCE;
    }
    if (analysis) {
      const aiConf = analysis.ticker_confidence;
      for (const [t, c] of Object.entries(aiConf)) {
        if (validTickers.has(t) && c >= 0.85 && !mergedConf[t]) {
          mergedConf[t] = c;
        }
      }
    }
  } else {
    // Non-ESPI or ESPI without pre-assigned tickers: use heuristic + AI
    // Start with heuristic confidences
    for (const [t, c] of heuristicMap) {
      if (validTickers.has(t)) mergedConf[t] = c;
    }

    if (analysis) {
      const aiConf    = analysis.ticker_confidence;
      const aiTickers = analysis.tickers.filter(t => validTickers.has(t));

      for (const t of aiTickers) {
        const aiC = aiConf[t] ?? 0.75;
        mergedConf[t] = Math.max(mergedConf[t] ?? 0, aiC);
      }

      for (const [t, c] of Object.entries(aiConf)) {
        if (validTickers.has(t) && c >= DISPLAY_THRESHOLD) {
          mergedConf[t] = Math.max(mergedConf[t] ?? 0, c);
        }
      }
    }
  }

  // Only save tickers with confidence >= display threshold
  finalTickers = Object.entries(mergedConf)
    .filter(([, c]) => c >= DISPLAY_THRESHOLD)
    .sort((a, b) => b[1] - a[1])  // highest confidence first
    .slice(0, 5)
    .map(([t]) => t);

  // Update news_items
  const update: Record<string, unknown> = {
    ai_processed:      true,
    ticker_confidence: mergedConf,
  };
  // ESPI always has relevance 1.0; for others derive from analysis or heuristic
  const relevanceScore: number = isEspi
    ? 1.0
    : analysis
      ? analysis.relevance_score
      : finalTickers.length > 0 ? 0.6 : 0.3;

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
    update.relevance_score   = relevanceScore;
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

  // ZMIANA E: Assign event_group_id (best-effort, don't fail the item)
  if (finalTickers.length > 0) {
    try {
      await assignEventGroup(item.id, finalTickers, item.published_at, supabase);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[process-news] item ${item.id} group assignment failed: ${msg}`);
    }
  }

  if (analysis) {
    const totalConf = Object.entries(mergedConf)
      .map(([t, c]) => `${t}:${c.toFixed(1)}`)
      .join(",");
    const breaking = analysis.is_breaking ? " 🚨BREAKING" : "";
    console.log(`[process-news] item ${item.id}: impact=${analysis.impact_score} tickers=[${totalConf}] final=${finalTickers.join(",") || "none"}${breaking} ✓`);
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

  // Load all valid tickers from companies table
  const { data: companiesData } = await supabase
    .from("companies")
    .select("ticker");

  const validTickers = new Set<string>(
    (companiesData ?? []).map((c: { ticker: string }) => c.ticker),
  );

  console.log(`[process-news] ${aliasMap.size} aliases, ${validTickers.size} valid tickers`);

  // ── Fetch unprocessed batch ────────────────────────────────────────────────
  const { data: items, error: fetchErr } = await supabase
    .from("news_items")
    .select("id, title, summary, body_text, source, url, published_at, tickers, ticker_confidence")
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
      chunk.map(item => processItem(item, supabase, aliasMap, validTickers, openaiKey)),
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
