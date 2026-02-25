"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface FinancialRow {
  period:     string;
  revenue:    number | null;
  net_income: number | null;
  ebitda:     number | null;
  eps:        number | null;
  net_debt:   number | null;
  currency:   string | null;
}

/** Format large numbers: >1B → "1.2 mld", >1M → "123 mln", else as-is */
function fmt(value: number | null, currency = "PLN"): string {
  if (value === null || value === undefined) return "—";
  const abs = Math.abs(value);
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

export default function FinancialKpis({ ticker }: { ticker: string }) {
  const [rows,    setRows]    = useState<FinancialRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/company-kpis?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then((d: FinancialRow[]) => { setRows(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-6 text-center">
        <span className="text-gray-600 text-sm animate-pulse">Ładowanie danych…</span>
      </div>
    );
  }

  if (!rows.length) {
    return (
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
    );
  }

  const latest = rows[0];
  const cur    = latest.currency ?? "PLN";

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
          Dane finansowe
        </h2>
        <span className="text-xs text-gray-600">{latest.period}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <KpiCard label="Przychody"     value={fmt(latest.revenue,    cur)} />
        <KpiCard label="Zysk netto"    value={fmt(latest.net_income, cur)} />
        <KpiCard label="EBITDA"        value={fmt(latest.ebitda,     cur)} />
        <KpiCard label="EPS"           value={latest.eps !== null ? `${latest.eps.toFixed(2)} ${cur}` : "—"} />
        <KpiCard label="Dług netto"    value={fmt(latest.net_debt,   cur)} />
        <KpiCard label="Okres"         value={latest.period} />
      </div>
    </div>
  );
}
