"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LiveTimestamp }       from "./LiveTimestamp";

interface FinancialRow {
  period:     string;
  revenue:    number | null;
  net_income: number | null;
  ebitda:     number | null;
  eps:        number | null;
  net_debt:   number | null;
  currency:   string | null;
}

interface KpiData {
  value:         number | null;
  metadata:      Record<string, unknown> | null;
  calculated_at: string;
}

interface RedFlag {
  code:     string;
  name:     string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  detail:   string;
}

interface ApiResponse {
  financials:       FinancialRow[];
  health_score:     KpiData | null;
  red_flags:        KpiData | null;
  earnings_quality: KpiData | null;
}

/** Format large numbers: >1B → "1.2 mld", >1M → "123 mln", else as-is */
function fmt(value: number | null, currency = "PLN"): string {
  if (value === null || value === undefined) return "—";
  const abs  = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)} mld ${currency}`;
  if (abs >= 1_000_000)     return `${sign}${Math.round(abs / 1_000_000)} mln ${currency}`;
  if (abs >= 1_000)         return `${sign}${Math.round(abs / 1_000)} tys ${currency}`;
  return `${sign}${abs.toFixed(2)} ${currency}`;
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3">
      <div className="text-xs text-gray-500 font-medium mb-1">{label}</div>
      <div className="text-sm font-bold text-white tabular-nums">{value}</div>
    </div>
  );
}

function HealthScoreBadge({ score }: { score: number }) {
  const color =
    score >= 7 ? "bg-green-500/15 text-green-400 border-green-500/30"
    : score >= 4 ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
    : "bg-red-500/15 text-red-400 border-red-500/30";

  const label =
    score >= 7 ? "Dobra"
    : score >= 4 ? "Średnia"
    : "Słaba";

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold ${color}`}>
      {score.toFixed(1)}/10 — {label}
    </span>
  );
}

function SeverityDot({ severity }: { severity: "HIGH" | "MEDIUM" | "LOW" }) {
  const cls =
    severity === "HIGH"   ? "bg-red-500"
    : severity === "MEDIUM" ? "bg-yellow-500"
    : "bg-gray-500";
  return <span className={`inline-block w-2 h-2 rounded-full ${cls} flex-shrink-0 mt-0.5`} />;
}

