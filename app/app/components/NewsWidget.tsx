"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface NewsItem {
  id:           number;
  url:          string;
  title:        string;
  source:       string;
  published_at: string | null;
  tickers:      string[] | null;
  sentiment:    number | null;
  impact_score: number | null;
  category:     string | null;
  ai_summary:   string | null;
}

type Filter = "all" | "high" | "ticker";

const SOURCE_COLORS: Record<string, string> = {
  pap:     "bg-blue-900 text-blue-300",
  bankier: "bg-orange-900 text-orange-300",
  stooq:   "bg-purple-900 text-purple-300",
  strefa:  "bg-green-900 text-green-300",
  wp:      "bg-red-900 text-red-300",
  youtube: "bg-pink-900 text-pink-300",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m    = Math.floor(diff / 60_000);
  if (m < 1)  return "przed chwilą";
  if (m < 60) return `${m}m temu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h temu`;
  return `${Math.floor(h / 24)}d temu`;
}

function impactColor(score: number | null): string {
  if (!score) return "text-gray-600";
  if (score >= 8) return "text-red-400";
  if (score >= 6) return "text-orange-400";
  if (score >= 4) return "text-yellow-500";
  return "text-gray-500";
}

function sentimentDot(s: number | null): string {
  if (s === null) return "🟡";
  if (s >  0.3)  return "🟢";
  if (s < -0.3)  return "🔴";
  return "🟡";
}

export default function NewsWidget() {
  const [items,   setItems]   = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<Filter>("all");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const params =
          filter === "high"   ? "?impact_min=7&limit=10" :
          filter === "ticker" ? "?impact_min=5&limit=10" : "?limit=10";

        const res  = await fetch(`/api/news${params}`);
        const data = await res.json() as { items: NewsItem[] };
        if (!cancelled) setItems(data.items ?? []);
      } catch { /* silent */ } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [filter]);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
          Aktualności
        </h2>
        <Link href="/news" className="text-xs text-blue-500 hover:text-blue-400 transition-colors">
          Wszystkie →
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-3">
        {(["all", "high", "ticker"] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              filter === f
                ? "bg-gray-700 text-white"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {f === "all"    ? "Wszystkie" :
             f === "high"   ? "Wysoki wpływ" : "Finansowe"}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 rounded bg-gray-800/50 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="text-xs text-gray-600 text-center py-4">Brak newsów</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {items.map(item => (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start gap-2 rounded-lg bg-gray-900/60 border border-gray-800 hover:border-gray-700 px-3 py-2 transition-colors"
            >
              {/* Source badge */}
              <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide mt-0.5 ${
                SOURCE_COLORS[item.source] ?? "bg-gray-800 text-gray-400"
              }`}>
                {item.source}
              </span>

              {/* Title + meta */}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-200 leading-snug line-clamp-2 group-hover:text-white transition-colors">
                  {item.title}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {/* Tickers */}
                  {item.tickers?.length ? (
                    <span className="font-mono text-[10px] text-blue-400">
                      {item.tickers.slice(0, 3).join(" ")}
                    </span>
                  ) : null}
                  {/* Sentiment */}
                  <span className="text-[10px]">{sentimentDot(item.sentiment)}</span>
                  {/* Impact */}
                  {item.impact_score !== null && (
                    <span className={`text-[10px] font-bold ${impactColor(item.impact_score)}`}>
                      {item.impact_score}/10
                    </span>
                  )}
                  {/* Time */}
                  <span className="text-[10px] text-gray-600 ml-auto">
                    {timeAgo(item.published_at)}
                  </span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
