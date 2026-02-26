"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface NewsItem {
  id:           number;
  url:          string;
  title:        string;
  summary:      string | null;
  source:       string;
  published_at: string | null;
  tickers:      string[] | null;
  sector:       string | null;
  sentiment:    number | null;
  impact_score: number | null;
  category:     string | null;
  ai_summary:   string | null;
}

const SOURCES   = ["pap", "bankier", "stooq", "strefa", "wp", "youtube"] as const;
const CATEGORIES = ["earnings", "dividend", "management", "macro", "regulation", "merger", "contract", "insider", "other"] as const;

const SOURCE_COLORS: Record<string, string> = {
  pap:     "bg-blue-900 text-blue-300 border-blue-800",
  bankier: "bg-orange-900 text-orange-300 border-orange-800",
  stooq:   "bg-purple-900 text-purple-300 border-purple-800",
  strefa:  "bg-green-900 text-green-300 border-green-800",
  wp:      "bg-red-900 text-red-300 border-red-800",
  youtube: "bg-pink-900 text-pink-300 border-pink-800",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m    = Math.floor(diff / 60_000);
  if (m < 1)  return "przed chwilą";
  if (m < 60) return `${m} min temu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h temu`;
  const d = Math.floor(h / 24);
  return d === 1 ? "wczoraj" : `${d} dni temu`;
}

function sentimentLabel(s: number | null) {
  if (s === null) return { emoji: "🟡", label: "neutralne", cls: "text-yellow-400" };
  if (s >  0.5)  return { emoji: "🟢", label: "pozytywne", cls: "text-emerald-400" };
  if (s >  0.2)  return { emoji: "🟢", label: "lekko poz.", cls: "text-emerald-500" };
  if (s < -0.5)  return { emoji: "🔴", label: "negatywne", cls: "text-red-400" };
  if (s < -0.2)  return { emoji: "🔴", label: "lekko neg.", cls: "text-red-500" };
  return { emoji: "🟡", label: "neutralne", cls: "text-yellow-500" };
}

function impactBadge(score: number | null) {
  if (!score) return null;
  if (score >= 9) return { label: `${score}/10`, cls: "bg-red-900/50 text-red-300 border-red-800" };
  if (score >= 7) return { label: `${score}/10`, cls: "bg-orange-900/50 text-orange-300 border-orange-800" };
  if (score >= 5) return { label: `${score}/10`, cls: "bg-yellow-900/50 text-yellow-300 border-yellow-800" };
  return { label: `${score}/10`, cls: "bg-gray-800 text-gray-500 border-gray-700" };
}

