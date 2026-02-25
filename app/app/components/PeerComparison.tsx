"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface PeerMember {
  ticker:       string;
  name:         string | null;
  sector:       string | null;
  price:        number | null;
  pe_ratio:     number | null;
  ev_ebitda:    number | null;
  market_cap:   number | null;
  health_score: number | null;
  is_primary:   boolean;
}

interface PeerData {
  group:   { id: number; name: string | null; sector: string | null } | null;
  members: PeerMember[];
}

type SortKey = "ticker" | "price" | "pe_ratio" | "ev_ebitda" | "market_cap" | "health_score";

function fmtM(val: number | null): string {
  if (val == null) return "—";
  return `${(val / 1e6).toFixed(0)} M`;
}

function fmtNum(val: number | null, dec = 1): string {
  if (val == null) return "—";
  return val.toFixed(dec);
}

function scoreColor(val: number | null): string {
  if (val == null) return "text-gray-500";
  return val >= 7 ? "text-green-400" : val >= 4 ? "text-yellow-400" : "text-red-400";
}

export default function PeerComparison({ ticker }: { ticker: string }) {
  const [data,    setData]    = useState<PeerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("ticker");
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/peers?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then((d: PeerData) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-6 text-center text-gray-600 text-sm animate-pulse">
        Ładowanie grupy porównawczej…
      </div>
    );
  }

  if (!data || !data.group || data.members.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-6 text-center text-gray-500 text-sm">
        Brak grupy porównawczej dla tej spółki
      </div>
    );
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  }

  const sorted = [...data.members].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string" && typeof bv === "string") {
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  const cols: { key: SortKey; label: string }[] = [
    { key: "ticker",       label: "Ticker" },
    { key: "price",        label: "Cena" },
    { key: "pe_ratio",     label: "P/E" },
    { key: "ev_ebitda",    label: "EV/EBITDA" },
    { key: "market_cap",   label: "Market Cap" },
    { key: "health_score", label: "Health" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
          Porównanie sektorowe
        </h3>
        <span className="text-xs text-gray-600">— {data.group.name}</span>
      </div>

      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-900/60">
            <tr>
              {cols.map(col => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-widest cursor-pointer hover:text-gray-300 transition-colors select-none ${col.key === "ticker" ? "text-left" : "text-right"}`}
                >
                  {col.label}
                  {sortKey === col.key && (
                    <span className="ml-1 text-blue-400">{sortAsc ? "↑" : "↓"}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {sorted.map(m => {
              const isActive = m.ticker === ticker;
              return (
                <tr
                  key={m.ticker}
                  className={`transition-colors ${isActive ? "bg-blue-500/10" : "hover:bg-gray-900/40"}`}
                >
                  <td className="px-4 py-3">
                    <Link href={`/companies/${m.ticker}`}
                      className={`font-mono font-bold hover:text-blue-400 transition-colors ${isActive ? "text-blue-300" : "text-white"}`}>
                      {m.ticker}
                    </Link>
                    {m.name && (
                      <div className="text-xs text-gray-500 truncate max-w-[120px]">{m.name}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-mono text-gray-300">
                    {m.price != null ? `${m.price.toFixed(2)} PLN` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-300">{fmtNum(m.pe_ratio)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-300">{fmtNum(m.ev_ebitda)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-400 text-xs">{fmtM(m.market_cap)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums font-semibold ${scoreColor(m.health_score)}`}>
                    {m.health_score != null ? `${m.health_score.toFixed(1)}/10` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
