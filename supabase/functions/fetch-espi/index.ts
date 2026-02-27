// supabase/functions/fetch-espi/index.ts
// Real ESPI fetcher with multi-source fallback chain.
//
// Source chain:
//   1. Bankier.pl RSS  — https://www.bankier.pl/rss/espi.xml
//   2. GPW RSS         — https://www.gpw.pl/komunikaty?type=rss
//   3. STUB_RECORDS    — fallback so cron never fails silently
//
// KROK 4: extracts body_text + PDF attachments from RSS <description>
// NAPRAWA A: extracts emitter from URL/title and matches to company index
//
// Deploy: supabase functions deploy fetch-espi --project-ref pftgmorsthoezhmojjpg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashUrl }      from "../_shared/hash.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EspiAttachment {
  name: string;
  url:  string;
  type: string;
}

interface EspiRecord {
  tickers:           string[];
  ticker_confidence: Record<string, number>;
  title:             string;
  url:               string | null;
  published_at:      string | null;
  body_text:         string | null;
  attachments:       EspiAttachment[];
}

interface CompanyEntry {
  ticker:     string;
  normalized: string[];
}

// ─── Stub fallback ────────────────────────────────────────────────────────────

function makeStub(): EspiRecord {
  return {
    tickers:           [],
    ticker_confidence: {},
    title:             "ESPI stub: fallback — wszystkie źródła RSS niedostępne",
    url:               null,
    published_at:      new Date().toISOString(),
    body_text:         null,
    attachments:       [],
  };
}

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

