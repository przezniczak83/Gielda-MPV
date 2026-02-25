// supabase/functions/send-alerts/index.ts
// Wysyła alerty Telegram dla eventów z impact_score >= 7
// gdzie alerted_at IS NULL (jeszcze nie wysłane).
//
// Idempotentne: po wysłaniu ustawia alerted_at = now().
// Cron: */5 * * * * (co 5 minut)
//
// Wymagane Secrets:
//   TELEGRAM_BOT_TOKEN — token bota (@BotFather)
//   TELEGRAM_CHAT_ID   — chat_id odbiorcy / grupy
//
// Deploy: supabase functions deploy send-alerts --project-ref pftgmorsthoezhmojjpg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventRow {
  id:           string;
  ticker:       string;
  title:        string;
  event_type:   string | null;
  impact_score: number;
  published_at: string | null;
  url:          string | null;
}

// ─── Telegram helper ─────────────────────────────────────────────────────────

async function sendTelegram(token: string, chatId: string, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res  = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      chat_id:    chatId,
      text,
      parse_mode: "Markdown",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body}`);
  }
}

/** Format event as Telegram message. */
function formatMessage(e: EventRow): string {
  const dateStr   = e.published_at ? e.published_at.slice(0, 10) : "—";
  const scoreStr  = `${e.impact_score}/10`;
  const eventType = e.event_type ? ` (${e.event_type})` : "";

  const lines = [
    "🚨 *ALERT GIEŁDOWY*",
    `📊 *${e.ticker}*${eventType}`,
    `📝 ${e.title}`,
    `⚡ Impact: *${scoreStr}*`,
    `📅 ${dateStr}`,
  ];

  if (e.url) lines.push(e.url);

  return lines.join("\n");
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_IMPACT_SCORE = 7;
const WINDOW_HOURS     = 24;
const SLEEP_MS         = 300; // pause between Telegram messages to avoid rate limit

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  console.log("[send-alerts] Invoked at:", new Date().toISOString());

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")              ?? "";
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const tgToken      = Deno.env.get("TELEGRAM_BOT_TOKEN")        ?? "";
  const tgChatId     = Deno.env.get("TELEGRAM_CHAT_ID")          ?? "";

  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing Supabase env vars" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!tgToken || !tgChatId) {
    console.warn("[send-alerts] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping");
    return new Response(
      JSON.stringify({ ok: true, sent: 0, skipped_reason: "telegram_not_configured", ts: new Date().toISOString() }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // ── Fetch unalerted high-impact events ────────────────────────────────────
  const windowStart = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();

  const { data: events, error: fetchErr } = await supabase
    .from("company_events")
    .select("id, ticker, title, event_type, impact_score, published_at, url")
    .gte("impact_score", MIN_IMPACT_SCORE)
    .is("alerted_at", null)
    .gte("created_at", windowStart)
    .order("impact_score", { ascending: false })
    .order("created_at",   { ascending: true });

  if (fetchErr) {
    console.error("[send-alerts] Fetch error:", fetchErr.message);
    return new Response(
      JSON.stringify({ ok: false, error: fetchErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const rows = (events ?? []) as EventRow[];
  console.log(`[send-alerts] Found ${rows.length} unalerted event(s) with score >= ${MIN_IMPACT_SCORE}`);

  if (rows.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, sent: 0, ts: new Date().toISOString() }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── Send and mark ─────────────────────────────────────────────────────────
  let sent   = 0;
  let failed = 0;

  for (const event of rows) {
    try {
      const message = formatMessage(event);
      await sendTelegram(tgToken, tgChatId, message);

      // Mark as alerted
      const { error: updateErr } = await supabase
        .from("company_events")
        .update({ alerted_at: new Date().toISOString() })
        .eq("id", event.id);

      if (updateErr) {
        console.warn(`[send-alerts] id=${event.id} alerted_at update failed: ${updateErr.message}`);
      }

      sent++;
      console.log(`[send-alerts] Sent alert for ${event.ticker} id=${event.id} score=${event.impact_score}`);

      if (sent < rows.length) await sleep(SLEEP_MS);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[send-alerts] id=${event.id} failed: ${msg}`);
      failed++;
    }
  }

  console.log(`[send-alerts] Done: sent=${sent} failed=${failed}`);

  return new Response(
    JSON.stringify({ ok: true, sent, failed, ts: new Date().toISOString() }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
