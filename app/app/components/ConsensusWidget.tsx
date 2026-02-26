"use client";

import { useEffect, useState } from "react";
import { LiveTimestamp }       from "./LiveTimestamp";

interface ConsensusRow {
  institution:    string | null;
  analyst_name:   string | null;
  recommendation: string;
  price_target:   number | null;
  currency:       string | null;
  upside_pct:     number | null;
  published_at:   string | null;
  source_type:    string | null;
}

interface ConsensusData {
  ticker:  string;
  total:   number;
  buy:     number;
  hold:    number;
  sell:    number;
  neutral: number;
  avg_pt:  number | null;
  min_pt:  number | null;
  max_pt:  number | null;
  last_5:  ConsensusRow[];
}

function recColor(rec: string): string {
  const r = rec.toUpperCase();
  if (r === "BUY" || r === "OVERWEIGHT")       return "text-green-400";
  if (r === "SELL" || r === "UNDERWEIGHT")     return "text-red-400";
  return "text-yellow-400";
}

function recBg(rec: string): string {
  const r = rec.toUpperCase();
  if (r === "BUY" || r === "OVERWEIGHT")       return "bg-green-500";
  if (r === "SELL" || r === "UNDERWEIGHT")     return "bg-red-500";
  return "bg-yellow-500";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ConsensusWidget({ ticker }: { ticker: string }) {
  const [data,    setData]    = useState<ConsensusData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/consensus?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then((d: ConsensusData) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-5 py-8 text-center text-gray-600 text-sm animate-pulse">
        Ładowanie konsensusu…
      </div>
    );
  }

  if (!data || data.total === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-5 py-8 text-center text-gray-600 text-sm">
        Brak rekomendacji analityków (ostatnie 12 miesięcy)
      </div>
    );
  }

  const { total, buy, hold, sell, neutral, avg_pt, min_pt, max_pt, last_5 } = data;
  const buyPct     = Math.round((buy     / total) * 100);
  const holdPct    = Math.round((hold    / total) * 100);
  const sellPct    = Math.round((sell    / total) * 100);
  const neutralPct = Math.round((neutral / total) * 100);

  // Overall sentiment label
  const dominantRec =
    buy > hold && buy > sell ? "Kupuj" :
    sell > buy && sell > hold ? "Sprzedaj" :
    "Trzymaj";
  const dominantColor =
    dominantRec === "Kupuj" ? "text-green-400" :
    dominantRec === "Sprzedaj" ? "text-red-400" :
    "text-yellow-400";

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
        Konsensus analityków
        <LiveTimestamp date={last_5[0]?.published_at} prefix="ostatnia rekomendacja" />
      </h3>

      {/* Sentiment + PT summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3">
          <div className="text-xs text-gray-500 mb-1">Sentyment</div>
          <div className={`text-xl font-bold ${dominantColor}`}>{dominantRec}</div>
          <div className="text-xs text-gray-600 mt-0.5">{total} rekomendacji</div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3">
          <div className="text-xs text-gray-500 mb-1">Avg. cena docelowa</div>
          <div className="text-xl font-bold text-white tabular-nums">
            {avg_pt != null ? `${avg_pt} PLN` : "—"}
          </div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3">
          <div className="text-xs text-gray-500 mb-1">Min PT</div>
          <div className="text-lg font-semibold text-red-400 tabular-nums">
            {min_pt != null ? `${min_pt} PLN` : "—"}
          </div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3">
          <div className="text-xs text-gray-500 mb-1">Max PT</div>
          <div className="text-lg font-semibold text-green-400 tabular-nums">
            {max_pt != null ? `${max_pt} PLN` : "—"}
          </div>
        </div>
      </div>

      {/* Distribution bar */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-5 py-4">
        <div className="flex items-center gap-1 h-5 rounded-full overflow-hidden mb-3">
          {buyPct     > 0 && <div className="bg-green-500  h-full rounded-l-full" style={{ width: `${buyPct}%` }} />}
          {holdPct    > 0 && <div className="bg-yellow-500 h-full"                style={{ width: `${holdPct}%` }} />}
          {neutralPct > 0 && <div className="bg-gray-500   h-full"                style={{ width: `${neutralPct}%` }} />}
          {sellPct    > 0 && <div className="bg-red-500    h-full rounded-r-full" style={{ width: `${sellPct}%` }} />}
        </div>
        <div className="flex gap-4 text-xs text-gray-400 flex-wrap">
          {buy     > 0 && <span><span className="font-bold text-green-400">{buy}</span> Kupuj ({buyPct}%)</span>}
          {hold    > 0 && <span><span className="font-bold text-yellow-400">{hold}</span> Trzymaj ({holdPct}%)</span>}
          {neutral > 0 && <span><span className="font-bold text-gray-400">{neutral}</span> Neutralna ({neutralPct}%)</span>}
          {sell    > 0 && <span><span className="font-bold text-red-400">{sell}</span> Sprzedaj ({sellPct}%)</span>}
        </div>
      </div>

      {/* Last 5 recommendations */}
      {last_5.length > 0 && (
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-4 py-2 bg-gray-900/60 text-xs font-semibold text-gray-500 uppercase tracking-widest">
            Ostatnie rekomendacje
          </div>
          <div className="divide-y divide-gray-800/60">
            {last_5.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="w-28 shrink-0">
                  <span className={`font-bold text-xs ${recColor(r.recommendation)}`}>
                    {r.recommendation}
                  </span>
                </div>
                <div className="flex-1 min-w-0 text-gray-400 text-xs truncate">
                  {r.institution ?? "Nieznany DM"}
                  {r.analyst_name ? ` · ${r.analyst_name}` : ""}
                </div>
                <div className="text-xs text-white tabular-nums font-mono shrink-0">
                  {r.price_target != null ? `${r.price_target} ${r.currency ?? "PLN"}` : "—"}
                </div>
                {r.upside_pct != null && (
                  <div className={`text-xs tabular-nums shrink-0 ${r.upside_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {r.upside_pct > 0 ? "+" : ""}{r.upside_pct}%
                  </div>
                )}
                <div className="text-xs text-gray-600 shrink-0 w-20 text-right">
                  {fmtDate(r.published_at)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