export default function NewsPage() {
  const [items,      setItems]      = useState<NewsItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [source,     setSource]     = useState<string>("");
  const [impactMin,  setImpactMin]  = useState<string>("");
  const [category,   setCategory]   = useState<string>("");
  const [tickerQ,    setTickerQ]    = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (source)    params.set("source",     source);
      if (impactMin) params.set("impact_min", impactMin);
      if (category)  params.set("category",   category);
      if (tickerQ)   params.set("ticker",     tickerQ.toUpperCase());

      const res  = await fetch(`/api/news?${params}`);
      const data = await res.json() as { items: NewsItem[] };
      setItems(data.items ?? []);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [source, impactMin, category, tickerQ]);

  useEffect(() => { load(); }, [load]);

  const resetFilters = () => {
    setSource("");
    setImpactMin("");
    setCategory("");
    setTickerQ("");
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-6">

        {/* Breadcrumb + header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-xs text-gray-600 mb-2">
            <Link href="/" className="hover:text-gray-400 transition-colors">Dashboard</Link>
            <span>/</span>
            <span className="text-gray-400">Aktualności</span>
          </div>
          <h1 className="text-xl font-bold text-white">Aktualności rynkowe</h1>
          <p className="text-gray-500 text-xs mt-0.5">
            RSS agregator — PAP, Bankier, Stooq, Strefa, WP, YouTube · odświeżane co 15 min
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-xl border border-gray-800 bg-gray-900/40">

          {/* Ticker search */}
          <input
            type="text"
            value={tickerQ}
            onChange={e => setTickerQ(e.target.value.toUpperCase())}
            placeholder="Ticker (np. PKN)"
            maxLength={10}
            className="w-28 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 font-mono"
          />

          {/* Source */}
          <select
            value={source}
            onChange={e => setSource(e.target.value)}
            className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-300 focus:outline-none focus:border-gray-500"
          >
            <option value="">Wszystkie źródła</option>
            {SOURCES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Category */}
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-300 focus:outline-none focus:border-gray-500"
          >
            <option value="">Wszystkie kategorie</option>
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {/* Impact */}
          <select
            value={impactMin}
            onChange={e => setImpactMin(e.target.value)}
            className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-300 focus:outline-none focus:border-gray-500"
          >
            <option value="">Wszystkie impact</option>
            <option value="7">Impact ≥ 7 (wysoki)</option>
            <option value="5">Impact ≥ 5 (średni)</option>
            <option value="9">Impact ≥ 9 (krytyczny)</option>
          </select>

          {/* Reset */}
          {(source || impactMin || category || tickerQ) && (
            <button
              onClick={resetFilters}
              className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-400 hover:text-white transition-colors"
            >
              Wyczyść
            </button>
          )}

          <span className="ml-auto text-xs text-gray-600">
            {loading ? "Ładowanie..." : `${items.length} newsów`}
          </span>
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-gray-800/50 animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-12 text-center">
            <p className="text-gray-500 text-sm">Brak newsów spełniających kryteria</p>
            <p className="text-gray-600 text-xs mt-1">Zmień filtry lub poczekaj na kolejne odświeżenie RSS</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map(item => {
              const sent   = sentimentLabel(item.sentiment);
              const impact = impactBadge(item.impact_score);

              return (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group rounded-xl border border-gray-800 hover:border-gray-700 bg-gray-900/40 hover:bg-gray-900/60 p-4 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {/* Source badge */}
                    <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded border uppercase tracking-wide ${
                      SOURCE_COLORS[item.source] ?? "bg-gray-800 text-gray-400 border-gray-700"
                    }`}>
                      {item.source}
                    </span>

                    <div className="flex-1 min-w-0">
                      {/* Title */}
                      <p className="text-sm text-gray-200 font-medium leading-snug group-hover:text-white transition-colors line-clamp-2">
                        {item.title}
                      </p>

                      {/* AI summary */}
                      {item.ai_summary && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                          {item.ai_summary}
                        </p>
                      )}

                      {/* Meta row */}
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        {/* Tickers */}
                        {item.tickers?.length ? (
                          <div className="flex gap-1">
                            {item.tickers.slice(0, 5).map(t => (
                              <Link
                                key={t}
                                href={`/companies/${t}`}
                                onClick={e => e.stopPropagation()}
                                className="font-mono text-[10px] text-blue-400 hover:text-blue-300 transition-colors bg-blue-900/20 border border-blue-800/30 px-1.5 py-0.5 rounded"
                              >
                                {t}
                              </Link>
                            ))}
                          </div>
                        ) : null}

                        {/* Category */}
                        {item.category && (
                          <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
                            {item.category}
                          </span>
                        )}

                        {/* Impact */}
                        {impact && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${impact.cls}`}>
                            {impact.label}
                          </span>
                        )}

                        {/* Sentiment */}
                        <span className={`text-[10px] ${sent.cls}`}>
                          {sent.emoji} {sent.label}
                          {item.sentiment !== null && ` (${item.sentiment > 0 ? "+" : ""}${item.sentiment.toFixed(2)})`}
                        </span>

                        {/* Time */}
                        <span className="text-[10px] text-gray-600 ml-auto">
                          {timeAgo(item.published_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
