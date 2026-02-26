"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface NewsItem {
  id:           number;
  url:          string;
  title:        string;
  source:       string;
  published_at: string | null;
  sentiment:    number | null;
  impact_score: number | null;
  category:     string | null;
  ai_summary:   string | null;
  is_breaking:  boolean | null;
  key_facts:    string[] | null;
}

const SOURCE_COLORS: Record<string, string> = {
  pap:     "bg-blue-900/60 text-blue-300",
  bankier: "bg-orange-900/60 text-orange-300",
  stooq:   "bg-purple-900/60 text-purple-300",
  strefa:  "bg-green-900/60 text-green-300",
  wp:      "bg-red-900/60 text-red-300",
  youtube: "bg-pink-900/60 text-pink-300",
  espi:    "bg-amber-900/60 text-amber-300",
};

function sentimentBar(s: number | null) {
  if (s === null) return { color: "bg-gray-600", width: "50%", label: "—" };
  const pct   = Math.round(((s + 1) / 2) * 100);
  const color = s > 0.3 ? "bg-emerald-500" : s < -0.3 ? "bg-red-500" : "bg-yellow-500";
  const label = `${s > 0 ? "+" : ""}${s.toFixed(2)}`;
  return { color, width: `${pct}%`, label };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pl-PL", {
    day:   "2-digit",
    month: "short",
  });
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m    = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function CompanyTimeline({ ticker }: { ticker: string }) {
  const [items,   setItems]   = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [days,    setDays]    = useState(14);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res  = await fetch(`/api/news?ticker=${encodeURIComponent(ticker)}&days=${days}&limit=30`);
        const data = await res.json() as { items: NewsItem[] };
        if (!cancelled) setItems(data.items ?? []);
      } catch { /* silent */ } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [ticker, days]);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
          Aktualności newsowe
        </h2>
        <div className="flex items-center gap-1">
          {([7, 14, 30] as const).map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                days === d
                  ? "bg-gray-700 text-white"
                  : "text-gray-600 hover:text-gray-300"
              }`}
            >
              {d}d
            </button>
          ))}
          <Link
            href={`/news?ticker=${ticker}`}
            className="ml-2 text-xs text-blue-500 hover:text-blue-400 transition-colors"
          >
            Więcej →
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-gray-800/50 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center text-gray-600 text-xs">
          Brak newsów dla {ticker} w ostatnich {days} dniach
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[5.5rem] top-0 bottom-0 w-px bg-gray-800 z-0" />

          <div className="flex flex-col gap-2">
            {items.map(item => {
              const sb = sentimentBar(item.sentiment);
              return (
                <div
                  key={item.id}
                  className={`relative flex items-start gap-3 rounded-lg p-3 border transition-colors ${
                    item.is_breaking
                      ? "bg-red-950/20 border-red-800/50"
                      : "bg-gray-900/60 border-gray-800 hover:border-gray-700"
                  }`}
                >
                  {/* Date column */}
                  <div className="w-20 shrink-0 text-right">
                    <div className="text-[10px] text-gray-400 tabular-nums font-medium">
                      {formatDate(item.published_at)}
                    </div>
                    <div className="text-[9px] text-gray-700 tabular-nums mt-0.5">
                      {timeAgo(item.published_at)} temu
                    </div>
                  </div>

                  {/* Dot on timeline */}
                  <div className={`relative z-10 mt-1 w-2.5 h-2.5 shrink-0 rounded-full border-2 ${
                    item.is_breaking
                      ? "bg-red-500 border-red-800"
                      : (item.impact_score ?? 0) >= 7
                        ? "bg-orange-500 border-orange-900"
                        : "bg-gray-600 border-gray-800"
                  }`} />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      {item.is_breaking && (
                        <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-red-700 text-white uppercase">LIVE</span>
                      )}
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                        SOURCE_COLORS[item.source] ?? "bg-gray-800 text-gray-400"
                      }`}>
                        {item.source}
                      </span>
                      {item.category && (
                        <span className="text-[9px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
                          {item.category}
                        </span>
                      )}
                      {item.impact_score !== null && (
                        <span className={`text-[9px] font-bold ml-auto ${
                          item.impact_score >= 8 ? "text-red-400" :
                          item.impact_score >= 6 ? "text-orange-400" :
                          item.impact_score >= 4 ? "text-yellow-500" : "text-gray-600"
                        }`}>
                          {item.impact_score}/10
                        </span>
                      )}
                    </div>

                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`text-xs leading-snug line-clamp-2 hover:underline ${
                        item.is_breaking ? "text-red-200 font-medium" : "text-gray-200"
                      }`}
                    >
                      {item.title}
                    </a>

                    {/* AI summary */}
                    {item.ai_summary && (
                      <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-1">
                        {item.ai_summary}
                      </p>
                    )}

                    {/* Sentiment bar */}
                    {item.sentiment !== null && (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <div className="flex-1 h-1 rounded-full bg-gray-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${sb.color}`}
                            style={{ width: sb.width }}
                          />
                        </div>
                        <span className={`text-[9px] tabular-nums ${
                          (item.sentiment ?? 0) > 0.3 ? "text-emerald-400" :
                          (item.sentiment ?? 0) < -0.3 ? "text-red-400" : "text-yellow-500"
                        }`}>
                          {sb.label}
                        </span>
                      </div>
                    )}

                    {/* Key facts */}
                    {item.key_facts && item.key_facts.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {item.key_facts.slice(0, 2).map((fact, i) => (
                          <span
                            key={i}
                            className="text-[9px] text-gray-500 bg-gray-800/80 border border-gray-700/50 px-1.5 py-0.5 rounded"
                          >
                            {fact.length > 55 ? fact.slice(0, 52) + "…" : fact}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
