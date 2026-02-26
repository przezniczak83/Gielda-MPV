"use client";

import { useEffect, useState } from "react";

interface CorrRow {
  ticker_b:    string;
  correlation: number;
  sample_size: number;
  computed_at: string | null;
}

function corrColor(r: number): string {
  if (r >= 0.7)  return "text-green-400";
  if (r >= 0.4)  return "text-green-600";
  if (r >= 0.2)  return "text-gray-400";
  if (r >= -0.2) return "text-gray-500";
  if (r >= -0.4) return "text-orange-500";
  return "text-red-400";
}

function corrBar(r: number) {
  const pct = Math.round(Math.abs(r) * 100);
  const color = r >= 0 ? "bg-green-500/40" : "bg-red-500/40";
  return (
    <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden inline-block">
      <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function formatAgo(iso: string | null): string {
  if (!iso) return "";
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 24) return `${h}h temu`;
  return `${Math.round(h / 24)}d temu`;
}

export default function CorrelationWidget({ ticker }: { ticker: string }) {
  const [rows,    setRows]    = useState<CorrRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/correlations?ticker=${ticker}`)
      .then(r => r.json())
      .then((d: CorrRow[] | { error: string }) => {
        if (Array.isArray(d)) {
          setRows(d);
          if (d.length === 0) setPending(true); // computation triggered
        }
      })
      .catch(() => { /* ignore */ })
      .finally(() => setLoading(false));
  }, [ticker]);

  const positive = rows.filter(r => r.correlation > 0).slice(0, 8);
  const negative = rows.filter(r => r.correlation < 0).slice(0, 5);
  const computedAt = rows[0]?.computed_at ?? null;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/30 px-5 py-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-300">Korelacje cenowe (90 dni)</h3>
        {computedAt && (
          <span className="text-[10px] text-gray-600">{formatAgo(computedAt)}</span>
        )}
      </div>

      {loading ? (
        <div className="h-24 bg-gray-800/50 animate-pulse rounded-lg" />
      ) : pending ? (
        <div className="py-6 text-center text-gray-600 text-sm">
          Trwa obliczanie korelacji… odśwież za chwilę.
        </div>
      ) : rows.length === 0 ? (
        <div className="py-4 text-center text-gray-600 text-sm">
          Brak danych do obliczeń korelacji.
        </div>
      ) : (
        <div className="space-y-4">
          {positive.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-2">
                Silna korelacja
              </div>
              <div className="space-y-1.5">
                {positive.map(row => (
                  <a
                    key={row.ticker_b}
                    href={`/companies/${row.ticker_b}`}
                    className="flex items-center gap-3 group hover:bg-gray-800/40 px-2 py-1 rounded-md transition-colors"
                  >
                    <span className="font-mono font-bold text-xs text-white w-12 shrink-0 group-hover:text-blue-400 transition-colors">
                      {row.ticker_b}
                    </span>
                    {corrBar(row.correlation)}
                    <span className={`tabular-nums text-xs font-bold w-12 text-right ${corrColor(row.correlation)}`}>
                      {row.correlation > 0 ? "+" : ""}{(row.correlation * 100).toFixed(0)}%
                    </span>
                    <span className="text-[10px] text-gray-700">{row.sample_size}d</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {negative.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-2">
                Antykorelacja
              </div>
              <div className="space-y-1.5">
                {negative.map(row => (
                  <a
                    key={row.ticker_b}
                    href={`/companies/${row.ticker_b}`}
                    className="flex items-center gap-3 group hover:bg-gray-800/40 px-2 py-1 rounded-md transition-colors"
                  >
                    <span className="font-mono font-bold text-xs text-white w-12 shrink-0 group-hover:text-blue-400 transition-colors">
                      {row.ticker_b}
                    </span>
                    {corrBar(row.correlation)}
                    <span className={`tabular-nums text-xs font-bold w-12 text-right ${corrColor(row.correlation)}`}>
                      {(row.correlation * 100).toFixed(0)}%
                    </span>
                    <span className="text-[10px] text-gray-700">{row.sample_size}d</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-gray-700">
            Pearson r na dziennych log-stopach zwrotu. |r| ≥ 0.7 = silna, ≤ −0.4 = anty.
          </p>
        </div>
      )}
    </div>
  );
}
