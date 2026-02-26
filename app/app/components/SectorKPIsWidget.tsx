"use client";
// app/app/components/SectorKPIsWidget.tsx
// Client-side widget: displays sector-specific KPIs fetched from /api/sector-kpis.

import { useEffect, useState } from "react";

interface SectorKPI {
  kpi_code:   string;
  kpi_name:   string;
  value:      number | null;
  prev_value: number | null;
  change_pct: number | null;
  unit:       string;
  period:     string | null;
}

function ArrowBadge({ change }: { change: number | null }) {
  if (change === null) return null;
  const cls = change >= 0 ? "text-green-400" : "text-red-400";
  return (
    <span className={`text-xs font-mono ${cls}`}>
      {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
    </span>
  );
}

function KpiCard({ kpi }: { kpi: SectorKPI }) {
  const valStr = kpi.value != null
    ? `${Number(kpi.value).toFixed(2)} ${kpi.unit}`
    : "N/A";

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3">
      <div className="text-xs text-gray-500 mb-1 flex justify-between">
        <span>{kpi.kpi_name}</span>
        {kpi.period && <span className="text-gray-700 font-mono text-[10px]">{kpi.period}</span>}
      </div>
      <div className="text-xl font-bold text-white font-mono">{valStr}</div>
      {kpi.change_pct != null && (
        <div className="mt-0.5">
          <ArrowBadge change={kpi.change_pct} />
        </div>
      )}
    </div>
  );
}

export default function SectorKPIsWidget({
  ticker,
  sector,
}: {
  ticker: string;
  sector?: string | null;
}) {
  const [kpis,    setKpis]    = useState<SectorKPI[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/sector-kpis?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then((d: SectorKPI[]) => { setKpis(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return <div className="h-32 bg-gray-800 animate-pulse rounded-xl" />;
  }

  if (kpis.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800/50 border-dashed px-5 py-6 text-center">
        <p className="text-sm text-gray-500">Brak sektorowych KPI{sector ? ` dla sektora ${sector}` : ""}.</p>
        <p className="text-xs text-gray-700 mt-1">
          Uruchom <code className="bg-gray-800 px-1 rounded">extract-sector-kpis</code> aby pobrać dane.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
        KPI Sektorowe{sector ? ` — ${sector}` : ""}
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {kpis.map(kpi => (
          <KpiCard key={kpi.kpi_code} kpi={kpi} />
        ))}
      </div>
    </div>
  );
}