/** Parse RSS pubDate to ISO string. */
function parsePubDate(raw: string): string | null {
  try {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

// ─── NAPRAWA A: Emitter extraction + company matching ─────────────────────────

/** Normalize a company name for fuzzy matching. */
function normalizeCompanyName(name: string): string {
  return name.toLowerCase()
    .replace(/\s+s\.a\.?\s*$/gi, "")
    .replace(/\s+s\.?a\s*$/gi, "")
    .replace(/\s+se\s*$/gi, "")
    .replace(/\s+sp\.\s*z\s*o\.o\.?\s*$/gi, "")
    .replace(/\s+s\.k\.a\.?\s*$/gi, "")
    .replace(/\s+s\.c\.?\s*$/gi, "")
    .replace(/\s+nv\s*$/gi, "")
    .replace(/\s+plc\s*$/gi, "")
    .replace(/\s+ltd\.?\s*$/gi, "")
    .replace(/\s+inc\.?\s*$/gi, "")
    .replace(/\s+holding[s]?\s*$/gi, "")
    .replace(/\s+group\s*$/gi, "")
    .replace(/[.,\-()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract emitter name from Bankier ESPI URL.
 *  bankier.pl/wiadomosc/AMREST-Wyniki-finansowe-RR-2025-... → "AMREST"
 *  bankier.pl/wiadomosc/PKN-ORLEN-S-A-Wyniki-... → "PKN ORLEN S A"
 */
function extractEmitterFromUrl(url: string): string | null {
  const bankierMatch = url.match(
    /wiadomosc\/(.+?)-(?:Wyniki|Raport|Sprawozdanie|Zawarcie|Nabycie|Zbycie|Emisja|Skup|Zmiana|Informacja|Komunikat|Powolanie|Rezygnacja|Rezygnacja|Ogłoszenie|Zwolanie|Zwołanie|Dane|Korekta|Uzupelnienie|Informacja|Uchwala|Aktualizacja|Lista|Nabycie|Rejestracja|Zmiana)/i
  );
  if (bankierMatch) {
    return bankierMatch[1].replace(/-/g, " ").trim();
  }
  return null;
}

/** Extract emitter from ESPI title (everything before the first dash or colon). */
function extractEmitterFromTitle(title: string): string | null {
  // "AMREST S.A. - Wyniki finansowe RR /2025" → "AMREST S.A."
  // "PKN ORLEN S.A.: Wyniki finansowe QSr 4/2025" → "PKN ORLEN S.A."
  // "mBank S.A. – Wyniki finansowe SRR /2025" → "mBank S.A."
  const match = title.match(/^([^–\-:]+?)\s*[–\-:]/);
  if (match && match[1].trim().length >= 2) {
    return match[1].trim();
  }
  return null;
}

/** Find the best matching ticker for a company emitter name. */
function findTickerForEmitter(
  emitterRaw: string,
  index: CompanyEntry[],
): string | null {
  const emitterNorm = normalizeCompanyName(emitterRaw);
  if (!emitterNorm || emitterNorm.length < 3) return null;

  let bestTicker: string | null = null;
  let bestScore = 0;

  for (const company of index) {
    for (const compNorm of company.normalized) {
      if (!compNorm || compNorm.length < 2) continue;

      // Exact match
      if (compNorm === emitterNorm) return company.ticker;

      // Prefix match: company name starts with emitter (e.g. "amrest" vs "amrest holdings se")
      const prefixScore = compNorm.startsWith(emitterNorm) ? emitterNorm.length / compNorm.length : 0;

      // Substring match — emitter is in company name or vice versa
      const subScore =
        (compNorm.includes(emitterNorm) ? emitterNorm.length / compNorm.length : 0) +
        (emitterNorm.includes(compNorm)  ? compNorm.length / emitterNorm.length  : 0);

      const score = Math.max(prefixScore, subScore);

      if (score > bestScore && score > 0.55) {
        bestScore = score;
        bestTicker = company.ticker;
      }
    }
  }
  return bestTicker;
}

// ─── KROK 4: Extract body text + PDF attachments from RSS description ─────────

/** Extract body text and PDF/document attachments from an RSS <description> field. */
function extractBodyAndAttachments(descHtml: string): {
  body_text:   string | null;
  attachments: EspiAttachment[];
} {
  if (!descHtml) return { body_text: null, attachments: [] };

  const attachments: EspiAttachment[] = [];
  const seen = new Set<string>();

  // Extract PDF links
  const pdfRe = /<a[^>]+href="([^"]*\.pdf[^"]*)"[^>]*>([^<]*)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = pdfRe.exec(descHtml)) !== null) {
    const url  = m[1].trim();
    const name = m[2].trim() || url.split("/").pop() || "Załącznik";
    if (url && !seen.has(url)) {
      seen.add(url);
      attachments.push({ name, url, type: "pdf" });
    }
  }

  // Extract other document links (xlsx, docx, zip)
  const docRe = /<a[^>]+href="([^"]*\.(xlsx?|docx?|zip)[^"]*)"[^>]*>([^<]*)<\/a>/gi;
  while ((m = docRe.exec(descHtml)) !== null) {
    const url  = m[1].trim();
    const ext  = m[2].toLowerCase();
    const name = m[3].trim() || url.split("/").pop() || "Załącznik";
    if (url && !seen.has(url)) {
      seen.add(url);
      attachments.push({ name, url, type: ext });
    }
  }

  // Also try bare href links (no inner text) — some ESPI RSS encode them differently
  const bareRe = /href="([^"]+\.pdf)"/gi;
  while ((m = bareRe.exec(descHtml)) !== null) {
    const url = m[1].trim();
    if (url && !seen.has(url)) {
      seen.add(url);
      attachments.push({ name: url.split("/").pop() || "Załącznik", url, type: "pdf" });
    }
  }

  // Strip HTML to plain text (preserve line breaks)
  const body_text = descHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, "")
    .replace(/&[a-z]+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 3000);

  return {
    body_text: body_text.length > 50 ? body_text : null,
    attachments,
  };
}

interface FetchResult {
  records:      EspiRecord[];
  totalItems:   number;
  matchedCount: number;
}

/** Fetch ESPI records from a single RSS URL.
 *  Extracts emitter from URL/title and matches to company index. */
