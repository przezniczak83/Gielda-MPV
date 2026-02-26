// supabase/functions/fetch-espi/index.ts
// Real ESPI fetcher with multi-source fallback chain.
//
// Source chain:
//   1. Bankier.pl RSS  — https://www.bankier.pl/rss/espi.xml
//   2. GPW RSS         — https://www.gpw.pl/komunikaty?type=rss
//   3. STUB_RECORDS    — fallback so cron never fails silently
//
// Ticker matching: extract all-caps 2-6 char words from title,
// compare against watchlist fetched from Supabase companies table.
//
// Deploy: supabase functions deploy fetch-espi --project-ref pftgmorsthoezhmojjpg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashUrl }      from "../_shared/hash.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EspiRecord {
  ticker:       string;
  title:        string;
  url:          string | null;
  published_at: string | null;
}

// ─── Stub fallback ────────────────────────────────────────────────────────────

const STUB_RECORDS: EspiRecord[] = [
  {
    ticker:       "PKN",
    title:        "ESPI stub: fallback — wszystkie źródła RSS niedostępne",
    url:          null,
    published_at: new Date().toISOString(),
  },
];

// ─── RSS helpers ──────────────────────────────────────────────────────────────

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Extract text content from a simple XML tag (handles CDATA). */
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, "s");
  const m  = re.exec(xml);
  return m ? m[1].trim() : "";
}

/** Parse RSS 2.0 XML string into array of raw item strings. */
function splitItems(xml: string): string[] {
  const items: string[] = [];
  let pos = 0;
  while (true) {
    const start = xml.indexOf("<item>", pos);
    if (start === -1) break;
    const end = xml.indexOf("</item>", start);
    if (end === -1) break;
    items.push(xml.slice(start, end + 7));
    pos = end + 7;
  }
  return items;
}

/** Try to extract ticker from title/description against known watchlist. */
function extractTicker(
  title:       string,
  description: string,
  tickers:     Set<string>,
): string | null {
  // Company name is before the first ":"
  const companyPart = title.split(":")[0].toUpperCase();

  // Extract all-caps words of 2–6 chars
  const words = companyPart.match(/\b[A-Z0-9]{2,6}\b/g) ?? [];
  for (const w of words) {
    if (tickers.has(w)) return w;
  }

  // Secondary: PDF filename prefix in description: "TICKER_filename.pdf"
  const pdfMatch = description.match(/\b([A-Z0-9]{2,6})_[A-Z0-9]/);
  if (pdfMatch && tickers.has(pdfMatch[1])) return pdfMatch[1];

  return null;
}

