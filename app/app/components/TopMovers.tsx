"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Mover {
  ticker:    string;
  name:      string;
  price:     string;
  changePct: string;
}

interface TopMoversData {
  gainers: Mover[];
  losers:  Mover[];
}

export default function TopMovers() {
  const [data, setData]     = useState<TopMoversData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/top-movers")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<TopMoversData>;
      })
      .then((d) => {
        // Ensure expected shape
        setData({
          gainers: Array.isArray(d?.gainers) ? d.gainers : [],
          losers:  Array.isArray(d?.losers)  ? d.losers  : [],
        });
        setLoading(false);
      })
      .catch(() => {
        setData({ gainers: [], losers: [] });
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 animate-pulse h-48" />
    );
  }

  const noData = !data || ((data.gainers?.length ?? 0) === 0 && (data.losers?.length ?? 0) === 0);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
        Top Movers (dziś)
      </h2>
      {noData ? (
        <div className="text-center text-gray-500 text-sm py-6">Brak danych</div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {/* Gainers */}
          <div>
            <div className="text-xs text-emerald-500 font-semibold mb-2">▲ Liderzy wzrostów</div>
            <div className="flex flex-col gap-1.5">
              {data!.gainers.map((m) => (
                <Link
                  key={m.ticker}
                  href={`/companies/${m.ticker}`}
                  className="flex items-center justify-between rounded-lg bg-emerald-900/10 border border-emerald-800/20 px-3 py-2 hover:bg-emerald-900/20 transition-colors"
                >
                  <div>
                    <span className="font-mono font-bold text-white text-xs">{m.ticker}</span>
                    <div className="text-gray-500 text-xs truncate max-w-[80px]">{m.price} PLN</div>
                  </div>
                  <span className="text-emerald-400 font-bold text-sm tabular-nums">
                    +{m.changePct}%
                  </span>
                </Link>
              ))}
            </div>
          </div>

          {/* Losers */}
          <div>
            <div className="text-xs text-red-500 font-semibold mb-2">▼ Największe spadki</div>
            <div className="flex flex-col gap-1.5">
              {data!.losers.map((m) => (
                <Link
                  key={m.ticker}
                  href={`/companies/${m.ticker}`}
                  className="flex items-center justify-between rounded-lg bg-red-900/10 border border-red-800/20 px-3 py-2 hover:bg-red-900/20 transition-colors"
                >
                  <div>
                    <span className="font-mono font-bold text-white text-xs">{m.ticker}</span>
                    <div className="text-gray-500 text-xs truncate max-w-[80px]">{m.price} PLN</div>
                  </div>
                  <span className="text-red-400 font-bold text-sm tabular-nums">
                    {m.changePct}%
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
