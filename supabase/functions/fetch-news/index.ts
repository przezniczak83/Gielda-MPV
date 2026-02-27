// supabase/functions/fetch-news/index.ts
// RSS/Atom aggregator — 18 news sources + Strefa scraper via Railway.
//
// Sources: PAP, Bankier (4 feeds), Stooq (2), GPW (5), KNF, WP, Money.pl,
//          Puls Biznesu (2), Parkiet, RP, Cashless, Comparic, YouTube (3 channels)
// Strefa Inwestorów: scraped via Railway /scrape/strefa (no RSS)
//
// Deduplication: SHA-256 of URL (url_hash column, UNIQUE constraint)
// Insert strategy: ON CONFLICT (url_hash) DO NOTHING
// Auto-detects feed format: Atom (<entry>) vs RSS 2.0 (<item>)
//
// Deploy: supabase functions deploy fetch-news --project-ref pftgmorsthoezhmojjpg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashUrl }      from "../_shared/hash.ts";

// ─── User-Agent ───────────────────────────────────────────────────────────────

const BOT_UA = "GieldaMonitor/3.1 (+https://gielda-mpv.vercel.app)";

// ─── Rate limiting ────────────────────────────────────────────────────────────

const RATE_LIMITS_MS: Record<string, number> = {
  "www.gpw.pl":      1500,
  "www.knf.gov.pl":  1500,
  "www.parkiet.com": 1000,
  "www.rp.pl":       1000,
  "biznes.pap.pl":   800,
  "default":         500,
};

