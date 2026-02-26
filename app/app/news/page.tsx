"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { NewsCardFull, NewsCardCompact, type NewsCardItem } from "../components/NewsCard";

interface StatsData {
  total_24h:     number;
  breaking_24h:  number;
  avg_sentiment: number | null;
  top_tickers:   { ticker: string; count: number }[];
  by_source:     Record<string, number>;
  by_category:   Record<string, number>;
}

const CATEGORIES = ["earnings", "dividend", "management", "macro", "regulation", "merger", "contract", "insider", "other"] as const;

function timeAgoFull(iso: string | null): string {
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

// ── Priority sort ─────────────────────────────────────────────────────────────
// ESPI(24h) > Breaking(4h) > High-impact≥7(8h) > Chronological

function prioritySort(items: NewsCardItem[]): NewsCardItem[] {
  const now = Date.now();
  const h4  = 4  * 60 * 60 * 1000;
  const h8  = 8  * 60 * 60 * 1000;
  const h24 = 24 * 60 * 60 * 1000;

  function score(item: NewsCardItem): number {
    const age = now - new Date(item.published_at ?? 0).getTime();
    if (item.source === "espi" && age < h24)        return 3000;
    if (item.is_breaking && age < h4)               return 2000;
    if ((item.impact_score ?? 0) >= 7 && age < h8)  return 1000;
    return 0;
  }

  return [...items].sort((a, b) => {
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime();
  });
}

function sentimentColor(s: number | null): string {
  if (s === null) return "text-gray-500";
  if (s > 0.3)  return "text-emerald-400";
  if (s < -0.3) return "text-red-400";
  return "text-yellow-400";
}

// ── Source color badge (for filter tabs) ──────────────────────────────────────

const SOURCE_BADGE: Record<string, string> = {
  pap:      "bg-blue-900/60 text-blue-300 border-blue-800",
  bankier:  "bg-orange-900/60 text-orange-300 border-orange-800",
  stooq:    "bg-purple-900/60 text-purple-300 border-purple-800",
  strefa:   "bg-green-900/60 text-green-300 border-green-800",
  espi:     "bg-amber-900/60 text-amber-300 border-amber-800",
  gpw:      "bg-green-900/30 text-green-300 border-green-800",
  knf:      "bg-yellow-900/30 text-yellow-300 border-yellow-700",
  money:    "bg-orange-900/30 text-orange-300 border-orange-700",
  pb:       "bg-cyan-900/30 text-cyan-300 border-cyan-700",
  parkiet:  "bg-blue-900/30 text-blue-300 border-blue-700",
};

export default function NewsPage() {
  const [items,       setItems]       = useState<NewsCardItem[]>([]);
  const [espiItems,   setEspiItems]   = useState<NewsCardItem[]>([]);
  const [stats,       setStats]       = useState<StatsData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [source,      setSource]      = useState<string>("");
  const [impactMin,   setImpactMin]   = useState<string>("");
  const [category,    setCategory]    = useState<string>("");
  const [tickerQ,     setTickerQ]     = useState<string>("");
  const [onlyBreaking, setOnlyBreaking] = useState(false);
  const [relevanceOn,  setRelevanceOn]  = useState(false); // filter by min_relevance

  // Load stats once
  useEffect(() => {
    fetch("/api/news/stats")
      .then(r => r.json())
      .then((d: StatsData) => setStats(d))
      .catch(() => {});
  }, []);

  // Load ESPI items once (separate fetch, sticky at top)
  useEffect(() => {
    const p = new URLSearchParams({ source: "espi", limit: "10", days: "7", grouped: "true" });
    fetch(`/api/news?${p}`)
      .then(r => r.json())
      .then((d: { items: NewsCardItem[] }) => setEspiItems(d.items ?? []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50", grouped: "true" });
      if (source)          params.set("source",        source);
      if (impactMin)       params.set("impact_min",    impactMin);
      if (category)        params.set("category",      category);
      if (tickerQ)         params.set("ticker",        tickerQ.toUpperCase());
      if (onlyBreaking)    params.set("breaking",      "true");
      if (relevanceOn)     params.set("min_relevance", "0.4");

      const res  = await fetch(`/api/news?${params}`);
      const data = await res.json() as { items: NewsCardItem[] };
      setItems(prioritySort(data.items ?? []));
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [source, impactMin, category, tickerQ, onlyBreaking, relevanceOn]);

  useEffect(() => { load(); }, [load]);

  const resetFilters = () => {
    setSource("");
    setImpactMin("");
    setCategory("");
    setTickerQ("");
    setOnlyBreaking(false);
    setRelevanceOn(false);
  };

  const hasFilters = !!(source || impactMin || category || tickerQ || onlyBreaking || relevanceOn);

  // Source tabs: top 6 by count + Więcej dropdown
  const topSources = stats
    ? Object.entries(stats.by_source).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s]) => s)
    : [];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">

        {/* Breadcrumb + header */}
        <div className="mb-4">
          <div className="flex items-center gap-2 text-xs text-gray-600 mb-2">
            <Link href="/" className="hover:text-gray-400 transition-colors">Dashboard</Link>
            <span>/</span>
            <span className="text-gray-400">Aktualności</span>
          </div>
          <h1 className="text-xl font-bold text-white">Aktualności rynkowe</h1>
          <p className="text-gray-500 text-xs mt-0.5">
            PAP · Bankier · Stooq · Strefa · WP · ESPI — odświeżane co 15 min
          </p>
        </div>

        {/* Stats header */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
              <div className="text-[10px] text-gray-600 font-medium">Newsy (24h)</div>
              <div className="text-xl font-bold text-white tabular-nums">{stats.total_24h}</div>
            </div>
            <div className="rounded-lg border border-red-900/30 bg-red-950/10 px-3 py-2">
              <div className="text-[10px] text-red-700 font-medium">Breaking</div>
              <div className={`text-xl font-bold tabular-nums ${stats.breaking_24h > 0 ? "text-red-400" : "text-gray-600"}`}>
                {stats.breaking_24h}
              </div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
              <div className="text-[10px] text-gray-600 font-medium">Avg sentiment</div>
              <div className={`text-xl font-bold tabular-nums ${sentimentColor(stats.avg_sentiment)}`}>
                {stats.avg_sentiment !== null
                  ? `${stats.avg_sentiment > 0 ? "+" : ""}${stats.avg_sentiment.toFixed(2)}`
                  : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
              <div className="text-[10px] text-gray-600 font-medium">Top źródło</div>
              <div className="text-sm font-bold text-gray-200 mt-0.5">
                {(stats.by_source ? Object.entries(stats.by_source).sort((a, b) => b[1] - a[1])[0]?.[0] : null) ?? "—"}
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-4">
          {/* Main column */}
          <div className="flex-1 min-w-0">

            {/* Source quick tabs */}
            {stats && topSources.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                <button
                  onClick={() => setSource("")}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                    source === ""
                      ? "bg-gray-700 border-gray-600 text-white"
                      : "border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-700"
                  }`}
                >
                  Wszystkie
                </button>
                {topSources.map(src => (
                  <button
                    key={src}
                    onClick={() => setSource(src === source ? "" : src)}
                    className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                      source === src
                        ? `${SOURCE_BADGE[src] ?? "bg-gray-700 border-gray-600 text-white"}`
                        : "border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-700"
                    }`}
                  >
                    {src}
                    {stats.by_source[src] !== undefined && (
                      <span className="ml-1 opacity-50 text-[9px]">{stats.by_source[src]}</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Filters bar */}
            <div className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-xl border border-gray-800 bg-gray-900/30">
              {/* Ticker search */}
              <input
                type="text"
                value={tickerQ}
                onChange={e => setTickerQ(e.target.value.toUpperCase())}
                placeholder="Ticker (np. PKN)"
                maxLength={10}
                className="w-28 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-gray-500 font-mono"
              />

              {/* Category */}
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-300 focus:outline-none focus:border-gray-500"
              >
                <option value="">Kategoria</option>
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
                <option value="">Impact</option>
                <option value="5">≥ 5</option>
                <option value="7">≥ 7 (wysoki)</option>
                <option value="9">≥ 9 (krytyczny)</option>
              </select>

              {/* Breaking toggle */}
              <button
                onClick={() => setOnlyBreaking(v => !v)}
                className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${
                  onlyBreaking
                    ? "bg-red-900/40 border-red-700/60 text-red-300"
                    : "bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300"
                }`}
              >
                Breaking
              </button>

              {/* Relevance toggle */}
              <button
                onClick={() => setRelevanceOn(v => !v)}
                title={relevanceOn ? "Pokazuję tylko relevantne artykuły (≥0.4)" : "Pokaż wszystkie artykuły"}
                className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${
                  relevanceOn
                    ? "bg-blue-900/40 border-blue-700/60 text-blue-300"
                    : "bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300"
                }`}
              >
                Relevantne
              </button>

              {/* Reset */}
              {hasFilters && (
                <button
                  onClick={resetFilters}
                  className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-400 hover:text-white transition-colors"
                >
                  ✕ Wyczyść
                </button>
              )}

              <span className="ml-auto text-[10px] text-gray-600">
                {loading ? "…" : `${items.length} artykułów`}
              </span>
            </div>

            {/* ── ESPI section — always on top (when not filtered) ────── */}
            {!source && !tickerQ && !onlyBreaking && espiItems.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-semibold text-amber-600 uppercase tracking-widest">
                    Raporty ESPI (7 dni)
                  </span>
                  <span className="text-[9px] text-amber-800 bg-amber-950/40 border border-amber-900/40 px-1.5 py-0.5 rounded">
                    {espiItems.length}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {espiItems.map(item => (
                    <NewsCardCompact key={item.id} item={item} />
                  ))}
                </div>
                <div className="border-t border-gray-800/60 mt-4 mb-4" />
              </div>
            )}

            {/* Breaking banner (when not in breaking-only mode) */}
            {!onlyBreaking && !loading && items.filter(i => i.is_breaking).length > 0 && (
              <div className="mb-3 rounded-xl border border-red-800/50 bg-red-950/15 px-3 py-2">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-700 text-white uppercase animate-pulse">LIVE</span>
                  <span className="text-xs font-semibold text-red-300">
                    {items.filter(i => i.is_breaking).length} breaking
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {items.filter(i => i.is_breaking).slice(0, 3).map(item => (
                    <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-start gap-2 text-xs text-red-200 hover:text-red-100 transition-colors">
                      <span className="text-red-700 shrink-0">›</span>
                      <span className="leading-snug line-clamp-1">{item.title}</span>
                      <span className="text-red-800 ml-auto shrink-0 tabular-nums text-[10px]">
                        {timeAgoFull(item.published_at)}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Main list */}
            {loading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-[88px] rounded-xl bg-gray-800/50 animate-pulse" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-12 text-center">
                <p className="text-gray-500 text-sm">Brak artykułów spełniających kryteria</p>
                {hasFilters && (
                  <button onClick={resetFilters} className="mt-2 text-xs text-blue-500 hover:text-blue-400 underline">
                    Wyczyść filtry
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {items.map(item => (
                  <NewsCardFull key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>

          {/* Sidebar: trending + categories */}
          {stats && stats.top_tickers.length > 0 && (
            <div className="hidden lg:block w-44 shrink-0">
              <div className="sticky top-6 flex flex-col gap-3">
                {/* Trending tickers */}
                <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3">
                  <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2">
                    Trending
                  </h3>
                  <div className="flex flex-col gap-1">
                    {stats.top_tickers.map(({ ticker, count }) => (
                      <button
                        key={ticker}
                        onClick={() => setTickerQ(ticker === tickerQ ? "" : ticker)}
                        className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors ${
                          tickerQ === ticker
                            ? "bg-blue-900/40 border border-blue-800/50 text-blue-300"
                            : "bg-gray-800/60 border border-gray-800 text-gray-300 hover:border-gray-700"
                        }`}
                      >
                        <Link
                          href={`/companies/${ticker}`}
                          onClick={e => e.stopPropagation()}
                          className="font-mono font-bold hover:text-blue-400 transition-colors"
                        >
                          {ticker}
                        </Link>
                        <span className="text-gray-600 text-[10px]">{count}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Categories */}
                {Object.keys(stats.by_category).length > 0 && (
                  <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3">
                    <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2">
                      Kategorie
                    </h3>
                    <div className="flex flex-col gap-0.5">
                      {Object.entries(stats.by_category)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 8)
                        .map(([cat, cnt]) => (
                          <button
                            key={cat}
                            onClick={() => setCategory(cat === category ? "" : cat)}
                            className={`flex items-center justify-between text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                              category === cat
                                ? "text-yellow-300 bg-yellow-900/20"
                                : "text-gray-600 hover:text-gray-400"
                            }`}
                          >
                            <span>{cat}</span>
                            <span>{cnt}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
