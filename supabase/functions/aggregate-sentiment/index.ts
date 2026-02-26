// supabase/functions/aggregate-sentiment/index.ts
// Aggregates news_items → sentiment_daily per ticker per day.
// Also updates companies.avg_sentiment_30d and news_count_30d.
//
// Runs every hour (cron: 0 * * * *) — processes last 7 days.
// JS-side aggregation: no RPC needed, just unnest tickers[].
//
// Deploy: supabase functions deploy aggregate-sentiment --project-ref pftgmorsthoezhmojjpg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NewsRow {
  tickers:      string[] | null;
  sentiment:    number | null;
  published_at: string | null;
  is_breaking:  boolean | null;
  topics:       string[] | null;
}

interface DayAgg {
  ticker:         string;
  date:           string;
  sentiments:     number[];
  breaking:       number;
  topicCounts:    Map<string, number>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avg(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function dominantTopic(counts: Map<string, number>): string | null {
  if (counts.size === 0) return null;
  let best = "";
  let max  = 0;
  for (const [topic, count] of counts) {
    if (count > max) { max = count; best = topic; }
  }
  return best || null;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  const startTime = Date.now();
  console.log("[aggregate-sentiment] Invoked at:", new Date().toISOString());

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")              ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  // ── Fetch AI-processed items from last 7 days ─────────────────────────────
  const { data: rows, error } = await supabase
    .from("news_items")
    .select("tickers, sentiment, published_at, is_breaking, topics")
    .eq("ai_processed", true)
    .gte("published_at", sevenDaysAgo)
    .not("tickers", "eq", "{}")
    .limit(5000);

  if (error) {
    console.error("[aggregate-sentiment] Fetch error:", error.message);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const items = (rows ?? []) as NewsRow[];
  console.log(`[aggregate-sentiment] ${items.length} items to aggregate`);

  // ── Aggregate per ticker+date (JS side) ───────────────────────────────────
  const groups = new Map<string, DayAgg>();

  for (const item of items) {
    if (!item.tickers?.length || !item.published_at) continue;

    const date = item.published_at.slice(0, 10); // YYYY-MM-DD

    for (const ticker of item.tickers) {
      const key = `${ticker}|${date}`;

      if (!groups.has(key)) {
        groups.set(key, {
          ticker,
          date,
          sentiments:  [],
          breaking:    0,
          topicCounts: new Map(),
        });
      }

      const g = groups.get(key)!;
      if (item.sentiment !== null) g.sentiments.push(item.sentiment);
      if (item.is_breaking)        g.breaking++;

      for (const topic of (item.topics ?? [])) {
        g.topicCounts.set(topic, (g.topicCounts.get(topic) ?? 0) + 1);
      }
    }
  }

  console.log(`[aggregate-sentiment] ${groups.size} ticker-date combinations to upsert`);

  // ── Upsert sentiment_daily ────────────────────────────────────────────────
  let upserted = 0;
  const upsertBatch: Array<Record<string, unknown>> = [];

  for (const g of groups.values()) {
    const sentiments = g.sentiments;
    const mean       = avg(sentiments);
    const min        = sentiments.length ? Math.min(...sentiments) : null;
    const max        = sentiments.length ? Math.max(...sentiments) : null;
    const positive   = sentiments.filter(s => s > 0.2).length;
    const negative   = sentiments.filter(s => s < -0.2).length;
    const neutral    = sentiments.filter(s => s >= -0.2 && s <= 0.2).length;

    upsertBatch.push({
      ticker:         g.ticker,
      date:           g.date,
      avg_sentiment:  mean  !== null ? Math.round(mean  * 1000) / 1000 : null,
      min_sentiment:  min   !== null ? Math.round(min   * 1000) / 1000 : null,
      max_sentiment:  max   !== null ? Math.round(max   * 1000) / 1000 : null,
      message_count:  g.sentiments.length + g.breaking, // approximate total
      positive_count: positive,
      negative_count: negative,
      neutral_count:  neutral,
      breaking_count: g.breaking,
      dominant_topic: dominantTopic(g.topicCounts),
    });
  }

  if (upsertBatch.length > 0) {
    // Upsert in chunks of 100
    for (let i = 0; i < upsertBatch.length; i += 100) {
      const chunk = upsertBatch.slice(i, i + 100);
      const { error: upErr } = await supabase
        .from("sentiment_daily")
        .upsert(chunk, { onConflict: "ticker,date" });

      if (upErr) {
        console.error(`[aggregate-sentiment] Upsert chunk ${i}: ${upErr.message}`);
      } else {
        upserted += chunk.length;
      }
    }
  }

  // ── Update companies.avg_sentiment_30d + news_count_30d ───────────────────
  // Fetch 30-day aggregate per ticker
  const { data: monthRows } = await supabase
    .from("news_items")
    .select("tickers, sentiment")
    .eq("ai_processed", true)
    .gte("published_at", thirtyDaysAgo)
    .not("tickers", "eq", "{}");

  // Build per-ticker aggregates for 30d
  const tickerMonth = new Map<string, { sentiments: number[]; count: number }>();
  for (const item of (monthRows ?? []) as NewsRow[]) {
    for (const ticker of (item.tickers ?? [])) {
      if (!tickerMonth.has(ticker)) tickerMonth.set(ticker, { sentiments: [], count: 0 });
      const tm = tickerMonth.get(ticker)!;
      tm.count++;
      if (item.sentiment !== null) tm.sentiments.push(item.sentiment);
    }
  }

  let companiesUpdated = 0;
  for (const [ticker, tm] of tickerMonth) {
    const avgSent = avg(tm.sentiments);
    const { error: compErr } = await supabase
      .from("companies")
      .update({
        news_count_30d:    tm.count,
        avg_sentiment_30d: avgSent !== null ? Math.round(avgSent * 1000) / 1000 : null,
      })
      .eq("ticker", ticker);

    if (!compErr) companiesUpdated++;
  }

  const duration = Date.now() - startTime;
  console.log(`[aggregate-sentiment] Done: upserted=${upserted}, companies=${companiesUpdated}, ms=${duration}`);

  return new Response(
    JSON.stringify({
      ok:                 true,
      groups_aggregated:  groups.size,
      rows_upserted:      upserted,
      companies_updated:  companiesUpdated,
      duration_ms:        duration,
      ts:                 new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
