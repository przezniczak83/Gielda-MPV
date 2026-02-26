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
  item:         NewsItem,
  heuristic:    Map<string, number>,
  allTickers:   string[],
  openaiKey:    string,
): Promise<AIAnalysis | null> {
  const heurContext = heuristic.size > 0
    ? `\nHeurystyka znalazła: ${[...heuristic.entries()].map(([t, c]) => `${t}(${c.toFixed(1)})`).join(", ")} — zweryfikuj czy są GŁÓWNYM tematem`
    : "";

  const systemPrompt =
    `Jesteś ekspertem analizy finansowej GPW i giełd światowych.
Analizujesz polskie wiadomości finansowe i zwracasz WYŁĄCZNIE JSON bez markdown.

POLE "relevance_score" — ocena ważności artykułu dla inwestora GPW (0.0–1.0):
1.0 = Komunikat ESPI / raport regulacyjny spółki GPW
0.9 = Wyniki finansowe, dywidenda, przejęcie, emisja akcji konkretnej spółki
0.8 = Istotna informacja o konkretnej spółce (kontrakt, zmiana zarządu, prognoza)
0.6 = Informacja o spółce w szerszym kontekście / artykuł branżowy
0.4 = Komentarz makroekonomiczny (stopy, inflacja, PKB) z możliwym wpływem
0.2 = Artykuł o zagranicznych rynkach / indeksach (SPX, DAX, NASDAQ)
0.0 = Artykuł całkowicie niezwiązany z inwestowaniem na GPW

KRYTYCZNE ZASADY dla pola "tickers" i "ticker_confidence":

Dodaj ticker WYŁĄCZNIE gdy spełniony jest JEDEN z warunków:
A) Nazwa spółki lub ticker są DOSŁOWNIE w tytule lub treści artykułu
B) Artykuł to oficjalny komunikat tej spółki (ESPI/raport regulacyjny)
C) Artykuł jest WYŁĄCZNIE o tej spółce (nie o sektorze/rynku)

NIE dodawaj tickera gdy:
- Spółka "mogłaby być dotknięta" tematem (np. stopy NBP → PKO, MBK)
- Artykuł dotyczy całego sektora (energetyka → PKN, PGE; banki → MBK, PKO)
- Spółka jest wspomniana jako przykład lub w kontekście ogólnym
- Artykuł jest makroekonomiczny (stopy, inflacja, kurs walut, indeksy)
- "ten", "art", "dom", "sim", "sat", "bio", "san" to pospolite słowa, nie tickery

Dla KAŻDEGO znalezionego tickera podaj confidence 0.0–1.0:
1.0 = spółka wprost wymieniona z nazwy i ticker w tytule
0.9 = nazwa spółki wprost w tytule
0.8 = nazwa spółki wprost w treści (nie tytule)
0.7 = ticker/alias dosłownie w treści
0.4 = AI uzało za sektorowo relevantne (ten próg jest za niski — nie używaj)

Zwróć TYLKO tickers z confidence >= 0.7 w tablicy "tickers".
Maksymalnie 3 tickers per artykuł. Jeśli nie masz pewności — zwróć [].

Przykłady POPRAWNE:
- "mBank ogłasza wyniki Q4" → tickers: ["MBK"], confidence: {"MBK": 0.95}
- "PKN Orlen podpisał kontrakt z PGNiG" → tickers: ["PKN","PGN"], confidence: {"PKN": 0.9, "PGN": 0.8}
- Komunikat ESPI od Text SA → tickers: ["TXT"], confidence: {"TXT": 1.0}

Przykłady BŁĘDNE (nie rób tego):
- Artykuł o stopach NBP → [] (nie: ["PKO","MBK"] — stopy to nie wyniki banków)
- "Tekst przemówienia ministra" → [] (nie: ["TXT"] — "tekst" to słowo, nie spółka)
- "Rynek energetyczny w Polsce" → [] (nie: ["PKN","PGE","TPE"])
- Artykuł o kursie EUR/PLN → [] (nie: ["EUR","PLN"])`;

  const userPrompt =
    `ZNANE TICKERY GPW: ${allTickers.slice(0, 200).join(", ")}${heurContext}
ŹRÓDŁO: ${item.source}
TYTUŁ: ${item.title}
TREŚĆ: ${(item.summary ?? "").slice(0, 2000)}

Zwróć JSON:
{
  "tickers": [],
  "ticker_confidence": {},
  "relevance_score": 0.5,
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
  allTickers:   string[],
  openaiKey:    string,
): Promise<ProcessResult> {
  // ZMIANA D: Heuristic with per-ticker confidence
  const heuristicMap = extractTickersHeuristic(item.title, item.summary, aliasMap, validTickers);

  // ZMIANA D: ESPI source → confidence 1.0 for all pre-extracted tickers
  const isEspi = item.source === "espi";

  // Paywall filter — skip AI for paywalled sources with no body content
  if (PAYWALL_SOURCES.includes(item.source) && (!item.summary || item.summary.length < 100)) {
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
    analysis = await analyzeItem(item, heuristicMap, allTickers, openaiKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[process-news] item ${item.id} AI error: ${msg}`);
  }

  // ── ZMIANA D: Merge heuristic + AI confidence ─────────────────────────────

  // Start with heuristic confidences
  const mergedConf: Record<string, number> = {};
  for (const [t, c] of heuristicMap) {
    if (validTickers.has(t)) mergedConf[t] = c;
  }

  // Merge AI confidences — take max of heuristic and AI
  if (analysis) {
    // AI-validated tickers (from returned tickers array + confidence map)
    const aiConf = analysis.ticker_confidence;
    const aiTickers = analysis.tickers.filter(t => validTickers.has(t));

    for (const t of aiTickers) {
      const aiC = aiConf[t] ?? 0.75;  // default if AI returned ticker but no conf
      mergedConf[t] = Math.max(mergedConf[t] ?? 0, aiC);
    }

    // Also consider confidence map entries even if not in tickers[]
    for (const [t, c] of Object.entries(aiConf)) {
      if (validTickers.has(t) && c >= DISPLAY_THRESHOLD) {
        mergedConf[t] = Math.max(mergedConf[t] ?? 0, c);
      }
    }
  }

  // ESPI override — official documents always confidence 1.0
  if (isEspi) {
    for (const t of Object.keys(mergedConf)) {
      mergedConf[t] = ESPI_CONFIDENCE;
    }
  }

  // Only save tickers with confidence >= display threshold
  const finalTickers = Object.entries(mergedConf)
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