/** Parse RSS pubDate to ISO string. */
function parsePubDate(raw: string): string | null {
  try {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

interface FetchResult {
  records:      EspiRecord[];
  totalItems:   number;
  watchlistHit: number;
}

/** Fetch ESPI records from a single RSS URL.
 *  Inserts ALL real records; ticker is best-effort from watchlist matching. */
async function fetchRSS(url: string, tickers: Set<string>): Promise<FetchResult> {
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, "Accept": "application/rss+xml, application/xml, text/xml" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const xml   = await res.text();
  const items = splitItems(xml);
  if (items.length === 0) throw new Error("RSS returned 0 items");

  const records: EspiRecord[] = [];
  let watchlistHit = 0;

  for (const item of items) {
    const rawTitle = extractTag(item, "title");
    const link     = extractTag(item, "link");
    const pubDate  = extractTag(item, "pubDate");
    const desc     = extractTag(item, "description");

    if (!rawTitle) continue;

    // Try to match watchlist ticker; fall back to company name abbreviation
    const watchlistTicker = extractTicker(rawTitle, desc, tickers);
    if (watchlistTicker) watchlistHit++;

    // Extract company name (before ":") as best-effort ticker if no watchlist match
    const companyRaw = rawTitle.split(":")[0].trim();
    // Take first uppercase word of 2–6 chars as ticker candidate
    const candidateMatch = companyRaw.toUpperCase().match(/\b[A-Z0-9]{2,6}\b/);
    const tickerFinal    = watchlistTicker ?? (candidateMatch?.[0] || companyRaw.slice(0, 6));

    records.push({
      ticker:       tickerFinal,
      title:        rawTitle.split(":").slice(1).join(":").trim() || rawTitle,
      url:          link || null,
      published_at: parsePubDate(pubDate),
    });
  }

  return { records, totalItems: items.length, watchlistHit };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  console.log("[fetch-espi] Invoked at:", new Date().toISOString());

  const supabaseUrl = Deno.env.get("SUPABASE_URL")              ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // ── Load watchlist tickers ─────────────────────────────────────────────────
  const { data: companies, error: compErr } = await supabase
    .from("companies")
    .select("ticker");

  if (compErr) {
    console.warn("[fetch-espi] Could not load companies:", compErr.message);
  }

  const knownTickers = new Set<string>(
    (companies ?? []).map((c: { ticker: string }) => c.ticker.toUpperCase()),
  );
  console.log(`[fetch-espi] Watchlist: ${knownTickers.size} tickers`);

  // ── Fetch real data from RSS sources ──────────────────────────────────────
  const RSS_SOURCES = [
    { name: "bankier",  url: "https://www.bankier.pl/rss/espi.xml" },
    { name: "gpw",      url: "https://www.gpw.pl/komunikaty?type=rss" },
  ];

  let records: EspiRecord[] = [];
  let sourceUsed   = "stub";
  let watchlistHit = 0;
  let totalItems   = 0;

  for (const src of RSS_SOURCES) {
    try {
      const result = await fetchRSS(src.url, knownTickers);
      if (result.records.length > 0) {
        records      = result.records;
        watchlistHit = result.watchlistHit;
        totalItems   = result.totalItems;
        sourceUsed   = src.name;
        console.log(`[fetch-espi] ${src.name}: ${result.totalItems} total, ${result.watchlistHit} watchlist hits → inserting ${result.records.length}`);
        break;
      }
      console.log(`[fetch-espi] ${src.name}: returned 0 items, trying next`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[fetch-espi] ${src.name} failed: ${msg}`);
    }
  }

  // Fallback to stubs if all RSS sources fail
  if (records.length === 0) {
    console.warn("[fetch-espi] All RSS sources failed — using stub fallback");
    records    = STUB_RECORDS;
    sourceUsed = "stub";
  }

  // ── Insert into raw_ingest ────────────────────────────────────────────────
  const rows = records.map(r => ({
    source:  "espi",
    payload: r as unknown as Record<string, unknown>,
  }));

  console.log(`[fetch-espi] Inserting ${rows.length} records (source=${sourceUsed})`);

  const { data, error } = await supabase
    .from("raw_ingest")
    .insert(rows)
    .select("id");

  if (error) {
    console.error("[fetch-espi] Insert error:", error.message);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const inserted = data?.length ?? 0;
  console.log(`[fetch-espi] Inserted ${inserted} records into raw_ingest ✓`);

  // ── Bridge: also write to news_items (parallel to raw_ingest) ────────────
  // Skips stub records (they have no real URL)
  if (sourceUsed !== "stub") {
    let newsInserted = 0;
    let newsSkipped  = 0;
    let newsFailed   = 0;

    console.log(`[fetch-espi] Bridge: processing ${records.length} records`);

    for (const record of records) {
      const espiUrl = record.url ?? `espi-${record.ticker}-${record.published_at ?? Date.now()}`;
      const hash    = await hashUrl(espiUrl);

      const { data: upsertData, error: newsErr } = await supabase
        .from("news_items")
        .upsert({
          url_hash:      hash,
          url:           record.url ?? espiUrl,
          source_url:    record.url ?? null,
          title:         record.title,
          summary:       null,
          source:        "espi",
          published_at:  record.published_at,
          tickers:       [record.ticker],
          category:      "regulatory",
          impact_score:  8,       // ESPI always high significance
          ai_processed:  false,
          telegram_sent: false,
        }, { onConflict: "url_hash" })  // UPDATE on conflict (not ignore)
        .select("id");

      if (newsErr) {
        console.error(`[fetch-espi] Bridge error for ${record.ticker}: ${newsErr.message}`, newsErr.details ?? "");
        newsFailed++;
      } else if (upsertData && upsertData.length > 0) {
        newsInserted++;
      } else {
        newsSkipped++; // conflict — record already existed, updated in-place
      }
    }

    console.log(`[fetch-espi] Bridge: +${newsInserted} inserted, ${newsSkipped} updated, ${newsFailed} failed`);
  }

  return new Response(
    JSON.stringify({
      ok:            true,
      inserted,
      source:        sourceUsed,
      total_rss:     totalItems,
      watchlist_hit: watchlistHit,
      tickers:       records.map(r => r.ticker),
      ts:            new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
