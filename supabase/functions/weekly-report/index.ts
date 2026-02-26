// supabase/functions/weekly-report/index.ts
// Generates an AI-powered weekly market summary, stores in weekly_reports,
// and sends a digest to Telegram.
//
// POST {} — generate report for the current/last week
// POST { week_start: "2026-02-17" } — generate for a specific week
//
// Deploy: supabase functions deploy weekly-report --project-ref pftgmorsthoezhmojjpg

import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { createLogger }      from "../_shared/logger.ts";
import { sendTelegram }      from "../_shared/telegram.ts";
import { callAnthropic }     from "../_shared/anthropic.ts";
import { okResponse, errorResponse } from "../_shared/response.ts";

const log = createLogger("weekly-report");

interface EventRow {
  ticker:       string;
  title:        string;
  event_type:   string | null;
  impact_score: number | null;
  published_at: string | null;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun, 1=Mon,...
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function getFridayOf(monday: Date): Date {
  const d = new Date(monday);
  d.setUTCDate(d.getUTCDate() + 4);
  return d;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  let body: { week_start?: string; force?: boolean } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  let supabase;
  try { supabase = getSupabaseClient(); }
  catch (err) { return errorResponse(err instanceof Error ? err.message : String(err)); }

  // ── Determine week range ────────────────────────────────────────────────────
  const refDate  = body.week_start ? new Date(body.week_start) : new Date();
  const monday   = getMondayOf(refDate);
  const friday   = getFridayOf(monday);
  const weekStart = toISODate(monday);
  const weekEnd   = toISODate(friday);

  log.info(`Generating weekly report for ${weekStart} – ${weekEnd}`);

  // ── Check if already generated ─────────────────────────────────────────────
  if (!body.force) {
    const { data: existing } = await supabase
      .from("weekly_reports")
      .select("id, generated_at")
      .eq("week_start", weekStart)
      .maybeSingle();

    if (existing) {
      log.info(`Report for ${weekStart} already exists (id=${existing.id})`);
      return okResponse({ message: "already_generated", week_start: weekStart, id: existing.id });
    }
  }

  // ── Fetch events for the week ───────────────────────────────────────────────
  const { data: events, error: evErr } = await supabase
    .from("company_events")
    .select("ticker, title, event_type, impact_score, published_at")
    .gte("published_at", `${weekStart}T00:00:00Z`)
    .lte("published_at", `${weekEnd}T23:59:59Z`)
    .order("impact_score", { ascending: false })
    .limit(100);

  if (evErr) return errorResponse(evErr.message);
  const rows = (events ?? []) as EventRow[];

  log.info(`Found ${rows.length} events for the week`);

  // ── Compute stats ──────────────────────────────────────────────────────────
  const highImpact   = rows.filter(e => (e.impact_score ?? 0) >= 7);
  const eventCount   = rows.length;
  const highImpactN  = highImpact.length;

  // Top tickers by event count + avg score
  const tickerMap = new Map<string, { count: number; sum: number }>();
  for (const e of rows) {
    const t = tickerMap.get(e.ticker) ?? { count: 0, sum: 0 };
    t.count++;
    t.sum += e.impact_score ?? 0;
    tickerMap.set(e.ticker, t);
  }
  const topTickers = [...tickerMap.entries()]
    .map(([ticker, { count, sum }]) => ({ ticker, event_count: count, avg_score: Math.round((sum / count) * 10) / 10 }))
    .sort((a, b) => b.event_count - a.event_count)
    .slice(0, 10);

  // ── Build prompt for Claude ────────────────────────────────────────────────
  const topEventsText = highImpact.slice(0, 10).map(e =>
    `- ${e.ticker}: ${e.title} (impact: ${e.impact_score}, ${e.event_type ?? ""})`
  ).join("\n");

  const topTickersText = topTickers.slice(0, 5)
    .map(t => `${t.ticker} (${t.event_count} eventów, avg impact ${t.avg_score})`)
    .join(", ");

  const prompt = [
    `Tygodniowy raport giełdowy za tydzień ${weekStart} – ${weekEnd}.`,
    `Łącznie ${eventCount} eventów, w tym ${highImpactN} o wysokim impakcie (score ≥ 7).`,
    topTickersText ? `Najaktywniejsze spółki: ${topTickersText}.` : "",
    highImpact.length > 0 ? `Kluczowe eventy wysokiego impaktu:\n${topEventsText}` : "Brak eventów o wysokim impakcie.",
  ].filter(Boolean).join("\n\n");

  // ── Generate report with Claude Sonnet ────────────────────────────────────
  let content = "";
  let summary = "";

  try {
    content = await callAnthropic(
      "analysis",
      "Jesteś analitykiem polskiej giełdy. Napisz krótki raport tygodniowy w języku polskim (max 800 słów). " +
      "Format: ## Podsumowanie tygodnia\n## Kluczowe eventy\n## Najaktywniejsze spółki\n## Outlook",
      [{ role: "user", content: prompt }],
      1200,
    );
    log.info("Report generated successfully");

    // Generate summary separately
    summary = await callAnthropic(
      "summary",
      "Napisz 2-3 zdania po polsku streszczające ten raport giełdowy.",
      [{ role: "user", content: content.slice(0, 1000) }],
      150,
    );
  } catch (err) {
    log.error("Claude error:", err instanceof Error ? err.message : String(err));
    // Fallback: plain text report
    content = [
      `# Raport tygodniowy ${weekStart} – ${weekEnd}`,
      ``,
      `Łączna liczba eventów: **${eventCount}**`,
      `Wysokie impakty (≥7): **${highImpactN}**`,
      ``,
      `## Najaktywniejsze spółki`,
      topTickers.slice(0, 5).map(t => `- **${t.ticker}**: ${t.event_count} eventów`).join("\n"),
      ``,
      `## Kluczowe eventy`,
      highImpact.slice(0, 5).map(e => `- **${e.ticker}**: ${e.title}`).join("\n"),
    ].join("\n");
    summary = `Tydzień ${weekStart}–${weekEnd}: ${eventCount} eventów, ${highImpactN} wysokiego impaktu.`;
  }

  // ── Store in DB ────────────────────────────────────────────────────────────
  const { data: report, error: insertErr } = await supabase
    .from("weekly_reports")
    .upsert(
      {
        week_start: weekStart, week_end: weekEnd,
        content, summary,
        event_count: eventCount, high_impact: highImpactN,
        top_tickers: topTickers,
        sent_telegram: false,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "week_start" },
    )
    .select()
    .single();

  if (insertErr) {
    log.error("Insert error:", insertErr.message);
    return errorResponse(insertErr.message);
  }

  // ── Send to Telegram ────────────────────────────────────────────────────────
  const tgToken  = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const tgChatId = Deno.env.get("TELEGRAM_CHAT_ID")   ?? "";

  if (tgToken && tgChatId) {
    // Telegram message: summary + stats (truncated to avoid 4096 char limit)
    const tgLines = [
      `📊 *RAPORT TYGODNIOWY* — ${weekStart} – ${weekEnd}`,
      ``,
      summary,
      ``,
      `📈 Łącznie eventów: *${eventCount}* | Wysokie impakty: *${highImpactN}*`,
      topTickers.length > 0
        ? `🏆 Top spółki: ${topTickers.slice(0, 5).map(t => t.ticker).join(", ")}`
        : "",
    ].filter(Boolean);

    // Add top 3 high-impact events
    if (highImpact.length > 0) {
      tgLines.push("", "⚡ Kluczowe eventy:");
      for (const e of highImpact.slice(0, 3)) {
        tgLines.push(`• *${e.ticker}*: ${e.title.slice(0, 80)}`);
      }
    }

    const tgMsg = tgLines.join("\n").slice(0, 3900); // Telegram limit

    try {
      const ok = await sendTelegram(tgMsg);
      if (ok) {
        await supabase
          .from("weekly_reports")
          .update({ sent_telegram: true })
          .eq("id", (report as { id: number }).id);
      }
    } catch (err) {
      log.warn("Telegram send failed:", err instanceof Error ? err.message : String(err));
    }
  } else {
    log.warn("Telegram not configured — skipping send");
  }

  log.info(`Weekly report done: id=${(report as { id: number }).id}, events=${eventCount}, high=${highImpactN}`);
  return okResponse({
    id:          (report as { id: number }).id,
    week_start:  weekStart,
    event_count: eventCount,
    high_impact: highImpactN,
    summary,
  });
});
