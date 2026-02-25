// supabase/functions/fetch-insider/index.ts
// Insider transaction tracker for GPW.
//
// Data source strategy:
//   1. GPW Ajax API (https://www.gpw.pl/ajaxindex.php?action=GPWTransakcjeInsiderow)
//      — likely blocked from Edge Function IPs (same IP block as stooq.pl)
//   2. Bankier.pl RSS insider feed
//      — https://www.bankier.pl/rss/insider.xml (returns empty currently)
//   3. ESPI pipeline fallback — scan company_events for insider keywords
//      (MAR Art. 19 filings: "transakcja menedżera", "nabycie", "zbycie")
//
// Alerts sent via Telegram:
//   BUY  AND value_pln >  100,000 → 🟢 INSIDER BUYING
//   SELL AND value_pln >  500,000 → 🔴 INSIDER SELLING
//
// Cron: 0 * * * * (every hour)
// Deploy: supabase functions deploy fetch-insider --project-ref pftgmorsthoezhmojjpg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InsiderTransaction {
  ticker:           string;
  person_name:      string | null;
  role:             string | null;
  transaction_type: "BUY" | "SELL";
  shares_count:     number | null;
  value_pln:        number | null;
  transaction_date: string | null;    // YYYY-MM-DD
  source:           string;
  event_id:         string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BUY_ALERT_THRESHOLD  =  100_000;
const SELL_ALERT_THRESHOLD =  500_000;

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Keywords that indicate insider transaction ESPI events
const INSIDER_KEYWORDS = [
  "transakcja menedżera",
  "transakcje menedżerów",
  "art. 19",
  "art 19 mar",
  "powiadomienie o transakcji",
  "notification of transaction",
  "nabycie akcji przez",
  "zbycie akcji przez",
  "insider transaction",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return isNaN(n) ? null : n;
}

/** Classify a title as BUY or SELL based on keywords. */
function detectTransactionType(title: string): "BUY" | "SELL" | null {
  const t = title.toLowerCase();
  if (/nabycj|kupn|purchase|buy|nabycie/.test(t))       return "BUY";
  if (/zbycie|sprzedaż|sprzedaz|sale|sell/.test(t))     return "SELL";
  return null;
}

/** Try to extract value (PLN) from ESPI event title. */
function extractValueFromTitle(title: string): number | null {
  // Patterns: "za 1 234 567 PLN", "wartość: 500 000 zł"
  const patterns = [
    /za\s+([\d\s,]+)\s*(?:pln|zł|zl)/i,
    /wartość?\s*:?\s*([\d\s,]+)\s*(?:pln|zł|zl)/i,
    /([\d\s]{5,})\s*(?:pln|zł|zl)/i,
  ];
  for (const re of patterns) {
    const m = title.match(re);
    if (m) {
      const n = parseNum(m[1].replace(/\s/g, ""));
      if (n !== null && n > 0) return n;
    }
  }
  return null;
}

/** Try to extract person name from title (e.g. "Jan Kowalski nabył..."). */
function extractPersonName(title: string): string | null {
  // Look for "przez [Name Surname]" pattern
  const m = title.match(/przez\s+([A-ZŁŚŻŹ][a-ząężźćśół]+\s+[A-ZŁŚŻŹ][a-ząężźćśół]+)/);
  return m ? m[1] : null;
}

// ─── Source 1: GPW Ajax API ───────────────────────────────────────────────────

async function fetchFromGPW(): Promise<InsiderTransaction[]> {
  const url = "https://www.gpw.pl/ajaxindex.php?action=GPWTransakcjeInsiderow&start=0&limit=20&lang=PL";
  const res  = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, "Referer": "https://www.gpw.pl/" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const text = await res.text();
  if (!text || text.length < 50) throw new Error("GPW returned empty response");

  // GPW returns HTML table fragment — parse rows
  const rows: InsiderTransaction[] = [];
  // Pattern: find <tr> blocks with transaction data
  const trs = text.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];

  for (const tr of trs) {
    const cells = (tr.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) ?? [])
      .map(td => td.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());

    if (cells.length < 5) continue;

    // Typical GPW columns: ticker | person | role | type | shares | value | date
    const [ticker, person, role, typeRaw, sharesRaw, valueRaw, dateRaw] = cells;
    if (!ticker || ticker.length > 10) continue;

    const txType = typeRaw?.toLowerCase().includes("naby") ? "BUY"
      : typeRaw?.toLowerCase().includes("zbyc") ? "SELL"
      : null;

    if (!txType) continue;

    rows.push({
      ticker:           ticker.toUpperCase(),
      person_name:      person || null,
      role:             role   || null,
      transaction_type: txType,
      shares_count:     parseNum(sharesRaw),
      value_pln:        parseNum(valueRaw),
      transaction_date: dateRaw ? dateRaw.slice(0, 10) : null,
      source:           "gpw",
      event_id:         null,
    });
  }

  if (rows.length === 0) throw new Error("GPW returned 0 parseable rows");
  return rows;
}

// ─── Source 2: ESPI pipeline (company_events) ────────────────────────────────

