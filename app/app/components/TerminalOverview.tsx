"use client";

// TerminalOverview.tsx — Bloomberg-style compact company overview.
// Groups metrics into: WYCENA / KONDYCJA / KONSENSUS
// Includes AI summary block from /api/gen-summary.

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
  pe?:        number | null;
  ev_ebitda?: number | null;
  pb?:        number | null;
  ps?:        number | null;
  // live endpoint names
  pe_ratio?:  number | null;
  pb_ratio?:  number | null;
  market_cap?: number | null;
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

interface AiSummary {
  ok:          boolean;
  source?:     string;
  summary:     string | null;
  score:       number | null;
  label:       string | null;
  analyzed_at: string | null;
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

function formatMarketCap(v: number | null | undefined): string {
  if (!v) return "—";
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)} mld`;
  if (v >= 1_000_000)     return `${(v / 1_000_000).toFixed(0)} mln`;
  return `${v}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConsensusChip({ label }: { label: string | null | undefined }) {
  if (!label) return <span className="text-gray-600">—</span>;
  const cls =
    label === "BUY"  ? "text-green-400"
    : label === "SELL" ? "text-red-400"
    : "text-yellow-400";
  return <span className={`font-bold ${cls}`}>{label}</span>;
}

function ScoreBar({ score, max = 10 }: { score: number | null | undefined; max?: number }) {
  if (score == null) return <span className="text-gray-600">—</span>;
  const pct  = Math.max(0, Math.min(100, (score / max) * 100));
  const cls  =
    score >= 7 ? "bg-green-500" :
    score >= 4 ? "bg-yellow-500" :
    "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono text-xs w-6 text-right ${cls.replace("bg-", "text-")}`}>
        {Number(score).toFixed(1)}
      </span>
    </div>
  );
}

function MetricRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-800/50 last:border-b-0">
      <span className="text-gray-500 text-xs">{label}</span>
      <div className="text-xs font-mono text-gray-200 text-right">{children}</div>
    </div>
  );
}

