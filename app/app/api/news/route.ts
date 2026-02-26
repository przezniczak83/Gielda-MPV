// GET /api/news
// Query params:
//   ?ticker=PKN         — single ticker OR ?ticker=PKN,PZU (comma-separated)
//   ?source=bankier     — filter by source
//   ?impact_min=7       — minimum impact_score
//   ?min_relevance=0.4  — minimum relevance_score (null values pass through)
//   ?category=earnings  — filter by category
//   ?breaking=true      — only is_breaking items
//   ?days=7             — last N days only
//   ?has_facts=true     — only items with key_facts
//   ?limit=50           — max results (default 50, max 100)
//   ?offset=0           — pagination offset
//   ?grouped=true       — deduplicate by event_group_id, return best article per group
//                         adds source_count + sources[] fields
//   ?strict=true        — when ?ticker= is present: only articles where
//                         ticker_confidence[ticker] >= 0.7 (default false)

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const revalidate = 60;

// Priority for picking the "best" article in a group
const SOURCE_PRIORITY: Record<string, number> = {
  espi:    10,
  gpw:      7,
  knf:      7,
  pap:      8,
  stooq:    6,
  bankier:  5,
  strefa:   4,
  money:    3,
  pb:       3,
  parkiet:  3,
  rp:       3,
};

interface DBItem {
  id:                number;
  url:               string;
  title:             string;
  summary:           string | null;
  source:            string;
  published_at:      string | null;
  tickers:           string[] | null;
  sector:            string | null;
  sentiment:         number | null;
  impact_score:      number | null;
  relevance_score:   number | null;
  category:          string | null;
  ai_summary:        string | null;
  key_facts:         unknown;
  topics:            string[] | null;
  is_breaking:       boolean | null;
  impact_assessment: string | null;
  ticker_confidence: Record<string, number> | null;
  event_group_id:    string | null;
}

export async function GET(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { searchParams } = req.nextUrl;
  const tickerParam    = searchParams.get("ticker");
  const source         = searchParams.get("source");
  const impactMin      = searchParams.get("impact_min");
  const minRelevance   = searchParams.get("min_relevance");
  const category       = searchParams.get("category");
  const breaking       = searchParams.get("breaking");
  const daysParam      = searchParams.get("days");
  const hasFacts       = searchParams.get("has_facts");
  const grouped        = searchParams.get("grouped") === "true";
  const strict         = searchParams.get("strict") === "true";
  const limit          = Math.min(parseInt(searchParams.get("limit")  ?? "50",  10), 100);
  const offset         = Math.max(parseInt(searchParams.get("offset") ?? "0",   10), 0);

  // Fetch extra items when grouping (dedup may reduce count)
  const fetchLimit = grouped ? Math.min(limit * 3, 300) : limit;

  let query = supabase
    .from("news_items")
    .select("id, url, title, summary, source, published_at, tickers, sector, sentiment, impact_score, relevance_score, category, ai_summary, key_facts, topics, is_breaking, impact_assessment, ticker_confidence, event_group_id")
    .eq("ai_processed", true)
    .order("published_at", { ascending: false })
    .range(offset, offset + fetchLimit - 1);

  // Ticker filter — support comma-separated list
  const tickers = tickerParam
    ? tickerParam.split(",").map(t => t.trim().toUpperCase()).filter(Boolean)
    : [];

  if (tickers.length === 1) {
    query = query.contains("tickers", [tickers[0]]);
  } else if (tickers.length > 1) {
    query = query.overlaps("tickers", tickers);
  }

  if (source)       query = query.eq("source", source);
  if (impactMin)    query = query.gte("impact_score", parseInt(impactMin, 10));
  if (minRelevance) query = query.or(`relevance_score.gte.${parseFloat(minRelevance)},relevance_score.is.null`);
  if (category)     query = query.eq("category", category);
  if (breaking === "true") query = query.eq("is_breaking", true);
  if (hasFacts === "true") query = query.neq("key_facts", "[]");

  if (daysParam) {
    const days   = Math.min(parseInt(daysParam, 10) || 7, 90);
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    query = query.gte("published_at", cutoff);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let items = (data ?? []) as DBItem[];

  // ── Strict confidence filter ───────────────────────────────────────────────
  // When a ticker is queried with strict=true, only return articles where
  // that ticker's confidence >= 0.7.
  if (strict && tickers.length > 0) {
    items = items.filter(item => {
      const conf = item.ticker_confidence;
      if (!conf) return false;
      return tickers.some(t => (conf[t] ?? 0) >= 0.7);
    });
  }

  // ── Grouped deduplication ─────────────────────────────────────────────────
  // When grouped=true: group by event_group_id, return best article per group
  // Articles without event_group_id are returned as-is.
  if (grouped) {
    const groupMap = new Map<string, DBItem[]>();
    const ungrouped: DBItem[] = [];

    for (const item of items) {
      if (item.event_group_id) {
        const group = groupMap.get(item.event_group_id) ?? [];
        group.push(item);
        groupMap.set(item.event_group_id, group);
      } else {
        ungrouped.push(item);
      }
    }

    // Pick best article per group (ESPI > PAP > GPW > stooq > bankier > others)
    const grouped_items = [...groupMap.values()].map(group => {
      const sorted = [...group].sort((a, b) =>
        (SOURCE_PRIORITY[b.source] ?? 1) - (SOURCE_PRIORITY[a.source] ?? 1),
      );
      const best = sorted[0];
      return {
        ...best,
        source_count: group.length,
        sources:      [...new Set(group.map(i => i.source))],
      };
    });

    // Merge: grouped articles + standalone articles, re-sort by published_at
    const merged = [...grouped_items, ...ungrouped.map(i => ({ ...i, source_count: 1, sources: [i.source] }))]
      .sort((a, b) =>
        new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime(),
      )
      .slice(0, limit);

    return NextResponse.json({
      items: merged,
      ts:    new Date().toISOString(),
    });
  }

  return NextResponse.json({
    items: items.slice(0, limit),
    ts:    new Date().toISOString(),
  });
}
