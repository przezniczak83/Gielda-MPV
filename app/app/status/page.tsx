"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface NewsLogRow {
  function_name:   string;
  status:          string;
  items_fetched:   number | null;
  items_processed: number | null;
  items_failed:    number | null;
  error_message:   string | null;
  created_at:      string;
}

interface NewsPipelineData {
  pipeline: {
    total_24h:     number;
    processed_24h: number;
    total_1h:      number;
    pending_ai:    number;
  };
  breaking_24h: Array<{ id: number; title: string; source: string; published_at: string | null }>;
  log:          NewsLogRow[];
}

const FUNCTION_LABELS: Record<string, string> = {
  "fetch-news":          "📥 Fetch News",
  "process-news":        "🤖 Process News",
  "send-news-alerts":    "📨 Send Alerts",
  "fetch-espi":          "📋 Fetch ESPI",
  "aggregate-sentiment": "📊 Aggregate Sentiment",
};

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "ok"      ? "bg-emerald-900/50 text-emerald-300 border-emerald-800" :
    status === "partial" ? "bg-yellow-900/50 text-yellow-300 border-yellow-800" :
                           "bg-red-900/50 text-red-300 border-red-800";
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase ${cls}`}>
      {status}
    </span>
  );
}

interface ImpactRow {
  event_type:       string;
  sample_count:     number;
  avg_impact_score: number | null;
  positive_pct:     number | null;
  high_impact_pct:  number | null;
  top_tickers:      Array<{ ticker: string; count: number; avg_score: number }> | null;
  computed_at:      string | null;
}

interface HealthData {
  ok:      boolean;
  ts:      string;
  version: string;
  stats: {
    companies:           number;
    events:              number;
    raw_ingest:          number;
    price_history:       number;
    analyst_forecasts:   number;

    calendar_events:     number;
    company_kpis:        number;
  };
  pipeline: {
    last_espi_fetch:    string | null;
    last_price_update:  string | null;
    last_telegram_alert:string | null;
    espi_status:        "ok" | "stale" | "error";
    price_status:       "ok" | "stale" | "error";
  };
  edge_functions: string[];
}

function StatusDot({ status }: { status: "ok" | "stale" | "error" | boolean }) {
  const isOk    = status === "ok"  || status === true;
  const isStale = status === "stale";
  const cls = isOk ? "bg-green-500" : isStale ? "bg-yellow-500" : "bg-red-500";
  return (
    <span className={`inline-block w-2.5 h-2.5 rounded-full ${cls} shrink-0`} />
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60)  return `${mins}m temu`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs}h temu`;
  const days = Math.floor(hrs / 24);
  return `${days}d temu`;
}

