// supabase/functions/fetch-news/index.ts
// RSS aggregator — fetches 6 news sources every 15 minutes.
//
// Sources: PAP Biznes, Stooq, Bankier, Strefa Inwestorów, WP Finanse, YouTube
// Deduplication: SHA-256 of URL (url_hash column, UNIQUE constraint)
// Insert strategy: ON CONFLICT (url_hash) DO NOTHING
//
// Deploy: supabase functions deploy fetch-news --project-ref pftgmorsthoezhmojjpg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Constants ────────────────────────────────────────────────────────────────

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── Sources ──────────────────────────────────────────────────────────────────

const NEWS_SOURCES: Array<{
  name:  string;
  urls:  string[];
  type:  "rss" | "youtube";
  sleep?: number;  // ms between requests to same domain
}> = [
  {
    name: "pap",
    urls: [
      "https://biznes.pap.pl/pl/rss/latest.xml",
      "https://biznes.pap.pl/pl/rss/companies.xml",
    ],
    type:  "rss",
    sleep: 500,
  },
  {
    name: "stooq",
    urls: ["https://stooq.pl/n/?f=rss"],
    type: "rss",
  },
  {
    name: "bankier",
    urls: [
      "https://www.bankier.pl/rss/wiadomosci.xml",
      "https://www.bankier.pl/rss/gielda.xml",
    ],
    type:  "rss",
    sleep: 500,
  },
  {
    name: "strefa",
    urls: ["https://strefainwestorow.pl/rss.xml"],
    type: "rss",
  },
  {
    name: "wp",
    urls: ["https://finanse.wp.pl/rss.xml"],
    type: "rss",
  },
  {
    name: "youtube",
    urls: [
      // Comparic Giełda
      "https://www.youtube.com/feeds/videos.xml?channel_id=UCiAnMnBVsZkZP7EoMnZyKqw",
      // Squaber
      "https://www.youtube.com/feeds/videos.xml?channel_id=UCyLJaQbSiLuMWRF0HJJwX8w",
    ],
    type: "youtube",
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedItem {
  url:          string;
  title:        string;
  summary:      string | null;
  published_at: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** First 32 hex chars of SHA-256 hash — enough for deduplication. */
async function hashUrl(url: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** Extract text content from an XML tag (handles CDATA). */
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, "s");
  const m  = re.exec(xml);
  return m ? m[1].trim() : "";
}

/** Split XML by open/close tag pairs (handles both <item> and <entry>). */
function splitByTag(xml: string, tag: string): string[] {
  const open  = `<${tag}>`;
  const close = `</${tag}>`;
  const items: string[] = [];
  let pos = 0;
  while (true) {
    const start = xml.indexOf(open, pos);
    if (start === -1) break;
    const end = xml.indexOf(close, start);
    if (end === -1) break;
    items.push(xml.slice(start, end + close.length));
    pos = end + close.length;
  }
  return items;
}

/** Parse date string to ISO 8601. */
function parseDate(raw: string): string | null {
  try {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

// ─── RSS 2.0 parser ───────────────────────────────────────────────────────────

function parseRSS(xml: string): ParsedItem[] {
  const items = splitByTag(xml, "item");
  const result: ParsedItem[] = [];

  for (const item of items) {
    const title   = extractTag(item, "title");
    const desc    = extractTag(item, "description");
    const pubDate = extractTag(item, "pubDate");

    // <link> in RSS is often a text node (not self-closing)
    let url = extractTag(item, "link");

    // Fallback: <guid> often contains the URL
    if (!url) url = extractTag(item, "guid");

    if (!url || !title) continue;

    result.push({
      url,
      title,
      summary:      desc || null,
      published_at: parseDate(pubDate),
    });
  }

  return result;
}

// ─── YouTube Atom parser ──────────────────────────────────────────────────────

function parseYouTube(xml: string): ParsedItem[] {
  const entries = splitByTag(xml, "entry");
  const result:  ParsedItem[] = [];

  for (const entry of entries) {
    const title     = extractTag(entry, "title");
    const published = extractTag(entry, "published");

    // <link rel="alternate" href="..."/> — self-closing, so extractTag won't work
    const linkMatch = /<link[^>]+href="([^"]+)"/.exec(entry);
    const url       = linkMatch ? linkMatch[1] : "";

    // media:description (YouTube video description)
    const mediaDesc = extractTag(entry, "media:description");

    if (!url || !title) continue;

    result.push({
      url,
      title,
      summary:      mediaDesc || null,
      published_at: parseDate(published),
    });
  }

  return result;
}

// ─── Fetch single RSS URL ─────────────────────────────────────────────────────

async function fetchFeed(url: string, type: "rss" | "youtube"): Promise<ParsedItem[]> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      "Accept":     "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const xml = await res.text();
  return type === "youtube" ? parseYouTube(xml) : parseRSS(xml);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  console.log("[fetch-news] Invoked at:", new Date().toISOString());

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")              ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  let totalInserted = 0;
  let totalSkipped  = 0;
  const sourceStats: Record<string, { inserted: number; skipped: number; error?: string }> = {};

  for (const source of NEWS_SOURCES) {
    let srcInserted = 0;
    let srcSkipped  = 0;

    for (let i = 0; i < source.urls.length; i++) {
      const feedUrl = source.urls[i];

      // Rate-limit: sleep between same-domain requests
      if (i > 0 && source.sleep) await sleep(source.sleep);

      let items: ParsedItem[];
      try {
        items = await fetchFeed(feedUrl, source.type);
        console.log(`[fetch-news] ${source.name} (${feedUrl}): ${items.length} items`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[fetch-news] ${source.name} (${feedUrl}) failed: ${msg}`);
        sourceStats[source.name] = { inserted: srcInserted, skipped: srcSkipped, error: msg };
        continue;
      }

      if (items.length === 0) continue;

      // Build rows with url_hash for deduplication
      const rows = await Promise.all(
        items.map(async item => ({
          url_hash:     await hashUrl(item.url),
          url:          item.url,
          title:        item.title.slice(0, 500),   // guard against oversized titles
          summary:      item.summary?.slice(0, 2000) ?? null,
          source:       source.name,
          published_at: item.published_at,
        })),
      );

      // Upsert: ON CONFLICT DO NOTHING — count inserted vs skipped
      const { data, error } = await supabase
        .from("news_items")
        .upsert(rows, { onConflict: "url_hash", ignoreDuplicates: true })
        .select("id");

      if (error) {
        console.error(`[fetch-news] ${source.name}: upsert error:`, error.message);
        sourceStats[source.name] = { inserted: srcInserted, skipped: srcSkipped, error: error.message };
        continue;
      }

      const inserted = data?.length ?? 0;
      const skipped  = rows.length - inserted;
      srcInserted   += inserted;
      srcSkipped    += skipped;
    }

    totalInserted += srcInserted;
    totalSkipped  += srcSkipped;
    sourceStats[source.name] = { inserted: srcInserted, skipped: srcSkipped };
    console.log(`[fetch-news] ${source.name}: +${srcInserted} inserted, ${srcSkipped} skipped`);
  }

  console.log(`[fetch-news] Done: +${totalInserted} inserted, ${totalSkipped} skipped`);

  return new Response(
    JSON.stringify({
      ok:       true,
      inserted: totalInserted,
      skipped:  totalSkipped,
      sources:  sourceStats,
      ts:       new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
