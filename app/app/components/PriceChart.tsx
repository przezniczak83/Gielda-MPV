"use client";

import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { LiveTimestamp } from "./LiveTimestamp";

interface PricePoint {
  date:   string;
  close:  number;
  volume: number | null;
}

interface TooltipPayload {
  value: number;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg">
      <div className="text-gray-400 mb-0.5">{label}</div>
      <div className="text-white font-bold tabular-nums">
        {Number(payload[0].value).toFixed(2)} PLN
      </div>
    </div>
  );
}

export default function PriceChart({ ticker }: { ticker: string }) {
  const [data,    setData]    = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/price-history?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then((d: PricePoint[]) => { setData(d); setLoading(false); })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, [ticker]);

  if (loading) {
    return (
      <div className="h-[180px] rounded-xl border border-gray-800 bg-gray-900/40 flex items-center justify-center">
        <span className="text-gray-600 text-sm animate-pulse">Ładowanie wykresu…</span>
      </div>
    );
  }

  if (error || !data.length) {
    return (
      <div className="h-[180px] rounded-xl border border-gray-800 bg-gray-900/40 flex items-center justify-center">
        <span className="text-gray-600 text-sm">Brak danych cenowych</span>
      </div>
    );
  }

  // Trim date labels to MM-DD for readability
  const displayData = data.map(d => ({
    ...d,
    label: d.date.slice(5), // "MM-DD"
  }));

  const prices   = data.map(d => Number(d.close)).filter(Boolean);
  const minPrice = Math.min(...prices) * 0.995;
  const maxPrice = Math.max(...prices) * 1.005;

  const lastPoint = data[data.length - 1];
  const isLive    = lastPoint
    ? (Date.now() - new Date(lastPoint.date).getTime()) < 48 * 3600_000
    : false;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 pt-4 pb-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isLive && (
            <span className="flex items-center gap-1 text-xs text-green-400 font-mono">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              LIVE
            </span>
          )}
          <LiveTimestamp date={lastPoint?.date} prefix="ostatnia cena" staleAfter={86_400_000} />
        </div>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={displayData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "#6b7280", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[minPrice, maxPrice]}
            tick={{ fill: "#6b7280", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => v.toFixed(0)}
            width={40}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="close"
            stroke="#22c55e"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "#22c55e", stroke: "#14532d" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