function formatTs(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pl-PL", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

const STAT_LABELS: Array<{ key: keyof HealthData["stats"]; label: string }> = [
  { key: "companies",           label: "Spółki"             },
  { key: "events",              label: "Company Events"     },
  { key: "raw_ingest",          label: "Raw Ingest"         },
  { key: "price_history",       label: "Price History"      },
  { key: "analyst_forecasts",   label: "Analyst Forecasts"  },

  { key: "calendar_events",     label: "Calendar Events"    },
  { key: "company_kpis",        label: "Company KPIs"       },
];

export default function StatusPage() {
  const [data,      setData]      = useState<HealthData | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(false);
  const [impact,    setImpact]    = useState<ImpactRow[]>([]);
  const [newsData,  setNewsData]  = useState<NewsPipelineData | null>(null);

  function load() {
    setLoading(true);
    fetch("/api/health")
      .then(r => r.json())
      .then((d: HealthData) => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
    fetch("/api/event-impact")
      .then(r => r.json())
      .then((d: ImpactRow[]) => { if (Array.isArray(d)) setImpact(d); })
      .catch(() => { /* non-critical */ });
    fetch("/api/status")
      .then(r => r.json())
      .then((d: NewsPipelineData) => setNewsData(d))
      .catch(() => { /* non-critical */ });
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-4xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Status systemu</h1>
            <p className="text-gray-500 text-sm mt-1">
              Giełda Monitor v{data?.version ?? "…"} — {data ? formatTs(data.ts) : "Ładowanie…"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {data && (
              <div className="flex items-center gap-2">
                <StatusDot status={data.ok} />
                <span className={`text-sm font-bold ${data.ok ? "text-green-400" : "text-red-400"}`}>
                  {data.ok ? "OPERATIONAL" : "DEGRADED"}
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

        {error && !loading && (
          <div className="text-center py-16 text-red-400">Błąd połączenia z API</div>
        )}

        {/* News pipeline section — independent of main health check */}
        {newsData && (
          <div className="space-y-4 mb-8">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
              News Pipeline (24h)
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "Newsy łącznie",  value: newsData.pipeline.total_24h,     warn: false },
                { label: "Przetworzone AI", value: newsData.pipeline.processed_24h, warn: false },
                { label: "Nowe (1h)",       value: newsData.pipeline.total_1h,      warn: false },
                { label: "Oczekują AI",     value: newsData.pipeline.pending_ai,    warn: newsData.pipeline.pending_ai > 50 },
              ].map(({ label, value, warn }) => (
                <div key={label} className={`rounded-xl border px-4 py-3 ${warn ? "border-orange-900/50 bg-orange-950/10" : "border-gray-800 bg-gray-900/40"}`}>
                  <div className="text-[10px] text-gray-500 font-medium mb-1">{label}</div>
                  <div className={`text-2xl font-bold tabular-nums ${warn ? "text-orange-400" : "text-white"}`}>{value}</div>
                </div>
              ))}
            </div>

            {newsData.log.length > 0 && (
              <div className="rounded-xl border border-gray-800 overflow-hidden">
                <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/40">
                  <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest">Ingestion Log</p>
                </div>
                <div className="divide-y divide-gray-800/50">
                  {newsData.log.map((row, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-900/30 transition-colors">
                      <div className="w-32 shrink-0 text-[10px] text-gray-600 tabular-nums">
                        {new Date(row.created_at).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div className="w-40 shrink-0 text-xs text-gray-300">
                        {FUNCTION_LABELS[row.function_name] ?? row.function_name}
                      </div>
                      <StatusBadge status={row.status} />
                      <div className="flex items-center gap-3 text-[10px] ml-2">
                        {row.items_fetched   !== null && <span className="text-gray-500">↓<span className="text-gray-300 ml-0.5">{row.items_fetched}</span></span>}
                        {row.items_processed !== null && <span className="text-gray-500">✓<span className="text-gray-300 ml-0.5">{row.items_processed}</span></span>}
                        {(row.items_failed ?? 0) > 0   && <span className="text-gray-500">✗<span className="text-red-400 ml-0.5">{row.items_failed}</span></span>}
                      </div>
                      {row.error_message && (
                        <span className="text-[9px] text-red-400 truncate ml-2 max-w-xs" title={row.error_message}>
                          {row.error_message}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {data && !loading && (
          <div className="space-y-6">

            {/* ── Pipeline ──────────────────────────────────────────────── */}
            <div>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
                Pipeline
              </h2>
              <div className="rounded-xl border border-gray-800 overflow-hidden divide-y divide-gray-800/60">
                <div className="flex items-center gap-4 px-5 py-3.5">
                  <StatusDot status={data.pipeline.espi_status} />
                  <span className="text-sm text-gray-300 flex-1">ESPI Fetch</span>
                  <span className="text-xs text-gray-500">{formatTs(data.pipeline.last_espi_fetch)}</span>
                  <span className={`text-xs font-bold w-12 text-right ${
                    data.pipeline.espi_status === "ok" ? "text-green-400"
                    : data.pipeline.espi_status === "stale" ? "text-yellow-400"
                    : "text-red-400"
                  }`}>{data.pipeline.espi_status.toUpperCase()}</span>
                </div>
                <div className="flex items-center gap-4 px-5 py-3.5">
                  <StatusDot status={data.pipeline.price_status} />
                  <span className="text-sm text-gray-300 flex-1">Price Update</span>
                  <span className="text-xs text-gray-500">
                    {data.pipeline.last_price_update ?? "—"}
                  </span>
                  <span className={`text-xs font-bold w-12 text-right ${
                    data.pipeline.price_status === "ok" ? "text-green-400"
                    : data.pipeline.price_status === "stale" ? "text-yellow-400"
                    : "text-red-400"
                  }`}>{data.pipeline.price_status.toUpperCase()}</span>
                </div>
                <div className="flex items-center gap-4 px-5 py-3.5">
                  <StatusDot status={data.pipeline.last_telegram_alert ? "ok" : "stale"} />
                  <span className="text-sm text-gray-300 flex-1">Telegram Alerts</span>
                  <span className="text-xs text-gray-500">{timeAgo(data.pipeline.last_telegram_alert)}</span>
                  <span className="text-xs font-bold w-12 text-right text-gray-500">—</span>
                </div>
              </div>
            </div>

            {/* ── Database stats ─────────────────────────────────────────── */}
            <div>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
                Baza danych
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {STAT_LABELS.map(({ key, label }) => (
                  <div key={key} className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3">
                    <div className="text-xs text-gray-500 mb-1">{label}</div>
                    <div className={`text-2xl font-bold tabular-nums ${
                      (data.stats[key] ?? 0) > 0 ? "text-white" : "text-gray-600"
                    }`}>
                      {(data.stats[key] ?? 0).toLocaleString("pl-PL")}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Edge Functions ─────────────────────────────────────────── */}
            <div>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
                Edge Functions ({data.edge_functions.length})
              </h2>
              <div className="rounded-xl border border-gray-800 overflow-hidden">
                <div className="grid grid-cols-2 sm:grid-cols-3 divide-y divide-gray-800/60">
                  {data.edge_functions.map(fn => (
                    <div key={fn} className="flex items-center gap-3 px-4 py-3 border-b border-gray-800/40 last:border-b-0">
                      <StatusDot status="ok" />
                      <span className="text-xs font-mono text-gray-300">{fn}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Event Impact Analysis ──────────────────────────────────── */}
            {impact.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
                  Event Impact Analysis
                </h2>
                <div className="rounded-xl border border-gray-800 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-600 uppercase tracking-wider">
                        <th className="px-4 py-2 text-left font-medium">Typ eventu</th>
                        <th className="px-4 py-2 text-right font-medium">Próbki</th>
                        <th className="px-4 py-2 text-right font-medium">Śr. impact</th>
                        <th className="px-4 py-2 text-right font-medium">% pozytywnych</th>
                        <th className="px-4 py-2 text-right font-medium">% wysokich</th>
                        <th className="px-4 py-2 text-left font-medium hidden sm:table-cell">Top spółki</th>
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
                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">
                            {row.high_impact_pct !== null ? `${row.high_impact_pct.toFixed(0)}%` : "—"}
                          </td>
                          <td className="px-4 py-2.5 hidden sm:table-cell">
                            <span className="text-gray-600 font-mono">
                              {(row.top_tickers ?? []).slice(0, 3).map(t => t.ticker).join(", ")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Supabase link ──────────────────────────────────────────── */}
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
        )}
      </div>
    </div>
  );
}
