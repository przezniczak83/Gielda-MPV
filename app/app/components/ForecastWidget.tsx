"use client";

import { useEffect, useState } from "react";
import { LiveTimestamp }       from "./LiveTimestamp";

interface ScenarioData {
  scenario:           string;
  revenue_growth_pct: number | null;
  ebitda_margin_pct:  number | null;
  eps:                number | null;
  price_target:       number | null;
  rationale:          string | null;
  confidence:         number | null;
  key_assumptions:    string[] | null;
  generated_at:       string | null;
}

const SCENARIOS = ["bear", "base", "bull"] as const;
type ScenarioKey = typeof SCENARIOS[number];

const SCENARIO_META: Record<ScenarioKey, { label: string; color: string; border: string; bg: string }> = {
  bear: { label: "Pesymistyczny",  color: "text-red-400",    border: "border-red-500/30",    bg: "bg-red-500/5"    },
  base: { label: "Bazowy",         color: "text-blue-400",   border: "border-blue-500/30",   bg: "bg-blue-500/5"   },
  bull: { label: "Optymistyczny",  color: "text-green-400",  border: "border-green-500/30",  bg: "bg-green-500/5"  },
};

function ConfidenceBar({ value }: { value: number | null }) {
  if (value == null) return null;
  const pct = Math.round((value / 10) * 100);
  const color = value >= 7 ? "bg-green-500" : value >= 4 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-500 tabular-nums w-8 text-right">{value}/10</span>
    </div>
  );
}

export default function ForecastWidget({ ticker }: { ticker: string }) {
  const [scenarios, setScenarios] = useState<Record<ScenarioKey, ScenarioData> | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [genAt,     setGenAt]     = useState<string | null>(null);

  const supabaseRef = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([^.]+)/)?.[1] ?? "";

  async function loadForecasts() {
    setLoading(true);
    try {
      const res = await fetch(`/api/our-forecasts?ticker=${encodeURIComponent(ticker)}`);
      if (!res.ok) { setLoading(false); return; }
      const rows = await res.json() as ScenarioData[];
      if (rows.length > 0) {
        const map = {} as Record<ScenarioKey, ScenarioData>;
        for (const r of rows) {
          if (r.scenario === "base" || r.scenario === "bull" || r.scenario === "bear") {
            map[r.scenario as ScenarioKey] = r;
          }
        }
        if (map.base) {
          setScenarios(map);
          setGenAt(map.base.generated_at);
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { loadForecasts(); }, [ticker]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/gen-forecast`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ticker }),
      });
      const json = await res.json() as { ok: boolean; error?: string };
      if (!json.ok) {
        setError(json.error ?? "Błąd generowania prognozy");
      } else {
        await loadForecasts();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd sieci");
    } finally {
      setGenerating(false);
    }
  }

  const genAtStr = genAt
    ? new Date(genAt).toLocaleDateString("pl-PL", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
            Prognoza AI (3 scenariusze)
            <LiveTimestamp date={genAt} prefix="prognoza" />
          </h3>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="text-xs px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 transition-colors font-medium"
        >
          {generating ? "Generuję…" : scenarios ? "↻ Regeneruj" : "Generuj"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-gray-600 text-sm animate-pulse">Ładowanie prognoz…</div>
      ) : !scenarios ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-10 text-center">
          <div className="text-gray-500 text-sm mb-3">Brak prognozy AI dla tej spółki.</div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-xs px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium transition-colors"
          >
            {generating ? "Generuję…" : "Generuj prognozę"}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {SCENARIOS.map(key => {
            const sc   = scenarios[key];
            const meta = SCENARIO_META[key];
            if (!sc) return null;
            return (
              <div key={key} className={`rounded-xl border ${meta.border} ${meta.bg} px-4 py-4 flex flex-col gap-3`}>
                {/* Scenario label + PT */}
                <div>
                  <div className={`text-xs font-bold uppercase tracking-widest ${meta.color}`}>
                    {meta.label}
                  </div>
                  <div className="text-2xl font-bold text-white tabular-nums mt-1">
                    {sc.price_target != null ? `${sc.price_target} PLN` : "—"}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">Cena docelowa</div>
                  <ConfidenceBar value={sc.confidence} />
                </div>

                {/* Key metrics */}
                <div className="space-y-1">
                  {sc.revenue_growth_pct != null && (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Wzrost przychodów</span>
                      <span className={`tabular-nums font-medium ${sc.revenue_growth_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {sc.revenue_growth_pct > 0 ? "+" : ""}{sc.revenue_growth_pct}%
                      </span>
                    </div>
                  )}
                  {sc.ebitda_margin_pct != null && (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">Marża EBITDA</span>
                      <span className="tabular-nums font-medium text-gray-300">{sc.ebitda_margin_pct}%</span>
                    </div>
                  )}
                  {sc.eps != null && (
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-500">EPS</span>
                      <span className="tabular-nums font-medium text-gray-300">{sc.eps} PLN</span>
                    </div>
                  )}
                </div>

                {/* Rationale */}
                {sc.rationale && (
                  <p className="text-xs text-gray-400 leading-relaxed italic border-t border-gray-800/60 pt-3">
                    {sc.rationale}
                  </p>
                )}

                {/* Key assumptions */}
                {sc.key_assumptions && sc.key_assumptions.length > 0 && (
                  <div className="border-t border-gray-800/60 pt-3">
                    <div className="text-xs text-gray-600 font-medium mb-1">Założenia:</div>
                    <ul className="space-y-0.5">
                      {sc.key_assumptions.slice(0, 3).map((a, i) => (
                        <li key={i} className="text-xs text-gray-500 flex gap-1">
                          <span className="text-gray-700">•</span>
                          <span>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