async function fetchRSS(
  url:          string,
  companyIndex: CompanyEntry[],
): Promise<FetchResult> {
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, "Accept": "application/rss+xml, application/xml, text/xml" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const xml   = await res.text();
  const items = splitItems(xml);
  if (items.length === 0) throw new Error("RSS returned 0 items");

  const records: EspiRecord[] = [];
  let matchedCount = 0;

  for (const item of items) {
    const rawTitle = extractTag(item, "title");
    const link     = extractTag(item, "link");
    const pubDate  = extractTag(item, "pubDate");
    const desc     = extractTag(item, "description");

    if (!rawTitle) continue;

    // NAPRAWA A: Extract emitter from URL first, then title
    const emitterFromUrl   = extractEmitterFromUrl(link);
    const emitterFromTitle = extractEmitterFromTitle(rawTitle);
    const emitter          = emitterFromUrl || emitterFromTitle;

    let tickers:           string[]              = [];
    let ticker_confidence: Record<string, number> = {};

    if (emitter) {
      const ticker = findTickerForEmitter(emitter, companyIndex);
      if (ticker) {
        tickers           = [ticker];
        ticker_confidence = { [ticker]: 1.0 };
        matchedCount++;
        console.log(`[fetch-espi] emitter match: "${emitter}" → ${ticker}`);
      } else {
        console.log(`[fetch-espi] emitter NOT matched: "${emitter}" (title: ${rawTitle.slice(0, 50)})`);
      }
    } else {
      console.log(`[fetch-espi] emitter extraction failed: "${rawTitle.slice(0, 50)}"`);
    }

    // Strip company name from stored title (everything after the separator)
    const titleBody = rawTitle.includes(":")
      ? rawTitle.split(":").slice(1).join(":").trim()
      : rawTitle.replace(/^[^–\-]+[–\-]\s*/, "").trim();

    // KROK 4: extract body text + attachments from RSS description
    const { body_text, attachments } = extractBodyAndAttachments(desc);

    records.push({
      tickers,
      ticker_confidence,
      title:        titleBody || rawTitle,
      url:          link || null,
      published_at: parsePubDate(pubDate),
      body_text,
      attachments,
    });
  }

  return { records, totalItems: items.length, matchedCount };
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

  // ── Pipeline run logging ───────────────────────────────────────────────────
  const runRow = await supabase
    .from("pipeline_runs")
    .insert({ function_name: "fetch-espi", source: "bankier-espi", status: "running" })
    .select("id")
    .single();
  const runId = runRow.data?.id as number | undefined;

  let itemsOut = 0;
  let runErrors = 0;

  // ── Load company index for emitter matching ────────────────────────────────
  const { data: companies, error: compErr } = await supabase
    .from("companies")
    .select("ticker, name");

  if (compErr || !companies?.length) {
    console.error("[fetch-espi] Failed to load companies:", compErr?.message);
    return new Response(
      JSON.stringify({ ok: false, error: "Failed to load companies" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // Build normalized index for fuzzy matching
  const companyIndex: CompanyEntry[] = (companies as Array<{ ticker: string; name: string }>).map(c => ({
    ticker:     c.ticker,
    normalized: [
      normalizeCompanyName(c.name),
    ].filter(n => n.length >= 2),
  }));

  console.log(`[fetch-espi] Loaded ${companyIndex.length} companies for matching`);

  // ── Fetch real data from RSS sources ──────────────────────────────────────
  const RSS_SOURCES = [
    { name: "bankier", url: "https://www.bankier.pl/rss/espi.xml" },
    { name: "gpw",     url: "https://www.gpw.pl/komunikaty?type=rss" },
  ];

  let records:      EspiRecord[] = [];
  let sourceUsed   = "stub";
  let matchedCount = 0;
  let totalItems   = 0;

  for (const src of RSS_SOURCES) {
    try {
      const result = await fetchRSS(src.url, companyIndex);
      if (result.records.length > 0) {
        records      = result.records;
        matchedCount = result.matchedCount;
        totalItems   = result.totalItems;
        sourceUsed   = src.name;
        const withBody = result.records.filter(r => r.body_text).length;
        const withAtts = result.records.filter(r => r.attachments.length > 0).length;
        console.log(`[fetch-espi] ${src.name}: ${result.totalItems} total, ${result.matchedCount} emitter matches → ${result.records.length} records (body: ${withBody}, attachments: ${withAtts})`);
        break;
      }
      console.log(`[fetch-espi] ${src.name}: returned 0 items, trying next`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[fetch-espi] ${src.name} failed: ${msg}`);
    }
  }

  if (records.length === 0) {
    console.warn("[fetch-espi] All RSS sources failed — using stub fallback");
    records    = [makeStub()];
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
    if (runId) {
      await supabase.from("pipeline_runs").update({
        finished_at: new Date().toISOString(), status: "failed",
        errors: runErrors + 1, details: { error: error.message },
      }).eq("id", runId);
    }
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const inserted = data?.length ?? 0;
  console.log(`[fetch-espi] Inserted ${inserted} records into raw_ingest ✓`);

  // ── Bridge: also write to news_items (parallel to raw_ingest) ────────────
  if (sourceUsed !== "stub") {
    let newsInserted = 0;
    let newsSkipped  = 0;
    let newsFailed   = 0;

    console.log(`[fetch-espi] Bridge: processing ${records.length} records`);

    for (const record of records) {
      // Build a unique key for hashing.
      // GPW RSS reuses the same URL for all communications — append title to make unique.
      const baseUrl  = record.url ?? "";
      const isGenericUrl = baseUrl.includes("utm_campaign=") || baseUrl.includes("utm_source=");
      const hashKey  = isGenericUrl
        ? `${baseUrl}##${record.title}`
        : (baseUrl || `espi-${record.tickers[0] ?? "unknown"}-${record.published_at ?? Date.now()}`);

      const hash = await hashUrl(hashKey);

      const { data: upsertData, error: newsErr } = await supabase
        .from("news_items")
        .upsert({
          url_hash:          hash,
          url:               record.url ?? hashKey,
          source_url:        record.url ?? null,
          title:             record.title,
          summary:           null,
          source:            "espi",
          published_at:      record.published_at,
          tickers:           record.tickers,
          ticker_confidence: record.ticker_confidence,
          category:          "regulatory",
          impact_score:      8,
          ai_processed:      false,
          telegram_sent:     false,
          ticker_method:     record.tickers.length > 0 ? "espi_url" : undefined,
          ticker_version:    1,
          // KROK 4: store body text + PDF attachments
          body_text:    record.body_text,
          attachments:  record.attachments.length > 0 ? record.attachments : undefined,
        }, { onConflict: "url_hash" })
        .select("id");

      if (newsErr) {
        console.error(`[fetch-espi] Bridge error for ${record.tickers.join(",")}: ${newsErr.message}`, newsErr.details ?? "");
        newsFailed++;
        runErrors++;
      } else if (upsertData && upsertData.length > 0) {
        newsInserted++;
        itemsOut++;
      } else {
        newsSkipped++;
      }
    }

    console.log(`[fetch-espi] Bridge: +${newsInserted} inserted, ${newsSkipped} updated, ${newsFailed} failed`);
  }

  // ── Mark pipeline run success ──────────────────────────────────────────────
  if (runId) {
    await supabase.from("pipeline_runs").update({
      finished_at: new Date().toISOString(),
      status:      runErrors === 0 ? "success" : "failed",
      items_in:    totalItems,
      items_out:   itemsOut,
      errors:      runErrors,
    }).eq("id", runId);
  }

  return new Response(
    JSON.stringify({
      ok:            true,
      inserted,
      source:        sourceUsed,
      total_rss:     totalItems,
      emitter_match: matchedCount,
      tickers:       [...new Set(records.flatMap(r => r.tickers))],
      ts:            new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