function GroupHeader({ title }: { title: string }) {
  return (
    <div className="text-[10px] font-bold text-gray-600 uppercase tracking-widest px-4 pt-3 pb-1">
      {title}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TerminalOverview({ ticker }: { ticker: string }) {
  const [data,    setData]    = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiData,  setAiData]  = useState<AiSummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/company/${ticker}`)
      .then(r => r.json())
      .then((d: CompanyData) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ticker]);

  // Load AI summary after main data
  useEffect(() => {
    setAiLoading(true);
    fetch(`/api/gen-summary?ticker=${ticker}`)
      .then(r => r.json())
      .then((d: AiSummary) => setAiData(d))
      .catch(() => {})
      .finally(() => setAiLoading(false));
  }, [ticker]);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-950 p-4 space-y-2 animate-pulse">
        <div className="h-4 bg-gray-800 rounded w-1/3" />
        <div className="h-3 bg-gray-800 rounded w-1/2" />
        <div className="h-px bg-gray-800 my-2" />
        <div className="grid grid-cols-3 gap-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-gray-800 rounded" />)}
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

  // Normalise multiples (snapshot uses `pe`, live uses `pe_ratio`)
  const pe      = mult?.pe        ?? mult?.pe_ratio   ?? null;
  const pb      = mult?.pb        ?? mult?.pb_ratio   ?? null;
  const evEbitda = mult?.ev_ebitda ?? null;
  const marketCap = mult?.market_cap ?? null;

  const chgPositive = chg != null && chg >= 0;
  const chgColor    = chg == null ? "text-gray-500" : chgPositive ? "text-green-400" : "text-red-400";

  const sentLabel = aiData?.label;
  const sentColor =
    sentLabel === "BULLISH"   ? "text-green-400 border-green-800/40 bg-green-900/10" :
    sentLabel === "BEARISH"   ? "text-red-400 border-red-800/40 bg-red-900/10"       :
    "text-yellow-400 border-yellow-800/40 bg-yellow-900/10";

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/80 overflow-hidden text-xs font-mono">

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
                {marketCap && (
                  <span className="text-gray-600">MCap: {formatMarketCap(marketCap)}</span>
                )}
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

      {/* ── 3-Column grouped KPIs ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-gray-800 border-b border-gray-800">

        {/* WYCENA */}
        <div>
          <GroupHeader title="Wycena" />
          <div className="px-4 pb-3">
            <MetricRow label="P/E">
              <span className="text-gray-200">{num(pe, 1)}</span>
            </MetricRow>
            <MetricRow label="EV/EBITDA">
              <span className="text-gray-200">{num(evEbitda, 1)}</span>
            </MetricRow>
            <MetricRow label="P/BV">
              <span className="text-gray-200">{num(pb, 2)}</span>
            </MetricRow>
          </div>
        </div>

        {/* KONDYCJA */}
        <div>
          <GroupHeader title="Kondycja" />
          <div className="px-4 pb-3">
            <MetricRow label="Health">
              <ScoreBar score={kpis?.health_score} />
            </MetricRow>
            <MetricRow label="MOAT">
              <ScoreBar score={kpis?.moat_score} />
            </MetricRow>
            <MetricRow label="Flags">
              <span className={kpis?.red_flags ? "text-red-400" : "text-green-400"}>
                {kpis?.red_flags != null ? (kpis.red_flags > 0 ? `⚠ ${kpis.red_flags}` : "✓ OK") : "—"}
              </span>
            </MetricRow>
          </div>
        </div>

        {/* KONSENSUS */}
        <div>
          <GroupHeader title="Konsensus" />
          <div className="px-4 pb-3">
            <MetricRow label="Rating">
              <ConsensusChip label={cons?.label} />
            </MetricRow>
            <MetricRow label="Cel cenowy">
              <span>
                {cons?.avg_target_price
                  ? `${Number(cons.avg_target_price).toFixed(0)} PLN`
                  : "—"}
                {cons?.upside_pct != null && (
                  <span className={cons.upside_pct >= 0 ? "text-green-400 ml-1" : "text-red-400 ml-1"}>
                    ({cons.upside_pct >= 0 ? "+" : ""}{Number(cons.upside_pct).toFixed(0)}%)
                  </span>
                )}
              </span>
            </MetricRow>
            <MetricRow label="EQ Score">
              <ScoreBar score={kpis?.earnings_quality} />
            </MetricRow>
          </div>
        </div>
      </div>

      {/* ── AI Summary block ── */}
      {(aiLoading || aiData?.summary) && (
        <div className={`px-4 py-3 border-b border-gray-800 ${aiData?.summary ? `rounded-none border ${sentColor} mx-0 my-0` : ""}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] text-gray-600 uppercase tracking-widest">AI Analiza</span>
            {aiData?.label && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${sentColor}`}>
                {aiData.label}
              </span>
            )}
            {aiData?.analyzed_at && (
              <span className="text-gray-700 text-[10px] ml-auto">{formatAge(aiData.analyzed_at)}</span>
            )}
          </div>
          {aiLoading && !aiData?.summary ? (
            <div className="h-3 bg-gray-800 rounded w-3/4 animate-pulse" />
          ) : (
            <p className="text-gray-300 text-[11px] leading-relaxed">{aiData?.summary}</p>
          )}
        </div>
      )}

      {/* ── Recent events ── */}
      {events.length > 0 && (
        <div className="px-4 py-2.5">
          <div className="text-[10px] text-gray-700 uppercase tracking-widest mb-1.5">Ostatnie eventy</div>
          <div className="space-y-1">
            {events.map((e, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px]">
                <span className="text-gray-700 shrink-0 mt-0.5">●</span>
                <span className="text-gray-300 flex-1 truncate">{e.title}</span>
                <span className="text-gray-600 shrink-0 whitespace-nowrap">
                  {e.event_type ?? "inne"}
                </span>
                {e.impact_score != null && (
                  <span className={`shrink-0 ${e.impact_score >= 7 ? "text-red-400" : e.impact_score >= 4 ? "text-yellow-400" : "text-gray-600"}`}>
                    ⚡{e.impact_score}
                  </span>
                )}
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
