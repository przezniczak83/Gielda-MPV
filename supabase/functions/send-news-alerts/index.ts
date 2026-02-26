// supabase/functions/send-news-alerts/index.ts
// Sends Telegram alerts for high-impact news.
//
// Conditions:
//   impact_score >= 7                                   — high impact
//   category IN ('earnings','dividend') AND score >= 5  — financial events
//
// Separate from send-alerts (which handles company_events).
//
// Deploy: supabase functions deploy send-news-alerts --project-ref pftgmorsthoezhmojjpg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendTelegram  } from "../_shared/telegram.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NewsItem {
  id:           number;
  title:        string;
  url:          string;
  source:       string;
  tickers:      string[] | null;
  sentiment:    number | null;
  impact_score: number | null;
  category:     string | null;
  ai_summary:   string | null;
}

// ─── Formatter ────────────────────────────────────────────────────────────────

function formatNewsAlert(item: NewsItem): string {
  const score = item.impact_score ?? 5;
  const emoji = score >= 9 ? "🚨" : score >= 7 ? "⚡" : "📰";

  const tickerStr = item.tickers?.length
    ? item.tickers.map(t => `*${t}*`).join(" ")
    : "";

  const sentiment     = item.sentiment ?? 0;
  const sentimentEmoji = sentiment >  0.3 ? "🟢"
                       : sentiment < -0.3 ? "🔴"
                       : "🟡";

  const sentimentStr = `${sentiment > 0 ? "+" : ""}${sentiment.toFixed(2)}`;

  const lines = [
    `${emoji} *${item.source.toUpperCase()}*${tickerStr ? " · " + tickerStr : ""}`,
    "",
    item.title,
    "",
    item.ai_summary ? `${sentimentEmoji} ${item.ai_summary}` : `${sentimentEmoji} Brak podsumowania AI`,
    "",
    `Impact: ${score}/10 | Sentiment: ${sentimentStr}`,
  ];

  if (item.url) lines.push(`[Czytaj więcej](${item.url})`);

  return lines.join("\n");
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  console.log("[send-news-alerts] Invoked at:", new Date().toISOString());

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")              ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // ── Fetch unsent, AI-processed items that meet alert criteria ─────────────
  // Impact >= 7 OR (financial category AND impact >= 5)
  const { data: items, error } = await supabase
    .from("news_items")
    .select("id, title, url, source, tickers, sentiment, impact_score, category, ai_summary")
    .eq("ai_processed", true)
    .eq("telegram_sent", false)
    .or("impact_score.gte.7,is_breaking.eq.true,and(category.in.(earnings,dividend),impact_score.gte.5)")
    .order("published_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[send-news-alerts] Fetch error:", error.message);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const batch = (items ?? []) as NewsItem[];
  console.log(`[send-news-alerts] ${batch.length} alerts to send`);

  let sent   = 0;
  let failed = 0;

  for (const item of batch) {
    const message = formatNewsAlert(item);
    const ok      = await sendTelegram(message);

    const { error: updateErr } = await supabase
      .from("news_items")
      .update({ telegram_sent: true })
      .eq("id", item.id);

    if (ok && !updateErr) {
      console.log(`[send-news-alerts] item ${item.id} sent ✓`);
      sent++;
    } else {
      console.warn(`[send-news-alerts] item ${item.id}: telegram=${ok}, db_err=${updateErr?.message}`);
      failed++;
    }

    // Respect Telegram rate limit (30 msg/sec)
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`[send-news-alerts] Done: sent=${sent}, failed=${failed}`);

  return new Response(
    JSON.stringify({ ok: true, sent, failed, ts: new Date().toISOString() }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
