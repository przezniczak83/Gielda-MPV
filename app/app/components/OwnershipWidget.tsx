"use client";

import { useEffect, useState } from "react";

interface OwnershipRow {
  institution_name: string;
  shares_held:      number | null;
  ownership_pct:    number | null;
  change_pct:       number | null;
  report_date:      string;
  source:           string | null;
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("pl-PL", { day: "2-digit", month: "short", year: "numeric" });
}

export default function OwnershipWidget({ ticker }: { ticker: string }) {
  const [rows,    setRows]    = useState<OwnershipRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/ownership?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then((d: OwnershipRow[]) => { setRows(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-4 text-center text-gray-600 text-xs animate-pulse">
        Ładowanie akcjonariatu…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-4 text-center text-gray-600 text-xs">
        Brak danych o akcjonariacie instytucjonalnym
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
        Akcjonariat instytucjonalny
      </h4>
      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-gray-900/60">
            <tr>
              <th className="text-left px-4 py-2.5 text-gray-500 font-semibold uppercase tracking-wider">Instytucja</th>
              <th className="text-right px-4 py-2.5 text-gray-500 font-semibold uppercase tracking-wider">Udział %</th>
              <th className="text-right px-4 py-2.5 text-gray-500 font-semibold uppercase tracking-wider">Zmiana</th>
              <th className="text-right px-4 py-2.5 text-gray-500 font-semibold uppercase tracking-wider">Data</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {rows.slice(0, 5).map((r, i) => {
              const changeColor = r.change_pct == null ? "text-gray-500"
                : r.change_pct > 0 ? "text-green-400" : "text-red-400";
              const changeArrow = r.change_pct == null ? "" : r.change_pct > 0 ? "↑" : "↓";
              return (
                <tr key={i} className="hover:bg-gray-900/40 transition-colors">
                  <td className="px-4 py-2.5 text-gray-300 max-w-[160px] truncate">{r.institution_name}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-white font-semibold">
                    {r.ownership_pct != null ? `${r.ownership_pct.toFixed(2)}%` : "—"}
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${changeColor}`}>
                    {r.change_pct != null
                      ? `${changeArrow} ${Math.abs(r.change_pct).toFixed(2)}pp`
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-500">{fmtDate(r.report_date)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
