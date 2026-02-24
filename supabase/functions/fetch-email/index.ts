// supabase/functions/fetch-email/index.ts
// Checkpoint 3.6: Gmail IMAP → raw_ingest
// Reads UNSEEN emails from espi@gpw.pl, parses ESPI data, inserts to raw_ingest.
//
// Deploy: supabase functions deploy fetch-email --project-ref <ref>
// Secrets (set via CLI):
//   supabase secrets set GMAIL_EMAIL=... GMAIL_APP_PASSWORD=... --project-ref <ref>
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ImapFlow }     from "npm:imapflow@1";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmailRecord {
  ticker:       string;
  title:        string;
  url:          string | null;
  published_at: string | null;
}

// ─── Parse helpers ────────────────────────────────────────────────────────────

/**
 * Extract ticker + title from Subject line.
 * Expected format: "PKN - Raport okresowy roczny 2025"
 */
function parseSubject(subject: string): { ticker: string; title: string } | null {
  const m = subject.match(/^([A-Z0-9]{1,10})\s*-\s*(.+)$/);
  if (!m) return null;
  return { ticker: m[1].trim().toUpperCase(), title: m[2].trim() };
}

/**
 * Extract text content from the second <td> after a label <td>.
 * Handles both plain text cells and cells containing an <a> tag.
 *
 * Example:
 *   <td>Ticker:</td><td>PKN</td>
 *   <td>Link:</td><td><a href="...">tekst</a></td>
 */
function extractTableCell(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<td[^>]*>\\s*${escaped}\\s*:?\\s*</td>\\s*<td[^>]*>(.*?)</td>`,
    "is",
  );
  const m = html.match(re);
  if (!m) return null;
  // Strip HTML tags, decode entities, collapse whitespace
  return m[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

/**
 * Extract href URL from the Link row.
 * <td>Link:</td><td><a href="https://...">...</a></td>
 */
function extractLink(html: string): string | null {
  const re = /<td[^>]*>\s*Link\s*:?\s*<\/td>\s*<td[^>]*>.*?href="([^"]+)"/is;
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Parse date string → ISO 8601.
 * Accepts: "2026-02-24", "2026-02-24T10:30:00Z", "24.02.2026"
 */
function parseDate(raw: string | null): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const ddmm = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (ddmm) {
    const d = new Date(`${ddmm[3]}-${ddmm[2]}-${ddmm[1]}`);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_EMAILS = 20;
const ESPI_FROM  = "espi@gpw.pl";

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  console.log("[fetch-email] Function invoked at:", new Date().toISOString());

  // ── Env vars ──────────────────────────────────────────────────────────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL")              ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const gmailEmail  = Deno.env.get("GMAIL_EMAIL")               ?? "";
  const gmailPass   = Deno.env.get("GMAIL_APP_PASSWORD")        ?? "";

  const missing = (
    [
      ["SUPABASE_URL",              supabaseUrl],
      ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
      ["GMAIL_EMAIL",               gmailEmail],
      ["GMAIL_APP_PASSWORD",        gmailPass],
    ] as [string, string][]
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    const msg = `Missing env vars: ${missing.join(", ")}`;
    console.error("[fetch-email]", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // ── IMAP ──────────────────────────────────────────────────────────────────
  const imap = new ImapFlow({
    host:   "imap.gmail.com",
    port:   993,
    secure: true,
    auth:   { user: gmailEmail, pass: gmailPass },
    logger: false,
  });

  const records: EmailRecord[] = [];
  const errors:  string[]      = [];

  try {
    await imap.connect();
    console.log("[fetch-email] IMAP connected");

    const lock = await imap.getMailboxLock("INBOX");
    try {
      const uids = await imap.search(
        { unseen: true, from: ESPI_FROM },
        { uid: true },
      );
      console.log(`[fetch-email] Found ${uids.length} unseen ESPI email(s)`);

      const toProcess = uids.slice(0, MAX_EMAILS);

      for (const uid of toProcess) {
        try {
          // Fetch full RFC822 source (envelope + raw MIME)
          const msg = await imap.fetchOne(
            String(uid),
            { envelope: true, source: true },
            { uid: true },
          );

          if (!msg) {
            console.warn(`[fetch-email] uid ${uid}: empty fetch — skipping`);
            continue;
          }

          const subject = msg.envelope?.subject ?? "";
          const parsed  = parseSubject(subject);

          if (!parsed) {
            console.warn(`[fetch-email] uid ${uid}: unparseable subject "${subject}" — skipping`);
            continue;
          }

          const rawMime = msg.source
            ? new TextDecoder("utf-8", { fatal: false }).decode(msg.source)
            : "";

          // Extract structured fields from HTML body
          const tickerFromBody = extractTableCell(rawMime, "Ticker");
          const ticker         = (tickerFromBody ?? parsed.ticker).toUpperCase();
          const url            = extractLink(rawMime);
          const publishedRaw   = extractTableCell(rawMime, "Data publikacji");
          const published_at   = parseDate(publishedRaw);

          records.push({ ticker, title: parsed.title, url, published_at });

          // Mark as SEEN so we don't re-process on next run
          await imap.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true });

          console.log(`[fetch-email] uid ${uid}: parsed ticker=${ticker}, published_at=${published_at}`);
        } catch (msgErr) {
          const errMsg = msgErr instanceof Error ? msgErr.message : String(msgErr);
          console.error(`[fetch-email] uid ${uid} error:`, errMsg);
          errors.push(`uid=${uid}: ${errMsg}`);
        }
      }
    } finally {
      lock.release();
    }
  } catch (connErr) {
    const errMsg = connErr instanceof Error ? connErr.message : String(connErr);
    console.error("[fetch-email] IMAP connection error:", errMsg);
    return new Response(
      JSON.stringify({ ok: false, error: `IMAP: ${errMsg}` }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  } finally {
    try { await imap.logout(); } catch { /* ignore logout errors */ }
    console.log("[fetch-email] IMAP disconnected");
  }

  if (records.length === 0) {
    console.log("[fetch-email] No new records to insert");
    return new Response(
      JSON.stringify({ ok: true, inserted: 0, source: "email", ts: new Date().toISOString() }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── Insert to raw_ingest ──────────────────────────────────────────────────
  console.log(`[fetch-email] Inserting ${records.length} record(s) to raw_ingest`);

  const rows = records.map(r => ({
    source:  "email",
    payload: r as unknown as Record<string, unknown>,
  }));

  const { data, error } = await supabase
    .from("raw_ingest")
    .insert(rows)
    .select("id");

  if (error) {
    console.error("[fetch-email] Insert error:", error.message);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const inserted = data?.length ?? 0;
  console.log(`[fetch-email] Successfully inserted ${inserted} record(s)`);

  return new Response(
    JSON.stringify({
      ok:       true,
      inserted,
      source:   "email",
      ts:       new Date().toISOString(),
      ...(errors.length > 0 && { partial_errors: errors }),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
