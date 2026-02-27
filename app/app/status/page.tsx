"use client";

import { useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PipelineRow {
  function_name:   string;
  last_success_at: string | null;
  runs_24h:        number;
  successes_24h:   number;
  items_out_24h:   number;
  health:          "healthy" | "degraded" | "stale" | "dead" | string;
}

interface ErrorRow {
  function_name: string;
  started_at:    string;
  finished_at:   string | null;
  error_message: string | null;
  errors:        number | null;
  items_in:      number | null;
  items_out:     number | null;
}

interface StatusData {
  overall:       "healthy" | "degraded" | "critical";
  ts:            string;
  pipeline:      PipelineRow[];
  kpi: {
    ai_backlog:           number;
    ticker_coverage_7d:   number | null;
    prices_updated_today: number;
    total_news:           number;
  };
  db: {
    companies:      number;
    news_items:     number;
    price_history:  number;
    company_events: number;
  };
  recent_errors: ErrorRow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "teraz";
  if (mins < 60) return `${mins}m temu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h temu`;
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

const FUNCTION_LABELS: Record<string, string> = {
  "fetch-news":    "Fetch News",
  "process-news":  "Process News",
  "fetch-espi":    "Fetch ESPI",
  "fetch-prices":  "Fetch Prices",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function OverallBadge({ status }: { status: StatusData["overall"] }) {
  const cfg = {
    healthy:  { dot: "bg-green-500",  text: "text-green-400",  border: "border-green-900/50  bg-green-950/20",  label: "OPERATIONAL"  },
    degraded: { dot: "bg-yellow-400", text: "text-yellow-400", border: "border-yellow-900/50 bg-yellow-950/20", label: "DEGRADED"     },
    critical: { dot: "bg-red-500 animate-pulse", text: "text-red-400", border: "border-red-900/50 bg-red-950/20", label: "CRITICAL" },
  }[status];

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-5 py-3 ${cfg.border}`}>
      <span className={`w-3 h-3 rounded-full shrink-0 ${cfg.dot}`} />
      <span className={`text-lg font-bold tracking-wide ${cfg.text}`}>{cfg.label}</span>
    </div>
  );
}

function HealthBadge({ health }: { health: string }) {
  const cfg: Record<string, string> = {
    healthy:  "bg-green-900/50 text-green-400 border border-green-800/50",
    degraded: "bg-yellow-900/40 text-yellow-400 border border-yellow-800/40",
    stale:    "bg-orange-900/40 text-orange-400 border border-orange-800/40",
    dead:     "bg-red-900/50 text-red-400 border border-red-800/50",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${cfg[health] ?? "bg-gray-800 text-gray-500"}`}>
      {health}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StatusPage() {
  const [data,    setData]    = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    fetch("/api/status")
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error as string);
        setData(d as StatusData);
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 60_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const overall = data?.overall ?? "healthy";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-5xl mx-auto px-4 py-6 md:px-6 md:py-10 space-y-10">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white">Status systemu</h1>
            <p className="text-gray-500 text-sm mt-1">
              {data ? `Ostatnia aktualizacja: ${formatTs(data.ts)}` : "Ładowanie…"}
              {" · auto-refresh co 60s"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {data && <OverallBadge status={overall} />}
            <button
              onClick={load}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 transition-colors"
            >
              {loading ? "…" : "↻ Odśwież"}
            </button>
          </div>
        </div>

        {/* ── Error ──────────────────────────────────────────────────────── */}
        {error && (
          <div className="rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm text-red-400">
            Błąd: {error}
          </div>
        )}

        {loading && !data && (
          <div className="text-center py-16 text-gray-600 animate-pulse">Ładowanie…</div>
        )}

        {/* ── Pipeline ───────────────────────────────────────────────────── */}
        {data && (
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
              Pipeline (24h)
            </h2>
            {data.pipeline.length === 0 ? (
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-6 text-center text-sm text-gray-600">
                Brak danych — Edge Functions jeszcze nie zalogowały żadnych runs.
              </div>
            ) : (
              <div className="rounded-xl border border-gray-800 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-600 uppercase tracking-wider">
                      <th className="px-4 py-2.5 text-left  font-medium">Funkcja</th>
                      <th className="px-4 py-2.5 text-left  font-medium">Ostatni sukces</th>
                      <th className="px-4 py-2.5 text-center font-medium">Health</th>
                      <th className="px-4 py-2.5 text-right font-medium">Runs 24h</th>
                      <th className="px-4 py-2.5 text-right font-medium hidden sm:table-cell">Items Out 24h</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/50">
                    {data.pipeline.map(row => (
                      <tr key={row.function_name} className="hover:bg-gray-800/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-gray-200">
                          {FUNCTION_LABELS[row.function_name] ?? row.function_name}
                        </td>
                        <td className="px-4 py-3 text-gray-400">
                          <div>{timeAgo(row.last_success_at)}</div>
                          <div className="text-[10px] text-gray-600">{formatTs(row.last_success_at)}</div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <HealthBadge health={row.health} />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-300">
                          {row.runs_24h > 0 ? (
                            <>
                              {row.runs_24h}
                              {row.successes_24h < row.runs_24h && (
                                <span className="text-red-400 ml-1">
                                  ({row.runs_24h - row.successes_24h} fail)
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-gray-600">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-400 hidden sm:table-cell">
                          {row.items_out_24h > 0
                            ? row.items_out_24h.toLocaleString("pl-PL")
                            : <span className="text-gray-600">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── KPI Cards ──────────────────────────────────────────────────── */}
        {data && (
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">KPI</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">

              {/* AI Backlog */}
              <div className={`rounded-xl border px-4 py-3 ${
                data.kpi.ai_backlog > 200 ? "border-red-900/60 bg-red-950/20"
                : data.kpi.ai_backlog > 50 ? "border-orange-900/50 bg-orange-950/10"
                : "border-gray-800 bg-gray-900/40"
              }`}>
                <div className="text-[10px] text-gray-500 font-medium mb-1">AI Backlog</div>
                <div className={`text-2xl font-bold tabular-nums ${
                  data.kpi.ai_backlog > 200 ? "text-red-400"
                  : data.kpi.ai_backlog > 50 ? "text-orange-400"
                  : "text-white"
                }`}>{data.kpi.ai_backlog.toLocaleString("pl-PL")}</div>
                <div className="text-[9px] text-gray-600 mt-0.5">artykułów bez AI</div>
              </div>

              {/* Ticker Coverage */}
              <div className={`rounded-xl border px-4 py-3 ${
                (data.kpi.ticker_coverage_7d ?? 0) < 50 ? "border-orange-900/50 bg-orange-950/10"
                : "border-gray-800 bg-gray-900/40"
              }`}>
                <div className="text-[10px] text-gray-500 font-medium mb-1">Ticker Coverage 7d</div>
                <div className={`text-2xl font-bold tabular-nums ${
                  data.kpi.ticker_coverage_7d === null ? "text-gray-600"
                  : data.kpi.ticker_coverage_7d < 50  ? "text-orange-400"
                  : data.kpi.ticker_coverage_7d < 75  ? "text-yellow-400"
                  : "text-green-400"
                }`}>
                  {data.kpi.ticker_coverage_7d !== null ? `${data.kpi.ticker_coverage_7d}%` : "—"}
                </div>
                <div className="text-[9px] text-gray-600 mt-0.5">newsów z przypisanym tickerem</div>
              </div>

              {/* Prices today */}
              <div className={`rounded-xl border px-4 py-3 ${
                data.kpi.prices_updated_today < 50 ? "border-orange-900/50 bg-orange-950/10"
                : "border-gray-800 bg-gray-900/40"
              }`}>
                <div className="text-[10px] text-gray-500 font-medium mb-1">Ceny dziś</div>
                <div className={`text-2xl font-bold tabular-nums ${
                  data.kpi.prices_updated_today < 50 ? "text-orange-400" : "text-white"
                }`}>{data.kpi.prices_updated_today}</div>
                <div className="text-[9px] text-gray-600 mt-0.5">z {data.db.companies} spółek zaktualizowanych</div>
              </div>

              {/* Total news */}
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3">
                <div className="text-[10px] text-gray-500 font-medium mb-1">Total News</div>
                <div className="text-2xl font-bold tabular-nums text-white">
                  {data.kpi.total_news.toLocaleString("pl-PL")}
                </div>
                <div className="text-[9px] text-gray-600 mt-0.5">artykułów w bazie</div>
              </div>
            </div>
          </div>
        )}

        {/* ── Database Counts ─────────────────────────────────────────────── */}
        {data && (
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
              Baza danych
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(
                [
                  { key: "companies"      as const, label: "Spółki"         },
                  { key: "news_items"     as const, label: "News Items"      },
                  { key: "price_history"  as const, label: "Price History"   },
                  { key: "company_events" as const, label: "Company Events"  },
                ] as const
              ).map(({ key, label }) => (
                <div key={key} className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3">
                  <div className="text-xs text-gray-500 mb-1">{label}</div>
                  <div className={`text-2xl font-bold tabular-nums ${
                    (data.db[key] ?? 0) > 0 ? "text-white" : "text-gray-600"
                  }`}>
                    {(data.db[key] ?? 0).toLocaleString("pl-PL")}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Recent Errors ───────────────────────────────────────────────── */}
        {data && data.recent_errors.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
              Ostatnie błędy
            </h2>
            <div className="rounded-xl border border-red-900/40 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-600 uppercase tracking-wider">
                    <th className="px-4 py-2.5 text-left  font-medium">Funkcja</th>
                    <th className="px-4 py-2.5 text-left  font-medium">Kiedy</th>
                    <th className="px-4 py-2.5 text-right font-medium hidden sm:table-cell">Czas</th>
                    <th className="px-4 py-2.5 text-left  font-medium">Błąd</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {data.recent_errors.map((e, i) => (
                    <tr key={i} className="hover:bg-red-950/10 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-red-300">
                        {FUNCTION_LABELS[e.function_name] ?? e.function_name}
                      </td>
                      <td className="px-4 py-2.5 text-gray-400">
                        <div>{timeAgo(e.started_at)}</div>
                        <div className="text-[10px] text-gray-600">{formatTs(e.started_at)}</div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-500 hidden sm:table-cell">
                        {durationSec(e.started_at, e.finished_at)}
                      </td>
                      <td className="px-4 py-2.5 text-gray-400 max-w-xs truncate">
                        {e.error_message ?? <span className="text-gray-600">brak opisu</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── No errors state ─────────────────────────────────────────────── */}
        {data && data.recent_errors.length === 0 && (
          <div className="rounded-xl border border-green-900/30 bg-green-950/10 px-4 py-3 text-sm text-green-500 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
            Brak błędów w pipeline_runs
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
