"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface KeyFact {
  type:        string;
  description: string;
  detail?:     string;
  impact?:     "positive" | "negative" | "neutral";
}

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
  key_facts:    KeyFact[] | null;
}

function factText(fact: KeyFact, maxLen = 55): string {
  const text = fact.description || fact.type || "";
  return text.length > maxLen ? text.slice(0, maxLen - 3) + "…" : text;
}

const SOURCE_COLORS: Record<string, string> = {
  pap:      "bg-blue-900/60 text-blue-300",
  bankier:  "bg-orange-900/60 text-orange-300",
  stooq:    "bg-purple-900/60 text-purple-300",
  strefa:   "bg-green-900/60 text-green-300",
  wp:       "bg-red-900/60 text-red-300",
  youtube:  "bg-pink-900/60 text-pink-300",
  espi:     "bg-amber-900/60 text-amber-300",
  gpw:      "bg-green-900/40 text-green-300",
  knf:      "bg-yellow-900/40 text-yellow-300",
  money:    "bg-orange-900/40 text-orange-300",
  pb:       "bg-cyan-900/40 text-cyan-300",
  parkiet:  "bg-blue-900/40 text-blue-300",
  rp:       "bg-slate-700/40 text-slate-300",
  cashless: "bg-teal-900/40 text-teal-300",
  comparic: "bg-violet-900/40 text-violet-300",
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

// ── ESPI card (amber highlight, no timeline dot) ──────────────────────────────

function EspiCard({ item }: { item: NewsItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 rounded-lg p-3 border border-amber-800/50 bg-amber-950/20 hover:border-amber-700/70 transition-colors"
    >
      <div className="w-20 shrink-0 text-right">
        <div className="text-[10px] text-amber-600 tabular-nums font-medium">
          {formatDate(item.published_at)}
        </div>
        <div className="text-[9px] text-amber-900 tabular-nums mt-0.5">
          {timeAgo(item.published_at)} temu
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide bg-amber-900/60 text-amber-300">
            ESPI
          </span>
          {item.category && (
            <span className="text-[9px] text-amber-700 bg-amber-950/40 px-1.5 py-0.5 rounded">
              {item.category}
            </span>
          )}
          {item.impact_score !== null && (
            <span className={`text-[9px] font-bold ml-auto ${
              item.impact_score >= 8 ? "text-red-400" :
              item.impact_score >= 6 ? "text-orange-400" :
              item.impact_score >= 4 ? "text-yellow-500" : "text-amber-700"
            }`}>
              {item.impact_score}/10
            </span>
          )}
        </div>

        <p className="text-xs leading-snug line-clamp-2 text-amber-200 hover:text-amber-100">
          {item.title}
        </p>

        {item.ai_summary && (
          <p className="text-[10px] text-amber-700 mt-0.5 line-clamp-1">
            {item.ai_summary}
          </p>
        )}

        {item.key_facts && item.key_facts.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {item.key_facts.slice(0, 2).map((fact, i) => (
              <span
                key={i}
                className="text-[9px] text-amber-700 bg-amber-950/60 border border-amber-900/60 px-1.5 py-0.5 rounded"
              >
                {factText(fact)}
              </span>
            ))}
          </div>
        )}
      </div>
    </a>
  );
}

// ── Regular timeline card ─────────────────────────────────────────────────────

function TimelineCard({ item }: { item: NewsItem }) {
  const sb = sentimentBar(item.sentiment);
  return (
    <div className={`relative flex items-start gap-3 rounded-lg p-3 border transition-colors ${
      item.is_breaking
        ? "bg-red-950/20 border-red-800/50"
        : "bg-gray-900/60 border-gray-800 hover:border-gray-700"
    }`}>
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

        {item.key_facts && item.key_facts.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {item.key_facts.slice(0, 2).map((fact, i) => (
              <span
                key={i}
                className="text-[9px] text-gray-500 bg-gray-800/80 border border-gray-700/50 px-1.5 py-0.5 rounded"
              >
                {factText(fact)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CompanyTimeline({ ticker }: { ticker: string }) {
  const [espiItems,  setEspiItems]  = useState<NewsItem[]>([]);
  const [newsItems,  setNewsItems]  = useState<NewsItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [days,       setDays]       = useState(14);
  const [strict,     setStrict]     = useState(true);  // KROK 3B: confidence filter

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        // Fetch enough items to cover both ESPI + news; strict filters by confidence
        const params = new URLSearchParams({
          ticker,
          days:   String(days),
          limit:  "50",
          grouped: "true",
        });
        if (strict) params.set("strict", "true");

        const res  = await fetch(`/api/news?${params}`);
        const data = await res.json() as { items: NewsItem[] };
        const all  = data.items ?? [];

        if (!cancelled) {
          setEspiItems(all.filter(i => i.source === "espi"));
          setNewsItems(all.filter(i => i.source !== "espi"));
        }
      } catch { /* silent */ } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [ticker, days, strict]);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
          Aktualności
        </h2>
        <div className="flex items-center gap-1">
          {/* Strict toggle — KROK 3B */}
          <button
            onClick={() => setStrict(v => !v)}
            title={strict ? "Pokazuję tylko artykuły wprost o spółce (confidence ≥ 0.7)" : "Pokazuję wszystkie wzmianki"}
            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
              strict
                ? "bg-blue-900/40 border-blue-800/60 text-blue-300"
                : "bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300"
            }`}
          >
            {strict ? "Wprost" : "Wszystkie"}
          </button>

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
      ) : espiItems.length === 0 && newsItems.length === 0 ? (
        <div className="py-8 text-center text-gray-600 text-xs">
          Brak newsów dla {ticker} w ostatnich {days} dniach
          {strict && (
            <p className="mt-1">
              <button onClick={() => setStrict(false)} className="text-blue-500 hover:text-blue-400 underline">
                Pokaż wszystkie wzmianki
              </button>
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">

          {/* ── KROK 3A: ESPI section — always at top ──────────────────────── */}
          {espiItems.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-semibold text-amber-600 uppercase tracking-widest">
                  Raporty ESPI
                </span>
                <span className="text-[9px] text-amber-800 bg-amber-950/40 px-1.5 py-0.5 rounded">
                  {espiItems.length}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {espiItems.map(item => (
                  <EspiCard key={item.id} item={item} />
                ))}
              </div>
            </div>
          )}

          {/* ── Regular news timeline ──────────────────────────────────────── */}
          {newsItems.length > 0 && (
            <div>
              {espiItems.length > 0 && (
                <div className="flex items-center gap-2 mb-2 mt-1">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                    Aktualności
                  </span>
                </div>
              )}
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-[5.5rem] top-0 bottom-0 w-px bg-gray-800 z-0" />
                <div className="flex flex-col gap-2">
                  {newsItems.map(item => (
                    <TimelineCard key={item.id} item={item} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
