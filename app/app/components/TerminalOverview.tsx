"use client";

// TerminalOverview.tsx — Bloomberg-style compact company overview.
// Fetches data from /api/company/[ticker] (snapshot-first, cached).

import { useEffect, useState } from "react";
import { LiveTimestamp }       from "./LiveTimestamp";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SnapshotCompany {
  ticker: string;
  name:   string;
  sector: string | null;
  market: string;
}

interface SnapshotPrice {
  close:  number;
  volume: number | null;
  date:   string;
}

interface SnapshotKpis {
  health_score:     number | null;
  red_flags:        number | null;
  moat_score:       number | null;
  earnings_quality: number | null;
}

interface SnapshotConsensus {
  label:             string | null;
  avg_target_price:  number | null;
  upside_pct:        number | null;
}

interface SnapshotMultiples {
  pe:         number | null;
  ev_ebitda:  number | null;
}

interface SnapshotEvent {
  title:        string;
  event_type:   string | null;
  impact_score: number | null;
  published_at: string | null;
}

interface CompanyData {
  ok:            boolean;
  source?:       string;
  computed_at?:  string;
  company?:      SnapshotCompany;
  price?:        SnapshotPrice | null;
  change_pct?:   number | null;
  kpis?:         SnapshotKpis;
  consensus?:    SnapshotConsensus;
  multiples?:    SnapshotMultiples;
  recent_events?: SnapshotEvent[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAge(isoDate: string): string {
  const mins = Math.floor((Date.now() - new Date(isoDate).getTime()) / 60000);
  if (mins < 1)  return "teraz";
  if (mins < 60) return `${mins} min temu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h temu`;
  return `${Math.floor(hrs / 24)}d temu`;
}

function formatEventAge(isoDate: string | null): string {
  if (!isoDate) return "";
  const days = Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
  if (days === 0) return "dziś";
  if (days === 1) return "1d";
  if (days < 7)  return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

function num(v: number | null | undefined, dec = 1): string {
  return v != null ? Number(v).toFixed(dec) : "—";
}

function formatVol(v: number | null | undefined): string {
  if (!v) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

function ConsensusChip({ label }: { label: string | null | undefined }) {
  if (!label) return <span className="text-gray-600">—</span>;
  const cls =
    label === "BUY"  ? "text-green-400"
    : label === "SELL" ? "text-red-400"
    : "text-yellow-400";
  return <span className={`font-bold ${cls}`}>{label}</span>;
}

function HealthMini({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-gray-600">—</span>;
  const cls =
    score >= 7 ? "text-green-400"
    : score >= 4 ? "text-yellow-400"
    : "text-red-400";
  return <span className={`font-mono ${cls}`}>{num(score)}</span>;
}

function ImpactDot({ score }: { score: number | null | undefined }) {
  if (score == null) return null;
  const cls =
    score >= 7 ? "text-red-400"
    : score >= 4 ? "text-yellow-400"
    : "text-gray-500";
  return <span className={cls}>⚡{score}</span>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TerminalOverview({ ticker }: { ticker: string }) {
  const [data,    setData]    = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/company/${ticker}`)
      .then(r => r.json())
      .then((d: CompanyData) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-950 p-4 font-mono space-y-2 animate-pulse">
        <div className="h-4 bg-gray-800 rounded w-1/3" />
        <div className="h-3 bg-gray-800 rounded w-1/2" />
        <div className="h-px bg-gray-800 my-2" />
        <div className="grid grid-cols-3 gap-3">
          {[1,2,3].map(i => <div key={i} className="h-10 bg-gray-800 rounded" />)}
        </div>
      </div>
    );
  }

  if (!data?.ok || !data.company) return null;

  const c      = data.company;
  const price  = data.price;
  const chg    = data.change_pct;
  const kpis   = data.kpis;
  const cons   = data.consensus;
  const mult   = data.multiples;
  const events = (data.recent_events ?? []).slice(0, 3);

  const chgPositive = chg != null && chg >= 0;
  const chgColor    = chg == null ? "text-gray-500" : chgPositive ? "text-green-400" : "text-red-400";

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/80 overflow-hidden font-mono text-xs">

      {/* ── Header row ── */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-start justify-between gap-2">
        <div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-white font-bold text-base">{c.ticker}</span>
            <span className="text-gray-400">{c.name}</span>
            <span className="text-gray-600">{c.sector ?? "—"} / {c.market}</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2 flex-wrap">
            {price ? (
              <>
                <span className="text-white font-bold text-lg tabular-nums">
                  {Number(price.close).toFixed(2)} PLN
                </span>
                <span className={`font-bold ${chgColor}`}>
                  {chg != null ? `${chgPositive ? "▲" : "▼"} ${chgPositive ? "+" : ""}${Number(chg).toFixed(2)}%` : "—"}
                </span>
                <span className="text-gray-600">Vol: {formatVol(price.volume)}</span>
                <span className="px-1.5 py-0.5 rounded bg-green-900/30 text-green-500 text-[10px]">LIVE</span>
                <LiveTimestamp date={price.date} prefix="kurs" />
              </>
            ) : (
              <span className="text-gray-500">Brak danych cenowych</span>
            )}
          </div>
        </div>
        {data.computed_at && (
          <span className="text-gray-700 text-[10px] whitespace-nowrap shrink-0 mt-1">
            {formatAge(data.computed_at)}
          </span>
        )}
      </div>

      {/* ── KPI grid ── */}
      <div className="grid grid-cols-3 divide-x divide-gray-800 border-b border-gray-800">
        <div className="px-4 py-2.5 space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-600">Health</span>
            <HealthMini score={kpis?.health_score} />
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Flags</span>
            <span className={`font-mono ${kpis?.red_flags ? "text-red-400" : "text-green-400"}`}>
              {kpis?.red_flags != null ? (kpis.red_flags > 0 ? `⚠ ${kpis.red_flags}` : "✓ 0") : "—"}
            </span>
          </div>
        </div>
        <div className="px-4 py-2.5 space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-600">MOAT</span>
            <HealthMini score={kpis?.moat_score} />
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">EQ</span>
            <HealthMini score={kpis?.earnings_quality} />
          </div>
        </div>
        <div className="px-4 py-2.5 space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-600">Consensus</span>
            <ConsensusChip label={cons?.label} />
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">PT avg</span>
            <span className="text-gray-300 tabular-nums">
              {cons?.avg_target_price
                ? `${Number(cons.avg_target_price).toFixed(0)} PLN`
                : "—"}
              {cons?.upside_pct != null && (
                <span className={cons.upside_pct >= 0 ? "text-green-400 ml-1" : "text-red-400 ml-1"}>
                  ({cons.upside_pct >= 0 ? "+" : ""}{Number(cons.upside_pct).toFixed(0)}%)
                </span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* ── Multiples row ── */}
      <div className="px-4 py-2 border-b border-gray-800 flex gap-6 text-[11px]">
        <span>
          <span className="text-gray-600">P/E </span>
          <span className="text-gray-200 tabular-nums">{num(mult?.pe, 1)}</span>
        </span>
        <span>
          <span className="text-gray-600">EV/EBITDA </span>
          <span className="text-gray-200 tabular-nums">{num(mult?.ev_ebitda, 1)}</span>
        </span>
        <span className="text-gray-700 ml-auto text-[10px] self-center">
          {data.source === "snapshot" ? "snapshot" : "live"}
        </span>
      </div>

      {/* ── Recent events ── */}
      {events.length > 0 && (
        <div className="px-4 py-2">
          <div className="text-[10px] text-gray-700 uppercase tracking-widest mb-1.5">Ostatnie eventy</div>
          <div className="space-y-1">
            {events.map((e, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px]">
                <span className="text-gray-700 shrink-0">●</span>
                <span className="text-gray-300 flex-1 truncate">{e.title}</span>
                <span className="text-gray-600 shrink-0 whitespace-nowrap">
                  {e.event_type ?? "inne"}
                </span>
                <span className="shrink-0">
                  <ImpactDot score={e.impact_score} />
                </span>
                <span className="text-gray-700 shrink-0 w-8 text-right">
                  {formatEventAge(e.published_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
