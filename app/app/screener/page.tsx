"use client";

import { useState, useCallback } from "react";
import Link from "next/link";

interface ScreenerResult {
  ticker:     string;
  name:       string;
  sector:     string | null;
  market:     string;
  price:      number | null;
  change_pct: number | null;
  health:     number | null;
  rs_score:   number | null;
  rs_trend:   string | null;
}

interface Filters {
  market:     "ALL" | "GPW" | "USA";
  sector:     string;
  health_min: string;
  health_max: string;
  price_min:  string;
  price_max:  string;
  change_min: string;
  change_max: string;
  rs_min:     string;
  rs_trend:   "" | "up" | "down" | "flat";
  sort_by:    "ticker" | "health" | "price" | "change" | "rs";
  sort_dir:   "asc" | "desc";
}

const PRESETS: { label: string; filters: Partial<Filters> }[] = [
  { label: "GPW Top Health",  filters: { market: "GPW", sort_by: "health",  sort_dir: "desc", health_min: "6" } },
  { label: "USA Momentum",    filters: { market: "USA", sort_by: "change",  sort_dir: "desc" } },
  { label: "Tanie GPW",       filters: { market: "GPW", sort_by: "price",   sort_dir: "asc",  price_max: "30" } },
  { label: "Ryzykowne",       filters: { sort_by: "health", sort_dir: "asc", health_max: "4" } },
  { label: "GPW Momentum",    filters: { market: "GPW", sort_by: "rs", sort_dir: "desc", rs_trend: "up" } },
];

const DEFAULT_FILTERS: Filters = {
  market: "ALL", sector: "", health_min: "", health_max: "",
  price_min: "", price_max: "", change_min: "", change_max: "",
  rs_min: "", rs_trend: "",
  sort_by: "ticker", sort_dir: "asc",
};

function HealthBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-gray-600">—</span>;
  const color =
    value >= 7 ? "bg-green-500"
    : value >= 4 ? "bg-yellow-500"
    : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${(value / 10) * 100}%` }} />
      </div>
      <span className="text-xs font-mono text-gray-300">{value.toFixed(1)}</span>
    </div>
  );
}

function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-gray-600 text-xs">—</span>;
  const positive = pct >= 0;
  return (
    <span className={`text-xs font-mono font-semibold ${positive ? "text-green-400" : "text-red-400"}`}>
      {positive ? "+" : ""}{pct.toFixed(2)}%
    </span>
  );
}

function RsBadge({ score, trend }: { score: number | null; trend: string | null }) {
  if (score === null) return <span className="text-gray-600 text-xs">—</span>;
  const arrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  const color = trend === "up" ? "text-green-400" : trend === "down" ? "text-red-400" : "text-yellow-400";
  return (
    <span className={`text-xs font-mono font-semibold ${color}`}>
      {arrow} {score.toFixed(1)}
    </span>
  );
}

export default function ScreenerPage() {
  const [filters,  setFilters]  = useState<Filters>(DEFAULT_FILTERS);
  const [results,  setResults]  = useState<ScreenerResult[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [searched, setSearched] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const search = useCallback(async (f: Filters = filters) => {
    setLoading(true);
    setError(null);
    try {
      const body = {
        market:     f.market !== "ALL" ? f.market : undefined,
        sector:     f.sector || undefined,
        health_min: f.health_min ? Number(f.health_min) : undefined,
        health_max: f.health_max ? Number(f.health_max) : undefined,
        price_min:  f.price_min  ? Number(f.price_min)  : undefined,
        price_max:  f.price_max  ? Number(f.price_max)  : undefined,
        change_min: f.change_min ? Number(f.change_min) : undefined,
        change_max: f.change_max ? Number(f.change_max) : undefined,
        rs_min:     f.rs_min     ? Number(f.rs_min)     : undefined,
        rs_trend:   f.rs_trend   || undefined,
        sort_by:    f.sort_by,
        sort_dir:   f.sort_dir,
        limit:      100,
      };
      const res  = await fetch("/api/screener", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const data = await res.json() as { ok: boolean; results: ScreenerResult[]; count: number; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Błąd screener");
      setResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd połączenia");
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }, [filters]);

  function applyPreset(preset: Partial<Filters>) {
    const merged = { ...DEFAULT_FILTERS, ...preset };
    setFilters(merged);
    search(merged);
  }

  function toggleSort(col: Filters["sort_by"]) {
    setFilters(prev => {
      const updated = {
        ...prev,
        sort_by:  col,
        sort_dir: prev.sort_by === col && prev.sort_dir === "desc" ? "asc" as const : "desc" as const,
      };
      search(updated);
      return updated;
    });
  }

  function SortArrow({ col }: { col: Filters["sort_by"] }) {
    if (filters.sort_by !== col) return <span className="text-gray-700"> ⇅</span>;
    return <span className="text-blue-400"> {filters.sort_dir === "desc" ? "↓" : "↑"}</span>;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-6xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Screener spółek</h1>
          <p className="text-sm text-gray-500 mt-1">
            Filtruj spółki według fundamentów — dane z company_snapshot
          </p>
        </div>

        {/* Presets */}
        <div className="flex gap-2 flex-wrap mb-6">
          {PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => applyPreset(p.filters)}
              className="px-3 py-1.5 rounded-full border border-gray-700 text-xs text-gray-400 hover:border-blue-500 hover:text-blue-400 transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">

          {/* Filter sidebar */}
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 space-y-4">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Filtry</h2>

              {/* Market */}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Rynek</label>
                <div className="flex gap-1">
                  {(["ALL", "GPW", "USA"] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setFilters(f => ({ ...f, market: m }))}
                      className={`flex-1 py-1.5 text-xs rounded-md font-medium transition-colors ${
                        filters.market === m
                          ? "bg-blue-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sector */}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Sektor (fragment)</label>
                <input
                  type="text"
                  value={filters.sector}
                  onChange={e => setFilters(f => ({ ...f, sector: e.target.value }))}
                  placeholder="np. Banking, Tech…"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Health score range */}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Health Score (0–10)</label>
                <div className="flex gap-2">
                  <input
                    type="number" min="0" max="10" step="0.5"
                    value={filters.health_min}
                    onChange={e => setFilters(f => ({ ...f, health_min: e.target.value }))}
                    placeholder="min"
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                  <input
                    type="number" min="0" max="10" step="0.5"
                    value={filters.health_max}
                    onChange={e => setFilters(f => ({ ...f, health_max: e.target.value }))}
                    placeholder="max"
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Price range */}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Cena</label>
                <div className="flex gap-2">
                  <input
                    type="number" min="0"
                    value={filters.price_min}
                    onChange={e => setFilters(f => ({ ...f, price_min: e.target.value }))}
                    placeholder="min"
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                  <input
                    type="number" min="0"
                    value={filters.price_max}
                    onChange={e => setFilters(f => ({ ...f, price_max: e.target.value }))}
                    placeholder="max"
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Change % range */}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Zmiana % (1D)</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={filters.change_min}
                    onChange={e => setFilters(f => ({ ...f, change_min: e.target.value }))}
                    placeholder="min"
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                  <input
                    type="number"
                    value={filters.change_max}
                    onChange={e => setFilters(f => ({ ...f, change_max: e.target.value }))}
                    placeholder="max"
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* RS Score */}
              <div>
                <label className="text-xs text-gray-500 block mb-1">RS Score min (vs WIG20)</label>
                <input
                  type="number"
                  value={filters.rs_min}
                  onChange={e => setFilters(f => ({ ...f, rs_min: e.target.value }))}
                  placeholder="np. 102"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* RS Trend */}
              <div>
                <label className="text-xs text-gray-500 block mb-1">RS Trend</label>
                <div className="flex gap-1">
                  {([["", "Każdy"], ["up", "↑ Rosnący"], ["flat", "→ Boczny"], ["down", "↓ Spadający"]] as const).map(([v, l]) => (
                    <button
                      key={v}
                      onClick={() => setFilters(f => ({ ...f, rs_trend: v }))}
                      className={`flex-1 py-1.5 text-xs rounded-md font-medium transition-colors ${
                        filters.rs_trend === v
                          ? "bg-blue-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => search()}
                disabled={loading}
                className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
              >
                {loading ? "Szukam…" : "Szukaj"}
              </button>

              <button
                onClick={() => { setFilters(DEFAULT_FILTERS); setResults([]); setSearched(false); }}
                className="w-full py-1.5 rounded-lg border border-gray-700 text-gray-500 text-xs hover:border-gray-600 hover:text-gray-400 transition-colors"
              >
                Resetuj
              </button>
            </div>
          </div>

          {/* Results */}
          <div>
            {error && (
              <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
                {error}
              </div>
            )}

            {!searched && !loading && (
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-16 text-center text-gray-500">
                <p className="text-sm">Ustaw filtry i kliknij „Szukaj"</p>
                <p className="text-xs text-gray-600 mt-1">lub wybierz gotowy preset powyżej</p>
              </div>
            )}

            {loading && (
              <div className="space-y-2">
                {[1,2,3,4,5].map(i => (
                  <div key={i} className="h-12 bg-gray-800 animate-pulse rounded-lg" />
                ))}
              </div>
            )}

            {!loading && searched && results.length === 0 && (
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-16 text-center text-gray-500">
                <p className="text-sm">Brak wyników spełniających filtry</p>
              </div>
            )}

            {!loading && results.length > 0 && (
              <>
                <div className="text-xs text-gray-500 mb-3">
                  Znaleziono <span className="text-white font-semibold">{results.length}</span> spółek
                </div>

                <div className="rounded-xl border border-gray-800 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 bg-gray-900/60">
                          <th
                            className="px-4 py-2.5 text-left text-xs text-gray-500 font-semibold cursor-pointer hover:text-gray-300 transition-colors"
                            onClick={() => toggleSort("ticker")}
                          >
                            Ticker <SortArrow col="ticker" />
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs text-gray-500 font-semibold">
                            Nazwa
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs text-gray-500 font-semibold">
                            Sektor
                          </th>
                          <th className="px-4 py-2.5 text-left text-xs text-gray-500 font-semibold">
                            Rynek
                          </th>
                          <th
                            className="px-4 py-2.5 text-right text-xs text-gray-500 font-semibold cursor-pointer hover:text-gray-300 transition-colors"
                            onClick={() => toggleSort("price")}
                          >
                            Cena <SortArrow col="price" />
                          </th>
                          <th
                            className="px-4 py-2.5 text-right text-xs text-gray-500 font-semibold cursor-pointer hover:text-gray-300 transition-colors"
                            onClick={() => toggleSort("change")}
                          >
                            Zmiana <SortArrow col="change" />
                          </th>
                          <th
                            className="px-4 py-2.5 text-left text-xs text-gray-500 font-semibold cursor-pointer hover:text-gray-300 transition-colors"
                            onClick={() => toggleSort("health")}
                          >
                            Health <SortArrow col="health" />
                          </th>
                          <th
                            className="px-4 py-2.5 text-right text-xs text-gray-500 font-semibold cursor-pointer hover:text-gray-300 transition-colors"
                            onClick={() => toggleSort("rs")}
                          >
                            RS <SortArrow col="rs" />
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60">
                        {results.map(r => (
                          <tr key={r.ticker} className="hover:bg-gray-900/60 transition-colors">
                            <td className="px-4 py-3">
                              <Link
                                href={`/companies/${r.ticker}`}
                                className="font-bold text-blue-400 hover:text-blue-300 font-mono"
                              >
                                {r.ticker}
                              </Link>
                            </td>
                            <td className="px-4 py-3 text-gray-200 max-w-[200px] truncate">
                              {r.name}
                            </td>
                            <td className="px-4 py-3 text-gray-400 text-xs">
                              {r.sector ?? "—"}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                r.market === "GPW"
                                  ? "bg-blue-500/15 text-blue-400"
                                  : "bg-green-500/15 text-green-400"
                              }`}>
                                {r.market}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-gray-200">
                              {r.price !== null ? Number(r.price).toFixed(2) : "—"}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <ChangeBadge pct={r.change_pct} />
                            </td>
                            <td className="px-4 py-3">
                              <HealthBar value={r.health} />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <RsBadge score={r.rs_score} trend={r.rs_trend} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