export default function FinancialKpis({ ticker }: { ticker: string }) {
  const [data,      setData]      = useState<ApiResponse | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [analyzing, setAnalyzing] = useState(false);

  function load() {
    setLoading(true);
    fetch(`/api/company-kpis?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then((d: ApiResponse) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => { load(); }, [ticker]);

  async function handleAnalyze() {
    setAnalyzing(true);
    try {
      await fetch("/api/analyze", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ticker }),
      });
      load();
    } finally {
      setAnalyzing(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-6 text-center">
        <span className="text-gray-600 text-sm animate-pulse">Ładowanie danych…</span>
      </div>
    );
  }

  const rows       = data?.financials        ?? [];
  const healthData = data?.health_score      ?? null;
  const flagsData  = data?.red_flags         ?? null;
  const eqData     = data?.earnings_quality  ?? null;

  const hasFinancials  = rows.length > 0;
  const hasHealth      = healthData !== null && healthData.value !== null;
  const flagsList      = (flagsData?.metadata as { flags?: RedFlag[] } | null)?.flags ?? [];
  const flagsCount     = flagsData?.value ?? 0;
  const healthComment  = (healthData?.metadata as { comment?: string } | null)?.comment ?? "";
  const flagsSummary   = (flagsData?.metadata as { summary?: string } | null)?.summary ?? "";

  return (
    <div className="space-y-4">

      {/* ── Financial KPIs ─────────────────────────────────────────────── */}
      {hasFinancials ? (() => {
        const latest = rows[0];
        const cur    = latest.currency ?? "PLN";
        return (
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                Dane finansowe
                <LiveTimestamp date={healthData?.calculated_at} prefix="dane" />
              </h2>
              <span className="text-xs text-gray-600">{latest.period}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <KpiCard label="Przychody"  value={fmt(latest.revenue,    cur)} />
              <KpiCard label="Zysk netto" value={fmt(latest.net_income, cur)} />
              <KpiCard label="EBITDA"     value={fmt(latest.ebitda,     cur)} />
              <KpiCard label="EPS"        value={latest.eps !== null ? `${latest.eps.toFixed(2)} ${cur}` : "—"} />
              <KpiCard label="Dług netto" value={fmt(latest.net_debt,   cur)} />
              <KpiCard label="Okres"      value={latest.period} />
            </div>
          </div>
        );
      })() : (
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-6 py-6 text-center">
          <div className="text-gray-400 text-sm mb-3">
            📊 Brak danych finansowych. Wgraj raport PDF aby je uzupełnić.
          </div>
          <Link
            href="/upload"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
          >
            ↑ Wgraj PDF
          </Link>
        </div>
      )}

      {/* ── Ocena kondycji ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
            Ocena kondycji
          </h2>
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="text-xs px-2.5 py-1 rounded-md bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 transition-colors"
          >
            {analyzing ? "Liczę…" : "Przelicz"}
          </button>
        </div>

        {/* Health Score */}
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs text-gray-500 w-28 flex-shrink-0">Health Score</span>
          {hasHealth ? (
            <HealthScoreBadge score={healthData!.value!} />
          ) : (
            <span className="text-xs text-gray-600 italic">Brak — kliknij Przelicz</span>
          )}
        </div>

        {healthComment && (
          <p className="text-xs text-gray-400 italic mb-3 leading-relaxed">{healthComment}</p>
        )}

        {/* Red Flags */}
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xs text-gray-500 w-28 flex-shrink-0">Red Flags</span>
          {flagsData !== null ? (
            <span className={`text-xs font-bold ${flagsCount > 0 ? "text-red-400" : "text-green-400"}`}>
              {flagsCount > 0 ? `⚠️ ${flagsCount} sygnał${flagsCount === 1 ? "" : flagsCount < 5 ? "y" : "ów"}` : "✓ Brak"}
            </span>
          ) : (
            <span className="text-xs text-gray-600 italic">Brak — kliknij Przelicz</span>
          )}
        </div>

        {flagsList.length > 0 && (
          <ul className="space-y-1.5 mt-2 mb-3">
            {flagsList.map((f: RedFlag) => (
              <li key={f.code} className="flex items-start gap-2 text-xs text-gray-400">
                <SeverityDot severity={f.severity} />
                <span>
                  <span className="font-mono text-gray-500 mr-1">{f.code}</span>
                  <span className="font-medium text-gray-300">{f.name}</span>
                  {" — "}{f.detail}
                </span>
              </li>
            ))}
          </ul>
        )}

        {flagsSummary && flagsData !== null && (
          <p className="text-xs text-gray-400 italic leading-relaxed border-t border-gray-800 pt-3 mt-1">
            {flagsSummary}
          </p>
        )}

        {/* Earnings Quality badge */}
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-800">
          <span className="text-xs text-gray-500 w-28 flex-shrink-0">Earnings Quality</span>
          {eqData?.value != null ? (
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-bold ${
              eqData.value >= 7 ? "bg-green-500/15 text-green-400 border-green-500/30"
              : eqData.value >= 4 ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
              : "bg-red-500/15 text-red-400 border-red-500/30"
            }`}>
              EQ: {eqData.value.toFixed(1)}/10
            </span>
          ) : (
            <span className="text-xs text-gray-600 italic">Brak — kliknij Przelicz</span>
          )}
          {eqData?.metadata && (
            <span className="text-xs text-gray-500 italic truncate">
              {(eqData.metadata as { comment?: string }).comment}
            </span>
          )}
        </div>
      </div>

    </div>
  );
}
