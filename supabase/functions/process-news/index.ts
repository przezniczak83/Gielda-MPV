// supabase/functions/process-news/index.ts
// AI analysis pipeline for news_items.
//
// Per run: fetches 20 unprocessed items, analyzes each with GPT-4o-mini,
// writes back tickers/sentiment/impact_score/category/ai_summary.
//
// Model: GPT-4o-mini (OPENAI_API_KEY env var)
// Batch: 20 items/run, 200ms sleep between calls
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
}

interface AIAnalysis {
  tickers:      string[];
  sector:       string | null;
  sentiment:    number;
  impact_score: number;
  category:     string;
  ai_summary:   string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BATCH_SIZE   = 20;
const SLEEP_BETWEEN = 200;  // ms between OpenAI calls

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── AI Analysis ──────────────────────────────────────────────────────────────

async function analyzeItem(
  item:       NewsItem,
  allTickers: string[],
  openaiKey:  string,
): Promise<AIAnalysis | null> {
  const prompt = `Przeanalizuj tę wiadomość finansową z polskiego rynku.

Tytuł: ${item.title}
Treść: ${item.summary ? item.summary.slice(0, 800) : "brak"}
Źródło: ${item.source}

Znane tickery GPW (wybierz tylko pasujące): ${allTickers.slice(0, 200).join(", ")}

Odpowiedz TYLKO jako JSON (bez markdown, bez komentarzy):
{
  "tickers": ["PKN"],
  "sector": "energy",
  "sentiment": 0.7,
  "impact_score": 7,
  "category": "earnings",
  "ai_summary": "PKN Orlen ogłosił wyniki Q4 2025 z zyskiem 2.1 mld zł, powyżej oczekiwań."
}

Zasady:
- tickers: lista tickerów których bezpośrednio dotyczy artykuł, [] jeśli brak
- sector: jeden z: energy, banking, telecom, retail, construction, mining, healthcare, tech, media, real_estate, food, transport, insurance, other, lub null jeśli makro/ogólne
- sentiment: -1.0 (bardzo negatywne) do +1.0 (bardzo pozytywne), 0.0 dla neutralnych
- impact_score: 1 (bez znaczenia) do 10 (przełomowe wydarzenie rynkowe)
- category: earnings | dividend | management | macro | regulation | merger | contract | insider | other
- ai_summary: 1-2 zdania po polsku opisujące sedno wiadomości`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${openaiKey}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      model:           "gpt-4o-mini",
      messages:        [{ role: "user", content: prompt }],
      max_tokens:      300,
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

  let parsed: Partial<AIAnalysis>;
  try {
    parsed = JSON.parse(raw) as Partial<AIAnalysis>;
  } catch {
    throw new Error(`JSON parse failed: ${raw.slice(0, 100)}`);
  }

  return {
    tickers:      Array.isArray(parsed.tickers) ? parsed.tickers.slice(0, 10) : [],
    sector:       typeof parsed.sector === "string" ? parsed.sector : null,
    sentiment:    typeof parsed.sentiment === "number"
      ? Math.max(-1, Math.min(1, parsed.sentiment))
      : 0,
    impact_score: typeof parsed.impact_score === "number"
      ? Math.max(1, Math.min(10, Math.round(parsed.impact_score)))
      : 5,
    category:     typeof parsed.category === "string" ? parsed.category : "other",
    ai_summary:   typeof parsed.ai_summary === "string" ? parsed.ai_summary.slice(0, 500) : "",
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
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

  // ── Load all known tickers for AI context ─────────────────────────────────
  const { data: companies } = await supabase
    .from("companies")
    .select("ticker");

  const allTickers = (companies ?? []).map((c: { ticker: string }) => c.ticker.toUpperCase());
  console.log(`[process-news] ${allTickers.length} known tickers loaded`);

  // ── Fetch unprocessed batch ────────────────────────────────────────────────
  const { data: items, error: fetchErr } = await supabase
    .from("news_items")
    .select("id, title, summary, source, url")
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

  // ── Analyze and update each item ───────────────────────────────────────────
  let processed = 0;
  let failed    = 0;

  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    if (i > 0) await sleep(SLEEP_BETWEEN);

    let analysis: AIAnalysis | null = null;
    try {
      analysis = await analyzeItem(item, allTickers, openaiKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[process-news] item ${item.id} AI error: ${msg}`);
      failed++;
    }

    // Update even if AI failed (mark processed=true to avoid infinite retries)
    const update: Record<string, unknown> = { ai_processed: true };
    if (analysis) {
      update.tickers      = analysis.tickers;
      update.sector       = analysis.sector;
      update.sentiment    = analysis.sentiment;
      update.impact_score = analysis.impact_score;
      update.category     = analysis.category;
      update.ai_summary   = analysis.ai_summary;
    }

    const { error: updateErr } = await supabase
      .from("news_items")
      .update(update)
      .eq("id", item.id);

    if (updateErr) {
      console.error(`[process-news] item ${item.id} update error:`, updateErr.message);
      failed++;
    } else {
      if (analysis) {
        console.log(`[process-news] item ${item.id}: impact=${analysis.impact_score}, tickers=${analysis.tickers.join(",") || "none"} ✓`);
        processed++;
      }
    }
  }

  console.log(`[process-news] Done: processed=${processed}, failed=${failed}`);

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