const lastFetchTime = new Map<string, number>();

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function rateLimitedFetch(url: string): Promise<Response> {
  const hostname = new URL(url).hostname;
  const minDelay = RATE_LIMITS_MS[hostname] ?? RATE_LIMITS_MS["default"];
  const last     = lastFetchTime.get(hostname) ?? 0;
  const elapsed  = Date.now() - last;
  if (elapsed < minDelay) await sleep(minDelay - elapsed);
  lastFetchTime.set(hostname, Date.now());
  return fetch(url, {
    headers: {
      "User-Agent": BOT_UA,
      "Accept":     "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(15_000),
  });
}

// ─── Sources ──────────────────────────────────────────────────────────────────

const NEWS_SOURCES: Array<{ name: string; urls: string[] }> = [
  // ── PAP ────────────────────────────────────────────
  {
    name: "pap",
    urls: [
      "https://biznes.pap.pl/rss",  // ESPI + EBI + depesze, ~1/min
    ],
  },

  // ── BANKIER ─────────────────────────────────────────
  // NOTE: bankier/espi.xml is intentionally EXCLUDED here — fetch-espi owns it
  // and writes to both raw_ingest and news_items with source='espi'.
  {
    name: "bankier",
    urls: [
      "https://www.bankier.pl/rss/gielda.xml",     // artykuły giełdowe
      "https://www.bankier.pl/rss/wiadomosci.xml", // wszystkie newsy
      "https://www.bankier.pl/rss/firma.xml",      // spółki
    ],
  },

  // ── STOOQ ───────────────────────────────────────────
  {
    name: "stooq",
    urls: [
      "https://static.stooq.pl/rss/pl/b.rss",  // biznes/agregator
      "https://static.stooq.pl/rss/pl/c.rss",  // kraj
    ],
  },

  // ── GPW ─────────────────────────────────────────────
  {
    name: "gpw",
    urls: [
      "https://www.gpw.pl/rss-communiques",
      "https://www.gpw.pl/rss-communiques-indices",
      "https://www.gpw.pl/rss-press-releases",
      "https://www.gpw.pl/rss-news",
      "https://www.gpw.pl/rss-resolution-management-board",
    ],
  },

  // ── KNF ─────────────────────────────────────────────
  {
    name: "knf",
    urls: [
      "https://www.knf.gov.pl/rssFeed.xml",
    ],
  },

  // ── WP FINANSE ──────────────────────────────────────
  {
    name: "wp",
    urls: [
      "https://finanse.wp.pl/rss/aktualnosci",
    ],
  },

  // ── MONEY.PL ────────────────────────────────────────
  {
    name: "money",
    urls: [
      "https://www.money.pl/rss/",
    ],
  },

  // ── PULS BIZNESU ────────────────────────────────────
  {
    name: "pb",
    urls: [
      "https://www.pb.pl/rss/najnowsze.xml",
      "https://www.pb.pl/rss/puls-inwestora.xml",
    ],
  },

  // ── PARKIET ─────────────────────────────────────────
  {
    name: "parkiet",
    urls: [
      "https://www.parkiet.com/rss_main",
    ],
  },

  // ── RZECZPOSPOLITA ──────────────────────────────────
  {
    name: "rp",
    urls: [
      "https://www.rp.pl/rss_main",
    ],
  },

  // ── CASHLESS ────────────────────────────────────────
  {
    name: "cashless",
    urls: [
      "https://cashless.pl/rss.xml",
    ],
  },

  // ── COMPARIC ────────────────────────────────────────
  {
    name: "comparic",
    urls: [
      "https://comparic.pl/feed/",
    ],
  },

  // ── YOUTUBE (Atom feeds) ─────────────────────────────
  {
    name: "youtube",
    urls: [
      // Comparic Giełda
      "https://www.youtube.com/feeds/videos.xml?channel_id=UCv6mTV4iQMOeixAWz47bP4Q",
      // Strefa Inwestorów
      "https://www.youtube.com/feeds/videos.xml?channel_id=UC4Qc_TYL6BsqiqXXorBFoaA",
      // Squaber
      "https://www.youtube.com/feeds/videos.xml?channel_id=UCuS9JQNj4MBiWaN4a5_u0YA",
    ],
  },
  // Strefa Inwestorów HTML is handled separately via Railway scraper below
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedItem {
  url:          string;
  title:        string;
  summary:      string | null;
  published_at: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract text content from an XML tag (handles CDATA). */
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, "s");
  const m  = re.exec(xml);
  return m ? m[1].trim() : "";
}

/** Split XML by open/close tag pairs. */
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
  if (!raw) return null;
  try {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

// ─── RSS 2.0 parser ───────────────────────────────────────────────────────────

function parseRSS(xml: string): ParsedItem[] {
  const items  = splitByTag(xml, "item");
  const result: ParsedItem[] = [];

  for (const item of items) {
    const title   = extractTag(item, "title");
    const desc    = extractTag(item, "description");
    const pubDate = extractTag(item, "pubDate");

    let url = extractTag(item, "link");
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

// ─── Atom parser (YouTube + generic Atom feeds) ───────────────────────────────

function parseAtom(xml: string): ParsedItem[] {
  const entries = splitByTag(xml, "entry");
  const result:  ParsedItem[] = [];

  for (const entry of entries) {
    const title     = extractTag(entry, "title");
    const published = extractTag(entry, "published") || extractTag(entry, "updated");

    // <link rel="alternate" href="..."/> — self-closing
    const linkMatch = /<link[^>]+href="([^"]+)"/.exec(entry);
    const url       = linkMatch ? linkMatch[1] : "";

    // media:description or summary
    const desc = extractTag(entry, "media:description") || extractTag(entry, "summary") || extractTag(entry, "content");

    if (!url || !title) continue;

    result.push({
      url,
      title,
      summary:      desc || null,
      published_at: parseDate(published),
    });
  }

  return result;
}

// ─── Fetch single feed URL (auto-detects Atom vs RSS) ─────────────────────────

async function fetchFeed(url: string): Promise<ParsedItem[]> {
  const res = await rateLimitedFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const xml = await res.text();

  // Auto-detect format: Atom uses <entry>, RSS uses <item>
  const isAtom = xml.includes("<entry>") && !xml.includes("<item>");
  return isAtom ? parseAtom(xml) : parseRSS(xml);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  const startTime = Date.now();
  console.log("[fetch-news] Invoked at:", new Date().toISOString());

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")              ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  let totalInserted = 0;
  let totalSkipped  = 0;
  const sourceStats: Record<string, { inserted: number; skipped: number; error?: string }> = {};

  const startedAt = new Date().toISOString();

  try {
  // ── STEP 1: Strefa Inwestorów via Railway scraper ────────────────────────
  const scraperUrl = Deno.env.get("RAILWAY_SCRAPER_URL");
  const scraperKey = Deno.env.get("RAILWAY_SCRAPER_KEY") ?? "";

  if (scraperUrl) {
    try {
      const scraperRes = await fetch(`${scraperUrl}/scrape/strefa`, {
        headers: { "x-api-key": scraperKey },
        signal: AbortSignal.timeout(20_000),
      });
      const scraperData = await scraperRes.json() as {
        ok: boolean;
        count: number;
        articles: Array<{ url: string; title: string; summary: string | null; published_at: string | null }>;
      };

      if (scraperData.ok && scraperData.articles?.length) {
        const rows = await Promise.all(
          scraperData.articles.map(async a => ({
            url_hash:     await hashUrl(a.url),
            url:          a.url,
            title:        a.title.slice(0, 500),
            summary:      a.summary?.slice(0, 2000) ?? null,
            source:       "strefa",
            published_at: a.published_at,
          })),
        );

        const { data, error } = await supabase
          .from("news_items")
          .upsert(rows, { onConflict: "url_hash", ignoreDuplicates: true })
          .select("id");

        if (error) {
          console.warn("[fetch-news] strefa upsert error:", error.message);
          sourceStats["strefa"] = { inserted: 0, skipped: 0, error: error.message };
        } else {
          const inserted = data?.length ?? 0;
          const skipped  = rows.length - inserted;
          totalInserted += inserted;
          totalSkipped  += skipped;
          sourceStats["strefa"] = { inserted, skipped };
          console.log(`[fetch-news] strefa: +${inserted} inserted, ${skipped} skipped`);
        }
      } else {
        console.log("[fetch-news] strefa scraper returned 0 articles");
        sourceStats["strefa"] = { inserted: 0, skipped: 0 };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[fetch-news] strefa scraper failed:", msg);
      sourceStats["strefa"] = { inserted: 0, skipped: 0, error: msg };
    }
  } else {
    console.log("[fetch-news] RAILWAY_SCRAPER_URL not set — skipping Strefa scraper");
  }

  // ── STEP 2: RSS / Atom sources ───────────────────────────────────────────
  for (const source of NEWS_SOURCES) {
    let srcInserted = 0;
    let srcSkipped  = 0;

    for (const feedUrl of source.urls) {
      let items: ParsedItem[];
      try {
        items = await fetchFeed(feedUrl);
        console.log(`[fetch-news] ${source.name} (${feedUrl}): ${items.length} items`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[fetch-news] ${source.name} (${feedUrl}) failed: ${msg}`);
        sourceStats[source.name] = { inserted: srcInserted, skipped: srcSkipped, error: msg };
        continue;
      }

      if (items.length === 0) continue;

      const rows = await Promise.all(
        items.map(async item => ({
          url_hash:     await hashUrl(item.url),
          url:          item.url,
          title:        item.title.slice(0, 500),
          summary:      item.summary?.slice(0, 2000) ?? null,
          source:       source.name,
          published_at: item.published_at,
        })),
      );

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
    sourceStats[source.name] = sourceStats[source.name]
      ?? { inserted: srcInserted, skipped: srcSkipped };
    // Only overwrite if no error was logged
    if (!sourceStats[source.name].error) {
      sourceStats[source.name] = { inserted: srcInserted, skipped: srcSkipped };
    }
    console.log(`[fetch-news] ${source.name}: +${srcInserted} inserted, ${srcSkipped} skipped`);
  }

  // ── Write ingestion_log + pipeline_runs ──────────────────────────────────
  const doneAt = new Date().toISOString();
  await supabase.from("ingestion_log").insert({
    source_name:      "fetch-news",
    status:           "success",
    messages_fetched: totalInserted + totalSkipped,
    messages_new:     totalInserted,
    messages_failed:  0,
    finished_at:      doneAt,
    duration_ms:      Date.now() - startTime,
  });

  await supabase.from("pipeline_runs").insert({
    function_name: "fetch-news",
    started_at:    startedAt,
    finished_at:   doneAt,
    status:        "success",
    items_in:      totalInserted + totalSkipped,
    items_out:     totalInserted,
    errors:        0,
    details:       { sources: sourceStats },
  }).catch(() => {});

  await supabase.from("system_health").upsert({
    function_name:        "fetch-news",
    last_success_at:      doneAt,
    items_processed:      totalInserted,
    consecutive_failures: 0,
  }, { onConflict: "function_name" }).then(({ error }) => {
    if (error) console.error("[fetch-news] system_health upsert error:", error.message);
  });

  console.log(`[fetch-news] Done: +${totalInserted} inserted, ${totalSkipped} skipped, ms=${Date.now() - startTime}`);

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
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    const failAt = new Date().toISOString();
    console.error("[fetch-news] Fatal:", errMsg);
    await supabase.from("pipeline_runs").insert({
      function_name: "fetch-news",
      started_at:    startedAt,
      finished_at:   failAt,
      status:        "failed",
      items_in:      totalInserted + totalSkipped,
      items_out:     totalInserted,
      errors:        1,
      error_message: errMsg,
    }).catch(() => {});
    await supabase.from("system_health").upsert({
      function_name: "fetch-news",
      last_error:    errMsg,
      last_error_at: failAt,
    }, { onConflict: "function_name" }).then(({ error }) => {
      if (error) console.error("[fetch-news] system_health upsert error:", error.message);
    });
    return new Response(
      JSON.stringify({ ok: false, error: errMsg }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
