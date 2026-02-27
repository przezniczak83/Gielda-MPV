"use client";

import { useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PipelineRun {
  id:            number;
  function_name: string;
  source:        string | null;
  started_at:    string;
  finished_at:   string | null;
  status:        string;
  items_in:      number | null;
  items_out:     number | null;
  errors:        number | null;
}

interface FnStat {
  name:          string;
  runs:          number;
  successes:     number;
  last_run:      string | null;
  last_status:   string | null;
  success_rate:  number | null;
  items_in_24h:  number;
  items_out_24h: number;
}

interface PipelineStatusData {
  functions:    FnStat[];
  recent_runs:  PipelineRun[];
  kpis: {
    ai_backlog:   number;
    prices_today: number;
  };
  ts: string;
}

interface HealthData {
  ok:      boolean;
  ts:      string;
  version: string;
  stats: {
    companies:         number;
    events:            number;
    raw_ingest:        number;
    price_history:     number;
    analyst_forecasts: number;
    calendar_events:   number;
    company_kpis:      number;
  };
}

interface ImpactRow {
  event_type:       string;
  sample_count:     number;
  avg_impact_score: number | null;
  positive_pct:     number | null;
  high_impact_pct:  number | null;
  top_tickers:      Array<{ ticker: string; count: number }> | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)   return "teraz";
  if (mins < 60)  return `${mins}m temu`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs}h temu`;
  return `${Math.floor(hrs / 24)}d temu`;
}

function formatTs(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pl-PL", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function durationSec(start: string, end: string | null): string {
  if (!end) return "…";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string | boolean }) {
  const cls =
    status === "success" || status === true  ? "bg-green-500" :
    status === "running"                     ? "bg-yellow-400 animate-pulse" :
    status === "stale"                       ? "bg-yellow-500" :
    status === false || status === "failed"  ? "bg-red-500" :
                                               "bg-gray-600";
  return <span className={`inline-block w-2 h-2 rounded-full ${cls} shrink-0`} />;
}

function StatusIcon({ status }: { status: string | null }) {
  if (status === "success") return <span className="text-green-400 font-bold">✓</span>;
  if (status === "failed")  return <span className="text-red-400 font-bold">✗</span>;
  if (status === "running") return <span className="text-yellow-400 animate-pulse">⋯</span>;
  return <span className="text-gray-600">—</span>;
}

const FUNCTION_LABELS: Record<string, string> = {
  "fetch-news":    "Fetch News",
  "process-news":  "Process News",
  "fetch-espi":    "Fetch ESPI",
  "fetch-prices":  "Fetch Prices",
};

const STAT_LABELS: Array<{ key: keyof HealthData["stats"]; label: string }> = [
  { key: "companies",         label: "Spółki"           },
  { key: "events",            label: "Company Events"   },
  { key: "raw_ingest",        label: "Raw Ingest"       },
  { key: "price_history",     label: "Price History"    },
  { key: "analyst_forecasts", label: "Analyst Forecasts"},
  { key: "calendar_events",   label: "Calendar Events"  },
  { key: "company_kpis",      label: "Company KPIs"     },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StatusPage() {
  const [pipeline, setPipeline] = useState<PipelineStatusData | null>(null);
  const [health,   setHealth]   = useState<HealthData | null>(null);
  const [impact,   setImpact]   = useState<ImpactRow[]>([]);
  const [loading,  setLoading]  = useState(true);

  function load() {
    setLoading(true);
    Promise.all([
      fetch("/api/pipeline-status").then(r => r.json()).catch(() => null),
      fetch("/api/health").then(r => r.json()).catch(() => null),
      fetch("/api/event-impact").then(r => r.json()).catch(() => []),
    ]).then(([p, h, imp]) => {
      if (p)                setPipeline(p as PipelineStatusData);
      if (h)                setHealth(h as HealthData);
      if (Array.isArray(imp)) setImpact(imp as ImpactRow[]);
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-10">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Status systemu</h1>
            <p className="text-gray-500 text-sm mt-1">
              {health ? `v${health.version} — ` : ""}
              {pipeline ? formatTs(pipeline.ts) : "Ładowanie…"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {health && (
              <div className="flex items-center gap-2">
                <StatusDot status={health.ok} />
                <span className={`text-sm font-bold ${health.ok ? "text-green-400" : "text-red-400"}`}>
                  {health.ok ? "OPERATIONAL" : "DEGRADED"}
                </span>
              </div>
            )}
            <button
              onClick={load}
              className="text-xs px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
            >
              ↻ Odśwież
            </button>
          </div>
        </div>

        {loading && (
          <div className="text-center py-16 text-gray-600 animate-pulse">Ładowanie…</div>
        )}

        {/* ── KPI Cards ──────────────────────────────────────────────────── */}
        {pipeline && (
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
              KPI
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* AI Backlog */}
              <div className={`rounded-xl border px-4 py-3 ${
                pipeline.kpis.ai_backlog > 200
                  ? "border-red-900/60 bg-red-950/20"
                  : pipeline.kpis.ai_backlog > 50
                  ? "border-orange-900/50 bg-orange-950/10"
                  : "border-gray-800 bg-gray-900/40"
              }`}>
                <div className="text-[10px] text-gray-500 font-medium mb-1">AI Backlog</div>
                <div className={`text-2xl font-bold tabular-nums ${
                  pipeline.kpis.ai_backlog > 200 ? "text-red-400"
                  : pipeline.kpis.ai_backlog > 50 ? "text-orange-400"
                  : "text-white"
                }`}>{pipeline.kpis.ai_backlog}</div>
                <div className="text-[9px] text-gray-600 mt-0.5">artykułów bez AI</div>
              </div>

              {/* Prices today */}
              <div className={`rounded-xl border px-4 py-3 ${
                pipeline.kpis.prices_today < 50
                  ? "border-orange-900/50 bg-orange-950/10"
                  : "border-gray-800 bg-gray-900/40"
              }`}>
                <div className="text-[10px] text-gray-500 font-medium mb-1">Ceny dziś</div>
                <div className={`text-2xl font-bold tabular-nums ${
                  pipeline.kpis.prices_today < 50 ? "text-orange-400" : "text-white"
                }`}>{pipeline.kpis.prices_today}</div>
                <div className="text-[9px] text-gray-600 mt-0.5">spółek zaktualizowanych</div>
              </div>

              {/* Fetch-news last run */}
              {pipeline.functions.filter(f => f.name === "fetch-news").map(f => (
                <div key="fn-news" className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3">
                  <div className="text-[10px] text-gray-500 font-medium mb-1">Fetch News</div>
                  <div className="flex items-center gap-1.5">
                    <StatusDot status={f.last_status ?? "—"} />
                    <span className="text-sm font-semibold text-white">{timeAgo(f.last_run)}</span>
                  </div>
                  <div className="text-[9px] text-gray-600 mt-0.5">
                    {f.runs}x / 24h · {f.success_rate !== null ? `${f.success_rate}%` : "—"}
                  </div>
                </div>
              ))}

              {/* Fetch-prices last run */}
              {pipeline.functions.filter(f => f.name === "fetch-prices").map(f => (
                <div key="fn-prices" className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3">
                  <div className="text-[10px] text-gray-500 font-medium mb-1">Fetch Prices</div>
                  <div className="flex items-center gap-1.5">
                    <StatusDot status={f.last_status ?? "—"} />
                    <span className="text-sm font-semibold text-white">{timeAgo(f.last_run)}</span>
                  </div>
                  <div className="text-[9px] text-gray-600 mt-0.5">
                    {f.runs}x / 24h · {f.success_rate !== null ? `${f.success_rate}%` : "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Per-function Summary Table ──────────────────────────────────── */}
        {pipeline && pipeline.functions.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
              Pipeline Functions (24h)
            </h2>
            <div className="rounded-xl border border-gray-800 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-600 uppercase tracking-wider">
                    <th className="px-4 py-2.5 text-left font-medium">Funkcja</th>
                    <th className="px-4 py-2.5 text-left font-medium">Ostatni run</th>
                    <th className="px-4 py-2.5 text-center font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Runs 24h</th>
                    <th className="px-4 py-2.5 text-right font-medium">Success %</th>
                    <th className="px-4 py-2.5 text-right font-medium hidden sm:table-cell">Items In</th>
                    <th className="px-4 py-2.5 text-right font-medium hidden sm:table-cell">Items Out</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {pipeline.functions.map(fn => (
                    <tr key={fn.name} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-gray-200">
                        {FUNCTION_LABELS[fn.name] ?? fn.name}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        <div>{fn.last_run ? timeAgo(fn.last_run) : "—"}</div>
                        <div className="text-[10px] text-gray-600">{formatTs(fn.last_run)}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <StatusDot status={fn.last_status ?? "—"} />
                          <span className={`text-[10px] font-bold uppercase ${
                            fn.last_status === "success" ? "text-green-400"
                            : fn.last_status === "failed"  ? "text-red-400"
                            : fn.last_status === "running" ? "text-yellow-400"
                            : "text-gray-600"
                          }`}>
                            {fn.last_status ?? "never"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                        {fn.runs > 0 ? fn.runs : <span className="text-gray-600">0</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {fn.success_rate !== null ? (
                          <span className={
                            fn.success_rate === 100 ? "text-green-400 font-bold"
                            : fn.success_rate >= 80  ? "text-yellow-400"
                            : "text-red-400"
                          }>
                            {fn.success_rate}%
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-400 hidden sm:table-cell">
                        {fn.items_in_24h > 0 ? fn.items_in_24h.toLocaleString("pl-PL") : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-400 hidden sm:table-cell">
                        {fn.items_out_24h > 0 ? fn.items_out_24h.toLocaleString("pl-PL") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Last 20 Runs ────────────────────────────────────────────────── */}
        {pipeline && pipeline.recent_runs.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
              Ostatnie 20 runs
            </h2>
            <div className="rounded-xl border border-gray-800 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-600 uppercase tracking-wider">
                    <th className="px-4 py-2.5 text-left font-medium">Funkcja</th>
                    <th className="px-4 py-2.5 text-left font-medium">Start</th>
                    <th className="px-4 py-2.5 text-center font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium hidden sm:table-cell">Czas</th>
                    <th className="px-4 py-2.5 text-right font-medium">In</th>
                    <th className="px-4 py-2.5 text-right font-medium">Out</th>
                    <th className="px-4 py-2.5 text-right font-medium">Błędy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {pipeline.recent_runs.map(run => (
                    <tr key={run.id} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-gray-300">
                        {FUNCTION_LABELS[run.function_name] ?? run.function_name}
                        {run.source && (
                          <span className="text-gray-600 ml-1">/{run.source}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-gray-400">
                        <div className="tabular-nums">{timeAgo(run.started_at)}</div>
                        <div className="text-[10px] text-gray-600">{formatTs(run.started_at)}</div>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <StatusIcon status={run.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-500 hidden sm:table-cell">
                        {durationSec(run.started_at, run.finished_at)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">
                        {run.items_in  ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">
                        {run.items_out ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {(run.errors ?? 0) > 0
                          ? <span className="text-red-400 font-bold">{run.errors}</span>
                          : <span className="text-gray-600">0</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Database Stats ──────────────────────────────────────────────── */}
        {health && (
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
              Baza danych
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {STAT_LABELS.map(({ key, label }) => (
                <div key={key} className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3">
                  <div className="text-xs text-gray-500 mb-1">{label}</div>
                  <div className={`text-2xl font-bold tabular-nums ${
                    (health.stats[key] ?? 0) > 0 ? "text-white" : "text-gray-600"
                  }`}>
                    {(health.stats[key] ?? 0).toLocaleString("pl-PL")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Event Impact Analysis ───────────────────────────────────────── */}
        {impact.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
              Event Impact Analysis
            </h2>
            <div className="rounded-xl border border-gray-800 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-600 uppercase tracking-wider">
                    <th className="px-4 py-2.5 text-left font-medium">Typ eventu</th>
                    <th className="px-4 py-2.5 text-right font-medium">Próbki</th>
                    <th className="px-4 py-2.5 text-right font-medium">Śr. impact</th>
                    <th className="px-4 py-2.5 text-right font-medium">% pozytywnych</th>
                    <th className="px-4 py-2.5 text-left font-medium hidden sm:table-cell">Top spółki</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {impact.map(row => (
                    <tr key={row.event_type} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-gray-300">{row.event_type}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">{row.sample_count}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${
                        (row.avg_impact_score ?? 0) >= 7 ? "text-green-400"
                        : (row.avg_impact_score ?? 0) >= 4 ? "text-yellow-400"
                        : "text-gray-400"
                      }`}>
                        {row.avg_impact_score !== null ? row.avg_impact_score.toFixed(1) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">
                        {row.positive_pct !== null ? `${row.positive_pct.toFixed(0)}%` : "—"}
                      </td>
                      <td className="px-4 py-2.5 hidden sm:table-cell text-gray-600 font-mono">
                        {(row.top_tickers ?? []).slice(0, 3).map(t => t.ticker).join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="text-center pt-2">
          <a
            href="https://supabase.com/dashboard/project/pftgmorsthoezhmojjpg"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            Supabase Dashboard →
          </a>
        </div>

      </div>
    </div>
  );
}
