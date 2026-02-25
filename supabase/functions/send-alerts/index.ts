// supabase/functions/send-alerts/index.ts
// Wysyła alerty Telegram dla eventów z impact_score >= 7
// gdzie alerted_at IS NULL (jeszcze nie wysłane).
//
// Idempotentne: po wysłaniu ustawia alerted_at = now().
// Cron: */5 * * * * (co 5 minut)
//
// Deploy: supabase functions deploy send-alerts --project-ref pftgmorsthoezhmojjpg

import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { createLogger }      from "../_shared/logger.ts";
import { sendTelegram }      from "../_shared/telegram.ts";
import { okResponse, errorResponse } from "../_shared/response.ts";

const log = createLogger("send-alerts");

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

const MIN_IMPACT_SCORE = 7;
const WINDOW_HOURS     = 24;
const SLEEP_MS         = 300;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  log.info("Invoked at:", new Date().toISOString());

  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err));
  }

  const tgToken  = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const tgChatId = Deno.env.get("TELEGRAM_CHAT_ID")   ?? "";

  if (!tgToken || !tgChatId) {
    log.warn("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping");
    return okResponse({ sent: 0, skipped_reason: "telegram_not_configured" });
  }

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
    log.error("Fetch error:", fetchErr.message);
    return errorResponse(fetchErr.message);
  }

  const rows = (events ?? []) as EventRow[];
  log.info(`Found ${rows.length} unalerted event(s) with score >= ${MIN_IMPACT_SCORE}`);

  if (rows.length === 0) {
    return okResponse({ sent: 0 });
  }

  // ── Send and mark ─────────────────────────────────────────────────────────
  let sent   = 0;
  let failed = 0;

  for (const event of rows) {
    try {
      const message = formatMessage(event);
      const ok      = await sendTelegram(message);

      if (!ok) throw new Error("sendTelegram returned false");

      const { error: updateErr } = await supabase
        .from("company_events")
        .update({ alerted_at: new Date().toISOString() })
        .eq("id", event.id);

      if (updateErr) {
        log.warn(`id=${event.id} alerted_at update failed:`, updateErr.message);
      }

      sent++;
      log.info(`Sent alert for ${event.ticker} id=${event.id} score=${event.impact_score}`);

      if (sent < rows.length) await sleep(SLEEP_MS);
    } catch (err) {
      log.error(`id=${event.id} failed:`, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }

  log.info(`Done: sent=${sent} failed=${failed}`);
  return okResponse({ sent, failed });
});
