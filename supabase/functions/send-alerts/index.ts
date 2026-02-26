// supabase/functions/send-alerts/index.ts
// Wysyła alerty Telegram dla eventów spełniających reguły z alert_rules.
//
// Logika:
//   1. Załaduj aktywne reguły z telegram_enabled=true
//   2. Dla każdego eventu (niezaalertowanego w oknie 24h):
//      a. Sprawdź threshold_value/operator
//      b. Sprawdź compound conditions JSONB (AND logic)
//      c. Sprawdź cooldown_hours per ticker (via alerted_at)
//   3. Wyślij Telegram i oznacz alerted_at
//
// Idempotentne — alerted_at zapobiega podwójnemu wysłaniu.
// Cron: */5 * * * *
//
// Deploy: supabase functions deploy send-alerts --project-ref pftgmorsthoezhmojjpg

import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { createLogger }      from "../_shared/logger.ts";
import { sendTelegram }      from "../_shared/telegram.ts";
import { sendEmail, buildAlertEmail } from "../_shared/email.ts";
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

interface AlertRule {
  id:                 number;
  rule_type:          string;
  rule_name:          string;
  threshold_value:    number | null;
  threshold_operator: string | null;
  ticker:             string | null;
  telegram_enabled:   boolean;
  cooldown_hours:     number | null;
  conditions:         Array<{ field: string; op: string; value: unknown }> | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_MIN_IMPACT = 7;
const WINDOW_HOURS       = 24;
const SLEEP_MS           = 300;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Format event as Telegram message. */
function formatMessage(e: EventRow, ruleName: string): string {
  const dateStr   = e.published_at ? e.published_at.slice(0, 10) : "—";
  const scoreStr  = `${e.impact_score}/10`;
  const eventType = e.event_type ? ` (${e.event_type})` : "";

  const lines = [
    "🚨 *ALERT GIEŁDOWY*",
    `📊 *${e.ticker}*${eventType}`,
    `📝 ${e.title}`,
    `⚡ Impact: *${scoreStr}* · Reguła: ${ruleName}`,
    `📅 ${dateStr}`,
  ];
  if (e.url) lines.push(e.url);
  return lines.join("\n");
}

/** Evaluate threshold: compares event field against rule threshold. */
function evalThreshold(
  event: EventRow,
  ruleType: string,
  op: string | null,
  threshold: number | null,
): boolean {
  if (threshold === null || op === null) return true; // no threshold = always match

  let val: number | null = null;
  if (ruleType === "impact_score") val = event.impact_score;
  if (val === null) return false;

  switch (op) {
    case ">":  return val >  threshold;
    case "<":  return val <  threshold;
    case ">=": return val >= threshold;
    case "<=": return val <= threshold;
    case "=":  return val === threshold;
    default:   return false;
  }
}

/** Evaluate compound conditions JSONB (all must pass = AND logic). */
function evalConditions(
  event: EventRow,
  conditions: Array<{ field: string; op: string; value: unknown }> | null,
): boolean {
  if (!conditions || conditions.length === 0) return true;

  for (const cond of conditions) {
    const { field, op, value } = cond;
    let actual: unknown;

    if (field === "event_type")   actual = event.event_type;
    else if (field === "ticker")  actual = event.ticker;
    else if (field === "impact_score") actual = event.impact_score;
    else continue; // unknown field → skip condition

    if (op === "=")  { if (actual !== value)    return false; }
    if (op === "!=") { if (actual === value)     return false; }
    if (op === ">=") { if (Number(actual) < Number(value)) return false; }
    if (op === "<=") { if (Number(actual) > Number(value)) return false; }
  }

  return true;
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

  const tgToken    = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const tgChatId   = Deno.env.get("TELEGRAM_CHAT_ID")   ?? "";
  const alertEmail = Deno.env.get("ALERT_EMAIL")        ?? "";
  const tgOk       = !!(tgToken && tgChatId);
  const emailOk    = !!(alertEmail && Deno.env.get("RESEND_API_KEY"));

  if (!tgOk && !emailOk) {
    log.warn("Neither Telegram nor Email configured — skipping");
    return okResponse({ sent: 0, skipped_reason: "no_notification_channel" });
  }

  // ── Load active alert rules ────────────────────────────────────────────────
  const { data: rulesData, error: rulesErr } = await supabase
    .from("alert_rules")
    .select("id, rule_name, rule_type, threshold_value, threshold_operator, ticker, telegram_enabled, cooldown_hours, conditions")
    .eq("is_active", true)
    .eq("telegram_enabled", true);

  if (rulesErr) {
    log.error("Rules fetch error:", rulesErr.message);
    return errorResponse(rulesErr.message);
  }

  const rules = (rulesData ?? []) as AlertRule[];
  if (rules.length === 0) {
    log.info("No active telegram-enabled rules");
    return okResponse({ sent: 0, skipped_reason: "no_rules" });
  }

  // Find minimum impact threshold across all impact_score rules
  const impactRules = rules.filter(r => r.rule_type === "impact_score" && r.threshold_value !== null);
  const minImpact   = impactRules.length > 0
    ? Math.min(...impactRules.map(r => r.threshold_value!))
    : DEFAULT_MIN_IMPACT;

  log.info(`Loaded ${rules.length} rule(s). Min impact threshold: ${minImpact}`);

  // ── Fetch candidate events ─────────────────────────────────────────────────
  const windowStart = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();

  const { data: events, error: fetchErr } = await supabase
    .from("company_events")
    .select("id, ticker, title, event_type, impact_score, published_at, url")
    .gte("impact_score", minImpact)
    .is("alerted_at", null)
    .gte("created_at", windowStart)
    .order("impact_score", { ascending: false })
    .order("created_at",   { ascending: true });

  if (fetchErr) {
    log.error("Fetch error:", fetchErr.message);
    return errorResponse(fetchErr.message);
  }

  const rows = (events ?? []) as EventRow[];
  log.info(`Candidate events: ${rows.length}`);

  if (rows.length === 0) {
    return okResponse({ sent: 0 });
  }

  // ── Track cooldown: get last alerted_at per ticker ─────────────────────────
  // We only need tickers that appear in our candidates
  const candidateTickers = [...new Set(rows.map(e => e.ticker))];
  const { data: lastAlerts } = await supabase
    .from("company_events")
    .select("ticker, alerted_at")
    .in("ticker", candidateTickers)
    .not("alerted_at", "is", null)
    .order("alerted_at", { ascending: false });

  // Build map: ticker → latest alerted_at timestamp
  const lastAlertedAt = new Map<string, Date>();
  for (const row of (lastAlerts ?? []) as { ticker: string; alerted_at: string }[]) {
    if (!lastAlertedAt.has(row.ticker)) {
      lastAlertedAt.set(row.ticker, new Date(row.alerted_at));
    }
  }

  // ── Process each event against each rule ──────────────────────────────────
  let sent   = 0;
  let failed = 0;
  const alertedIds = new Set<string>(); // prevent double-alerting same event

  for (const event of rows) {
    if (alertedIds.has(event.id)) continue;

    // Find matching rule(s)
    let matchedRule: AlertRule | null = null;
    for (const rule of rules) {
      // Ticker filter
      if (rule.ticker && rule.ticker !== event.ticker) continue;

      // Threshold check
      if (!evalThreshold(event, rule.rule_type, rule.threshold_operator, rule.threshold_value)) continue;

      // Compound conditions
      if (!evalConditions(event, rule.conditions)) continue;

      // Cooldown check
      const cooldown = rule.cooldown_hours ?? 24;
      const last = lastAlertedAt.get(event.ticker);
      if (last) {
        const ageHours = (Date.now() - last.getTime()) / 3_600_000;
        if (ageHours < cooldown) {
          log.info(`${event.ticker} skipped — cooldown (${ageHours.toFixed(1)}h < ${cooldown}h)`);
          continue;
        }
      }

      matchedRule = rule;
      break; // first matching rule wins
    }

    if (!matchedRule) continue;

    try {
      let anyOk = false;

      // ── Telegram ──────────────────────────────────────────────────────────
      if (tgOk) {
        const message = formatMessage(event, matchedRule.rule_name);
        const tgSent  = await sendTelegram(message);
        if (tgSent) anyOk = true;
        else log.warn(`${event.ticker} Telegram send failed`);
      }

      // ── Email (for high-impact events: score >= 8) ─────────────────────
      if (emailOk && event.impact_score >= 8) {
        const { subject, html, text } = buildAlertEmail({
          ticker:       event.ticker,
          title:        event.title,
          impact_score: event.impact_score,
          event_type:   event.event_type,
          published_at: event.published_at,
        });
        const emailSent = await sendEmail({ to: alertEmail, subject, html, text });
        if (emailSent) { anyOk = true; log.info(`${event.ticker} email sent`); }
      }

      if (!anyOk) throw new Error("All notification channels failed");

      const now = new Date().toISOString();
      const { error: updateErr } = await supabase
        .from("company_events")
        .update({ alerted_at: now })
        .eq("id", event.id);

      if (updateErr) {
        log.warn(`id=${event.id} alerted_at update failed:`, updateErr.message);
      }

      alertedIds.add(event.id);
      lastAlertedAt.set(event.ticker, new Date(now)); // update in-memory cooldown
      sent++;
      log.info(`Sent: ${event.ticker} id=${event.id} score=${event.impact_score} rule=${matchedRule.rule_name}`);

      if (sent < rows.length) await sleep(SLEEP_MS);
    } catch (err) {
      log.error(`id=${event.id} failed:`, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }

  log.info(`Done: sent=${sent} failed=${failed}`);
  return okResponse({ sent, failed });
});
