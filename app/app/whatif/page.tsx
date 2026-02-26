"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

interface ScenarioSummary {
  id:          number;
  name:        string;
  description: string;
  category:    string;
}

interface EnrichedImpact {
  ticker:     string;
  name:       string;
  sector:     string | null;
  pct_change: number;
  rationale:  string;
}

interface ScenarioDetail extends ScenarioSummary {
  enriched_impacts: EnrichedImpact[];
}

const CATEGORY_LABEL: Record<string, string> = {
  macro:        "📊 Makro",
  sector:       "🏭 Sektorowy",
  geopolitical: "🌍 Geopolityczny",
};

const CATEGORY_COLOR: Record<string, string> = {
  macro:        "border-blue-800/40 bg-blue-900/10 text-blue-400",
  sector:       "border-purple-800/40 bg-purple-900/10 text-purple-400",
  geopolitical: "border-orange-800/40 bg-orange-900/10 text-orange-400",
};

export default function WhatIfPage() {
  const [scenarios, setScenarios]     = useState<ScenarioSummary[]>([]);
  const [selected, setSelected]       = useState<ScenarioDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    fetch("/api/whatif")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setScenarios(d); setLoadingList(false); })
      .catch(() => setLoadingList(false));
  }, []);

  function selectScenario(id: number) {
    if (selected?.id === id) return;
    setLoadingDetail(true);
    fetch(`/api/whatif?id=${id}`)
      .then((r) => r.json())
      .then((d) => { setSelected(d); setLoadingDetail(false); })
      .catch(() => setLoadingDetail(false));
  }

  const gainers = selected?.enriched_impacts.filter((i) => i.pct_change > 0) ?? [];
  const losers  = selected?.enriched_impacts.filter((i) => i.pct_change < 0) ?? [];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-xs text-gray-600 mb-2">
            <Link href="/" className="hover:text-gray-400 transition-colors">Dashboard</Link>
            <span>/</span>
            <span className="text-gray-400">What-If Engine</span>
          </div>
          <h1 className="text-xl font-bold text-white">What-If Engine</h1>
          <p className="text-gray-500 text-xs mt-0.5">
            Symuluj wpływ makro-scenariuszy na spółki GPW
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">

          {/* Scenario list */}
          <div className="lg:w-80 shrink-0">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
              Scenariusze
            </h2>
            {loadingList ? (
              <div className="flex flex-col gap-2">
                {[1,2,3,4,5,6].map(i => (
                  <div key={i} className="h-20 rounded-xl border border-gray-800 bg-gray-900/40 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {scenarios.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => selectScenario(s.id)}
                    className={`w-full text-left rounded-xl border p-4 transition-all ${
                      selected?.id === s.id
                        ? "border-blue-600/50 bg-blue-900/15 ring-1 ring-blue-600/30"
                        : "border-gray-800 bg-gray-900/40 hover:bg-gray-900/70"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="text-sm font-semibold text-white leading-tight">{s.name}</span>
                    </div>
                    <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${CATEGORY_COLOR[s.category] ?? "border-gray-700 text-gray-400"}`}>
                      {CATEGORY_LABEL[s.category] ?? s.category}
                    </span>
                    <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{s.description}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Scenario detail */}
          <div className="flex-1 min-w-0">
            {!selected && !loadingDetail ? (
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 flex items-center justify-center h-64">
                <div className="text-center">
                  <div className="text-3xl mb-2">🧪</div>
                  <p className="text-gray-500 text-sm">Wybierz scenariusz z listy, aby zobaczyć symulację</p>
                </div>
              </div>
            ) : loadingDetail ? (
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-6 animate-pulse">
                <div className="h-5 bg-gray-800 rounded w-1/2 mb-3" />
                <div className="h-3 bg-gray-800 rounded w-3/4 mb-6" />
                <div className="grid grid-cols-2 gap-4">
                  {[1,2,3,4].map(i => <div key={i} className="h-16 bg-gray-800 rounded" />)}
                </div>
              </div>
            ) : selected && (
              <div className="flex flex-col gap-4">

                {/* Header */}
                <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <h2 className="text-lg font-bold text-white mb-1">{selected.name}</h2>
                      <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded border ${CATEGORY_COLOR[selected.category] ?? "border-gray-700 text-gray-400"}`}>
                        {CATEGORY_LABEL[selected.category] ?? selected.category}
                      </span>
                      <p className="text-sm text-gray-400 mt-2 max-w-xl">{selected.description}</p>
                    </div>
                  </div>
                </div>

                {/* Impact grid: gainers + losers */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                  {/* Gainers */}
                  <div className="rounded-xl border border-emerald-800/30 bg-emerald-900/10 p-4">
                    <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-widest mb-3">
                      ▲ Beneficjenci
                    </h3>
                    {gainers.length === 0 ? (
                      <div className="text-xs text-gray-600 py-3 text-center">Brak beneficjentów</div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {gainers.map((imp) => (
                          <div key={imp.ticker} className="rounded-lg border border-gray-800 bg-gray-900/60 p-3">
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <div>
                                <Link
                                  href={`/companies/${imp.ticker}`}
                                  className="font-mono font-bold text-blue-400 hover:text-blue-300 text-sm transition-colors"
                                >
                                  {imp.ticker}
                                </Link>
                                <span className="text-gray-500 text-xs ml-2">{imp.sector}</span>
                              </div>
                              <span className="text-emerald-400 font-bold tabular-nums text-sm">
                                +{imp.pct_change.toFixed(1)}%
                              </span>
                            </div>
                            {/* Bar */}
                            <div className="h-1 bg-gray-800 rounded-full mb-2 overflow-hidden">
                              <div
                                className="h-full bg-emerald-500 rounded-full"
                                style={{ width: `${Math.min(100, Math.abs(imp.pct_change) * 5)}%` }}
                              />
                            </div>
                            <p className="text-xs text-gray-400 leading-snug">{imp.rationale}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Losers */}
                  <div className="rounded-xl border border-red-800/30 bg-red-900/10 p-4">
                    <h3 className="text-xs font-semibold text-red-400 uppercase tracking-widest mb-3">
                      ▼ Poszkodowani
                    </h3>
                    {losers.length === 0 ? (
                      <div className="text-xs text-gray-600 py-3 text-center">Brak poszkodowanych</div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {losers.map((imp) => (
                          <div key={imp.ticker} className="rounded-lg border border-gray-800 bg-gray-900/60 p-3">
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <div>
                                <Link
                                  href={`/companies/${imp.ticker}`}
                                  className="font-mono font-bold text-blue-400 hover:text-blue-300 text-sm transition-colors"
                                >
                                  {imp.ticker}
                                </Link>
                                <span className="text-gray-500 text-xs ml-2">{imp.sector}</span>
                              </div>
                              <span className="text-red-400 font-bold tabular-nums text-sm">
                                {imp.pct_change.toFixed(1)}%
                              </span>
                            </div>
                            {/* Bar */}
                            <div className="h-1 bg-gray-800 rounded-full mb-2 overflow-hidden">
                              <div
                                className="h-full bg-red-500 rounded-full"
                                style={{ width: `${Math.min(100, Math.abs(imp.pct_change) * 5)}%` }}
                              />
                            </div>
                            <p className="text-xs text-gray-400 leading-snug">{imp.rationale}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Disclaimer */}
                <div className="rounded-lg border border-gray-800 bg-gray-900/30 px-4 py-3">
                  <p className="text-xs text-gray-600">
                    ⚠️ Szacunki mają charakter edukacyjny i nie stanowią rekomendacji inwestycyjnej. Faktyczne reakcje rynku mogą się znacznie różnić.
                  </p>
                </div>

              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
