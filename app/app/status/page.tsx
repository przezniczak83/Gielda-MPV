"use client";

import { useEffect, useState } from "react";

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
    portfolio_positions: number;
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
  { key: "portfolio_positions", label: "Portfolio Positions"},
  { key: "calendar_events",     label: "Calendar Events"    },
  { key: "company_kpis",        label: "Company KPIs"       },
];

export default function StatusPage() {
  const [data,    setData]    = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  function load() {
    setLoading(true);
    fetch("/api/health")
      .then(r => r.json())
      .then((d: HealthData) => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
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