async function fetchFromESPI(
  supabase: ReturnType<typeof createClient>,
): Promise<InsiderTransaction[]> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  // Build OR filter for insider keywords
  const filters = INSIDER_KEYWORDS.map(k =>
    `title.ilike.%${encodeURIComponent(k)}%`
  ).join(",");

  const { data: events, error } = await supabase
    .from("company_events")
    .select("id, ticker, title, published_at")
    .or(filters)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(`ESPI query error: ${error.message}`);
  if (!events?.length) return [];

  const rows: InsiderTransaction[] = [];

  for (const ev of events) {
    const txType = detectTransactionType(ev.title);
    if (!txType) continue;

    rows.push({
      ticker:           ev.ticker,
      person_name:      extractPersonName(ev.title),
      role:             null,
      transaction_type: txType,
      shares_count:     null,
      value_pln:        extractValueFromTitle(ev.title),
      transaction_date: ev.published_at ? ev.published_at.slice(0, 10) : null,
      source:           "espi",
      event_id:         ev.id,
    });
  }

  return rows;
}

// ─── Telegram helper ─────────────────────────────────────────────────────────

async function sendTelegram(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}`);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  console.log("[fetch-insider] Invoked at:", new Date().toISOString());

  const supabaseUrl = Deno.env.get("SUPABASE_URL")              ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const tgToken     = Deno.env.get("TELEGRAM_BOT_TOKEN")        ?? "";
  const tgChatId    = Deno.env.get("TELEGRAM_CHAT_ID")          ?? "";

  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing Supabase env vars" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // ── Fetch transactions ────────────────────────────────────────────────────
  let transactions: InsiderTransaction[] = [];
  let sourceUsed = "none";

  // Try GPW first (likely blocked from EF IPs — see lessons-learned.md)
  try {
    transactions = await fetchFromGPW();
    sourceUsed   = "gpw";
    console.log(`[fetch-insider] GPW: ${transactions.length} transactions`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[fetch-insider] GPW failed (expected from EF IPs): ${msg}`);
  }

  // Fallback: ESPI pipeline
  if (transactions.length === 0) {
    try {
      transactions = await fetchFromESPI(supabase);
      sourceUsed   = "espi";
      console.log(`[fetch-insider] ESPI fallback: ${transactions.length} transactions`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[fetch-insider] ESPI fallback failed: ${msg}`);
    }
  }

  if (transactions.length === 0) {
    console.log("[fetch-insider] No insider transactions found");
    return new Response(
      JSON.stringify({ ok: true, inserted: 0, alerted: 0, source: sourceUsed, ts: new Date().toISOString() }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── Upsert transactions ───────────────────────────────────────────────────
  let inserted = 0;
  let alerted  = 0;

  for (const tx of transactions) {
    const { data: inserted_row, error: upsertErr } = await supabase
      .from("insider_transactions")
      .upsert({
        ticker:           tx.ticker,
        person_name:      tx.person_name,
        role:             tx.role,
        transaction_type: tx.transaction_type,
        shares_count:     tx.shares_count,
        value_pln:        tx.value_pln,
        transaction_date: tx.transaction_date,
        source:           tx.source,
        event_id:         tx.event_id,
      }, { onConflict: "idx_insider_unique", ignoreDuplicates: true })
      .select("id, alerted_at")
      .maybeSingle();

    if (upsertErr) {
      console.warn(`[fetch-insider] Upsert error for ${tx.ticker}: ${upsertErr.message}`);
      continue;
    }

    inserted++;

    // Send Telegram alert for significant new transactions (not yet alerted)
    if (!inserted_row?.alerted_at && tgToken && tgChatId) {
      const value = tx.value_pln ?? 0;
      const shouldAlert =
        (tx.transaction_type === "BUY"  && value > BUY_ALERT_THRESHOLD) ||
        (tx.transaction_type === "SELL" && value > SELL_ALERT_THRESHOLD);

      if (shouldAlert) {
        const icon       = tx.transaction_type === "BUY" ? "🟢" : "🔴";
        const actionStr  = tx.transaction_type === "BUY" ? "Kupił" : "Sprzedał";
        const valueStr   = value > 0 ? ` za ${value.toLocaleString("pl-PL")} PLN` : "";
        const sharesStr  = tx.shares_count ? ` ${tx.shares_count.toLocaleString("pl-PL")} akcji` : "";
        const personStr  = tx.person_name ? `\n👤 ${tx.person_name}${tx.role ? ` (${tx.role})` : ""}` : "";
        const dateStr    = tx.transaction_date ?? "—";

        const text = [
          `${icon} *INSIDER ${tx.transaction_type}ING*`,
          `📊 *${tx.ticker}*`,
          `💰 ${actionStr}${sharesStr}${valueStr}`,
          `📅 ${dateStr}`,
          personStr,
        ].filter(Boolean).join("\n");

        try {
          await sendTelegram(tgToken, tgChatId, text);
          await supabase
            .from("insider_transactions")
            .update({ alerted_at: new Date().toISOString() })
            .eq("id", inserted_row.id);
          alerted++;
          console.log(`[fetch-insider] Alert sent for ${tx.ticker} ${tx.transaction_type}`);
          await sleep(300);
        } catch (tgErr) {
          console.warn(`[fetch-insider] Telegram failed: ${tgErr instanceof Error ? tgErr.message : String(tgErr)}`);
        }
      }
    }
  }

  console.log(`[fetch-insider] Done: inserted=${inserted} alerted=${alerted} source=${sourceUsed}`);

  return new Response(
    JSON.stringify({ ok: true, inserted, alerted, source: sourceUsed, ts: new Date().toISOString() }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
