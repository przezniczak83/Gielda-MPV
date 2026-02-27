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
import {
  matchTickersDeterministic,
  preloadMatcherCache,
  type MatchEvidence,
} from "./ticker-matcher.ts";

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

// ─── Evidence types ───────────────────────────────────────────────────────────

interface TickerEvidence {
  alias:    string;
  ticker:   string;
  source:   "title" | "body";
  position: number;
}

interface DeterministicMatch {
  ticker:     string;
  confidence: number;
  evidence:   TickerEvidence[];
}

// ─── ETAP 3: Deterministic ticker matcher (word-boundary regex) ──────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Deterministic matcher using strict word-boundary regex.
 *  Returns matches sorted by confidence descending.
 *  When confidence >= 0.85 for at least one ticker, AI should skip ticker
 *  identification and only generate summary/sentiment/impact.
 */
function deterministicMatch(
  title:        string,
  body:         string | null,
  aliasMap:     Map<string, string>,
  validTickers: Set<string>,
): DeterministicMatch[] {
  const titleLower = title.toLowerCase();
  const bodyLower  = (body ?? "").toLowerCase();
  const matchMap   = new Map<string, DeterministicMatch>();

  // Sort aliases by length descending (longest / most specific first)
  const sorted = [...aliasMap.entries()]
    .filter(([alias]) => alias.length >= 4)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [alias, ticker] of sorted) {
    if (!validTickers.has(ticker)) continue;

    const escaped = escapeRegex(alias);
    const re      = new RegExp(`\\b${escaped}\\b`, "gi");

    const titleMatches = [...titleLower.matchAll(re)];
    const bodyMatches  = [...bodyLower.matchAll(re)];

    if (titleMatches.length === 0 && bodyMatches.length === 0) continue;

    const existing = matchMap.get(ticker);

    // Confidence: title match = 0.9, body only = 0.7; boost for long alias
    let confidence = titleMatches.length > 0
      ? (alias.length >= 8 ? 0.92 : alias.length >= 6 ? 0.90 : 0.85)
      : (alias.length >= 8 ? 0.75 : alias.length >= 6 ? 0.72 : 0.68);

    const evidence: TickerEvidence[] = [
      ...titleMatches.map(m => ({ alias, ticker, source: "title" as const, position: m.index ?? 0 })),
      ...bodyMatches.map(m =>  ({ alias, ticker, source: "body"  as const, position: m.index ?? 0 })),
    ];

    if (!existing || confidence > existing.confidence) {
      matchMap.set(ticker, { ticker, confidence, evidence });
    }

    if (matchMap.size >= 5) break;  // max 5 from deterministic
  }

  return [...matchMap.values()].sort((a, b) => b.confidence - a.confidence);
}

// ─── ZMIANA D: Heuristic alias (kept for compatibility, now wraps deterministicMatch) ───

