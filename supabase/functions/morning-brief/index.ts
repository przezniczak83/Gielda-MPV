// supabase/functions/morning-brief/index.ts
// Dzienny Telegram digest — wysyłany o 7:00 w dni robocze.
//
// Zbiera z ostatnich 12h:
//   - Alerty z wysokim impact (>= 6)
//   - Nadchodzące eventy z kalendarza (dziś + jutro)
//   - Nowe rekomendacje analityków
//   - Aktualne wskaźniki makro
//
// Deploy: supabase functions deploy morning-brief --project-ref pftgmorsthoezhmojjpg
// Cron: migration 0029_morning_brief_cron.sql (0 7 * * 1-5)

import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { createLogger }      from "../_shared/logger.ts";
import { sendTelegram }      from "../_shared/telegram.ts";
import { sendEmail, buildMorningBriefEmail } from "../_shared/email.ts";
import { okResponse, errorResponse } from "../_shared/response.ts";

const log = createLogger("morning-brief");

// ─── Types ────────────────────────────────────────────────────────────────────

interface AlertRow {
  ticker:       string;
  title:        string;
  event_type:   string | null;
  impact_score: number;
  published_at: string | null;
}

interface CalendarRow {
  ticker:     string;
  title:      string;
  event_type: string;
  event_date: string;
}

interface RecommendationRow {
  ticker:         string;
  institution:    string | null;
  recommendation: string;
  price_target:   number | null;
  upside_pct:     number | null;
}

interface MacroRow {
  name:       string;
  value:      number;
  change_pct: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayPL(): string {
  return new Date().toLocaleDateString("pl-PL", {
    weekday: "long",
    day:     "numeric",
    month:   "long",
    year:    "numeric",
    timeZone: "Europe/Warsaw",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pl-PL", {
    hour:     "2-digit",
    minute:   "2-digit",
    timeZone: "Europe/Warsaw",
  });
}

function formatChangePct(v: number | null): string {
  if (v === null) return "";
  const sign = v >= 0 ? "▲" : "▼";
  return ` (${sign} ${Math.abs(v).toFixed(2)}%)`;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  earnings:        "Wyniki",
  dividend_exdate: "Ex-Dywidenda",
  agm:             "WZA",
  analyst_day:     "Dzień Analityków",
  other:           "Inne",
};

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  log.info("morning-brief invoked at:", new Date().toISOString());

  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : String(err));
  }

  const since    = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
  const now      = new Date().toISOString();
  const tomorrow = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

  // ── Parallel data fetch ───────────────────────────────────────────────────
  const [alertsRes, calendarRes, recsRes, macroRes] = await Promise.all([
    supabase
      .from("company_events")
      .select("ticker, title, event_type, impact_score, published_at")
      .gte("published_at", since)
      .gte("impact_score", 6)
      .order("impact_score", { ascending: false })
      .limit(5),

    supabase
      .from("calendar_events")
      .select("ticker, title, event_type, event_date")
      .gte("event_date", now)
      .lte("event_date", tomorrow)
      .order("event_date", { ascending: true })
      .limit(5),

    supabase
      .from("analyst_forecasts")
      .select("ticker, institution, recommendation, price_target, upside_pct")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(3),

    supabase
      .from("macro_indicators")
      .select("name, value, change_pct, fetched_at")
      .in("name", ["EUR/PLN", "USD/PLN", "Fed Funds Rate", "US 10Y Treasury"])
      .order("fetched_at", { ascending: false })
      .limit(8),
  ]);

  const alerts  = (alertsRes.data   ?? []) as AlertRow[];
  const calendar = (calendarRes.data ?? []) as CalendarRow[];
  const recs    = (recsRes.data     ?? []) as RecommendationRow[];

  // Deduplicate macro — keep latest per name
  const macroMap = new Map<string, MacroRow>();
  for (const row of (macroRes.data ?? []) as (MacroRow & { fetched_at: string })[]) {
    if (!macroMap.has(row.name)) macroMap.set(row.name, row);
  }
  const macro = Array.from(macroMap.values());

  log.info(`alerts=${alerts.length} calendar=${calendar.length} recs=${recs.length} macro=${macro.length}`);

  // ── Build message ─────────────────────────────────────────────────────────
  const lines: string[] = [];

  lines.push(`🌅 *MORNING BRIEF* — ${todayPL()}`);
  lines.push("━━━━━━━━━━━━━━━━━━━━");

  // Alerts section
  lines.push(`⚡ *ALERTY Z NOCY* (${alerts.length} event${alerts.length !== 1 ? "ów" : ""})`);
  if (alerts.length === 0) {
    lines.push("Spokojna noc — brak alertów ≥6 🟢");
  } else {
    for (const a of alerts) {
      const type = a.event_type ? ` _(${a.event_type})_` : "";
      lines.push(`*${a.ticker}*${type} — ${a.title} (impact: ${a.impact_score}/10)`);
    }
  }

  // Calendar section (only if not empty)
  if (calendar.length > 0) {
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("📅 *DZIŚ W KALENDARZU*");
    for (const ev of calendar) {
      const time  = formatTime(ev.event_date);
      const label = EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type;
      lines.push(`${time} *${ev.ticker}* — ${ev.title} _(${label})_`);
    }
  }

  // Recommendations section (only if not empty)
  if (recs.length > 0) {
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("💼 *NOWE REKOMENDACJE*");
    for (const r of recs) {
      const inst   = r.institution ? `${r.institution}: ` : "";
      const pt     = r.price_target ? `, PT ${r.price_target.toFixed(0)} PLN` : "";
      const upside = r.upside_pct != null ? ` (${r.upside_pct >= 0 ? "+" : ""}${r.upside_pct.toFixed(0)}%)` : "";
      lines.push(`*${r.ticker}* — ${inst}${r.recommendation}${pt}${upside}`);
    }
  }

  // Macro section (always show if data available)
  if (macro.length > 0) {
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("🌍 *MAKRO*");
    for (const m of macro) {
      const val   = Number(m.value).toFixed(["EUR/PLN", "USD/PLN"].includes(m.name) ? 4 : 2);
      const chg   = formatChangePct(m.change_pct);
      const unit  = ["EUR/PLN", "USD/PLN"].includes(m.name) ? "" : "%";
      lines.push(`${m.name}: *${val}${unit}*${chg}`);
    }
  }

  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push("🔗 gielda-mpv.vercel.app");

  const message = lines.join("\n");

  // ── Send Telegram ──────────────────────────────────────────────────────────
  const tgSent = await sendTelegram(message);
  if (!tgSent) {
    log.warn("Telegram not configured or send failed");
  } else {
    log.info("Morning brief sent via Telegram");
  }

  // ── Send Email ─────────────────────────────────────────────────────────────
  const alertEmail = Deno.env.get("ALERT_EMAIL") ?? "";
  let emailSent = false;
  if (alertEmail && Deno.env.get("RESEND_API_KEY")) {
    const dateStr = new Date().toLocaleDateString("pl-PL", {
      day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Warsaw",
    });
    const { subject, html, text } = buildMorningBriefEmail({
      date:    dateStr,
      events:  alerts,
      sentiment: null,
    });
    emailSent = await sendEmail({ to: alertEmail, subject, html, text });
    if (emailSent) log.info("Morning brief sent via email");
  }

  log.info(`Done: tg=${tgSent} email=${emailSent}`);
  return okResponse({ sent: tgSent || emailSent, telegram: tgSent, email: emailSent, alerts: alerts.length, calendar: calendar.length, recs: recs.length });
});