function extractTickersHeuristic(
  title:        string,
  body:         string | null,
  aliasMap:     Map<string, string>,
  validTickers: Set<string>,
): Map<string, number> {
  const matches = deterministicMatch(title, body, aliasMap, validTickers);
  const result  = new Map<string, number>();
  for (const m of matches.slice(0, 3)) {
    result.set(m.ticker, m.confidence);
  }
  return result;
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

// ─── Generic summary templates (detect hallucinated summaries) ────────────────

const GENERIC_TEMPLATES = [
  "ogłosił wyniki q",
  "poinformowała o wynikach",
  "podała do wiadomości",
  "spółka poinformowała",
  "zarząd spółki poinformował",
];

async function processItem(
  item:         NewsItem,
  supabase:     SupabaseClient,
  aliasMap:     Map<string, string>,
  validTickers: Set<string>,
  openaiKey:    string,
): Promise<ProcessResult> {
  const isEspi = item.source === "espi";

  // ── Step 0: ESPI preset check ─────────────────────────────────────────────
  // If fetch-espi already assigned tickers with confidence 1.0, preserve them.
  const hasEspiPreset = isEspi &&
    item.tickers && item.tickers.length > 0 &&
    item.ticker_confidence != null &&
    Object.values(item.ticker_confidence).some(v => v === ESPI_CONFIDENCE);

  // ── Step 1: 3-layer deterministic ticker matcher ──────────────────────────
  // Runs BEFORE AI on every article. Uses module-level cache (loaded once per batch).
  const detResult = await matchTickersDeterministic(
    item.title,
    item.body_text ?? item.summary ?? "",
    supabase,
  );

  const isDeterministic = !hasEspiPreset && detResult.method === "deterministic";

  // ── Paywall filter — skip AI for paywalled sources with no body ────────────
  const hasContent = !!(item.body_text || (item.summary && item.summary.length >= 100));
  if (PAYWALL_SOURCES.includes(item.source) && !hasContent) {
    const paywallTickers = isDeterministic ? detResult.tickers : [];
    const paywallConf    = isDeterministic ? detResult.confidence : {};

    const paywallUpdate: Record<string, unknown> = {
      ai_processed:      true,
      impact_score:      3,
      category:          "other",
      ai_summary:        item.title.slice(0, 300),
      ticker_confidence: paywallConf,
      relevance_score:   paywallTickers.length > 0 ? 0.5 : 0.3,
      ticker_method:     paywallTickers.length > 0 ? "deterministic" : null,
      ticker_evidence:   detResult.evidence.slice(0, 20),
      ticker_version:    2,
    };
    if (paywallTickers.length > 0) paywallUpdate.tickers = paywallTickers;

    await supabase.from("news_items").update(paywallUpdate).eq("id", item.id);
    console.log(`[process-news] item ${item.id}: paywall skip (${item.source}) tickers=[${paywallTickers.join(",")}]`);
    return { ok: true, id: item.id };
  }

  // ── Step 2: AI analysis (always runs — for summary, sentiment, impact, etc.) ─
  let analysis: AIAnalysis | null = null;
  try {
    analysis = await analyzeItem(item, openaiKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[process-news] item ${item.id} AI error: ${msg}`);
  }

  // ── Step 3: Validate + clamp AI output ───────────────────────────────────
  if (analysis) {
    analysis.tickers = analysis.tickers.filter(t => validTickers.has(t));
    const validatedConf: Record<string, number> = {};
    for (const [t, c] of Object.entries(analysis.ticker_confidence)) {
      if (validTickers.has(t)) validatedConf[t] = Math.max(0, Math.min(1, c));
    }
    analysis.ticker_confidence = validatedConf;

    analysis.sentiment       = Math.max(-1, Math.min(1, analysis.sentiment));
    analysis.impact_score    = Math.max(1,  Math.min(10, Math.round(analysis.impact_score)));
    analysis.relevance_score = Math.max(0,  Math.min(1, analysis.relevance_score));

    // Detect hallucinated summaries
    const summaryLower = (analysis.ai_summary ?? "").toLowerCase();
    if (GENERIC_TEMPLATES.some(t => summaryLower.includes(t))) {
      console.warn(`[process-news] item ${item.id}: generic summary, using fallback`);
      const content = item.body_text ?? item.summary ?? "";
      analysis.ai_summary = content.length >= 80 ? content.slice(0, 250) : item.title.slice(0, 250);
    }
  }

  // ── Step 4: Build final ticker map ────────────────────────────────────────
  let finalTickers:    string[]              = [];
  let mergedConf:      Record<string, number> = {};
  let tickerMethod:    string | null          = null;
  let tickerEvidence:  MatchEvidence[]        = [];

  if (hasEspiPreset) {
    // ESPI with pre-assigned tickers (confidence 1.0) — never overwrite
    for (const t of (item.tickers ?? [])) {
      if (validTickers.has(t)) mergedConf[t] = ESPI_CONFIDENCE;
    }
    // Merge any additional AI tickers with very high confidence
    if (analysis) {
      for (const [t, c] of Object.entries(analysis.ticker_confidence)) {
        if (validTickers.has(t) && c >= 0.85 && !mergedConf[t]) mergedConf[t] = c;
      }
    }
    tickerMethod = "espi_preset";

  } else if (isDeterministic) {
    // 3-layer deterministic match succeeded → use it, AI tickers not overwritten
    mergedConf    = { ...detResult.confidence };
    tickerEvidence = detResult.evidence;

    // Merge AI tickers only if they add something new with high confidence
    if (analysis) {
      const detSet = new Set(detResult.tickers);
      for (const [t, c] of Object.entries(analysis.ticker_confidence)) {
        if (validTickers.has(t) && c >= DISPLAY_THRESHOLD && !detSet.has(t)) {
          mergedConf[t] = c;
        }
      }
    }
    tickerMethod = "deterministic";

  } else {
    // AI needed — use AI tickers as primary
    if (analysis) {
      const aiTickers = analysis.tickers.filter(t => validTickers.has(t));
      for (const t of aiTickers) {
        mergedConf[t] = analysis.ticker_confidence[t] ?? 0.75;
      }
      // Supplement with AI conf map
      for (const [t, c] of Object.entries(analysis.ticker_confidence)) {
        if (validTickers.has(t) && c >= DISPLAY_THRESHOLD) {
          mergedConf[t] = Math.max(mergedConf[t] ?? 0, c);
        }
      }
    }
    tickerMethod = "ai";
  }

  // Final tickers: above display threshold, sorted by confidence desc
  finalTickers = Object.entries(mergedConf)
    .filter(([, c]) => c >= DISPLAY_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t);

  // ── Step 5: Persist to DB ─────────────────────────────────────────────────
  const relevanceScore: number = isEspi
    ? 1.0
    : analysis?.relevance_score ?? (finalTickers.length > 0 ? 0.6 : 0.3);

  const update: Record<string, unknown> = {
    ai_processed:      true,
    ticker_confidence: mergedConf,
    ticker_method:     tickerMethod,
    ticker_evidence:   tickerEvidence.length > 0 ? tickerEvidence : undefined,
    ticker_version:    2,
  };

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
    .from("news_items").update(update).eq("id", item.id);

  if (updateErr) {
    console.error(`[process-news] item ${item.id} update error:`, updateErr.message);
    return { ok: false, id: item.id, error: updateErr.message };
  }

  // Update companies.last_news_at
  if (finalTickers.length > 0) {
    const newsAt = item.published_at ?? new Date().toISOString();
    for (const ticker of finalTickers) {
      await supabase.from("companies").update({ last_news_at: newsAt })
        .eq("ticker", ticker)
        .or(`last_news_at.is.null,last_news_at.lt.${newsAt}`);
    }
  }

  // Assign event_group_id
  if (finalTickers.length > 0) {
    try {
      await assignEventGroup(item.id, finalTickers, item.published_at, supabase);
    } catch (err) {
      console.warn(`[process-news] item ${item.id} group assignment failed:`, err);
    }
  }

  const confStr  = Object.entries(mergedConf).map(([t, c]) => `${t}:${c.toFixed(2)}`).join(",");
  const breaking = analysis?.is_breaking ? " BREAKING" : "";
  console.log(`[process-news] item ${item.id}: method=${tickerMethod} tickers=[${confStr}] final=${finalTickers.join(",") || "none"}${breaking} ✓`);

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

  // ── Pipeline run logging ───────────────────────────────────────────────────
  const runRow = await supabase
    .from("pipeline_runs")
    .insert({ function_name: "process-news", source: "gpt-4o-mini", status: "running" })
    .select("id")
    .single();
  const runId = runRow.data?.id as number | undefined;

  // ── Preload ticker-matcher cache (once per batch) ─────────────────────────
  // ticker-matcher.ts uses module-level cache — this call loads aliases +
  // companies into memory so per-item calls are O(1) DB reads.
  await preloadMatcherCache(supabase);

  // Legacy alias/ticker sets — still needed for AI-path ticker filtering
  const { data: aliasRows } = await supabase
    .from("ticker_aliases")
    .select("ticker, alias")
    .limit(3000);

  const aliasMap = new Map<string, string>();
  for (const a of (aliasRows ?? [])) {
    aliasMap.set(a.alias.toLowerCase(), a.ticker);
  }

  const { data: companiesData } = await supabase
    .from("companies")
    .select("ticker");

  const validTickers = new Set<string>(
    (companiesData ?? []).map((c: { ticker: string }) => c.ticker),
  );

  console.log(`[process-news] ${aliasMap.size} aliases, ${validTickers.size} valid tickers (matcher cache preloaded)`);

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

  // ── Write ingestion_log + pipeline_runs ───────────────────────────────────
  const doneAt = new Date().toISOString();
  await supabase.from("ingestion_log").insert({
    source_name:      "process-news",
    status:           failed === 0 ? "success" : "partial_failure",
    messages_fetched: batch.length,
    messages_new:     processed,
    messages_failed:  failed,
    finished_at:      doneAt,
    duration_ms:      Date.now() - startTime,
  });

  if (runId) {
    await supabase.from("pipeline_runs").update({
      finished_at: doneAt,
      status:      failed === 0 ? "success" : "failed",
      items_in:    batch.length,
      items_out:   processed,
      errors:      failed,
    }).eq("id", runId);
  }

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
