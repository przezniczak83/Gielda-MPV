"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { LiveTimestamp } from "./LiveTimestamp";

interface PricePoint {
  date:   string;
  close:  number;
  volume: number | null;
}

interface DisplayPoint extends PricePoint {
  label: string;
}

// ─── Time ranges ─────────────────────────────────────────────────────────────

const RANGES = [
  { key: "1M",  label: "1M",  days: 30  },
  { key: "3M",  label: "3M",  days: 90  },
  { key: "6M",  label: "6M",  days: 180 },
  { key: "YTD", label: "YTD", ytd: true },
  { key: "1Y",  label: "1R",  days: 252 },
  { key: "3Y",  label: "3L",  days: 756 },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; dataKey: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const priceRow  = payload.find((p) => p.dataKey === "close");
  const volumeRow = payload.find((p) => p.dataKey === "volume");
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg">
      <div className="text-gray-400 mb-1">{label}</div>
      {priceRow && (
        <div className="text-white font-bold tabular-nums">
          {Number(priceRow.value).toFixed(2)} PLN
        </div>
      )}
      {volumeRow && volumeRow.value > 0 && (
        <div className="text-gray-400 tabular-nums mt-0.5">
          Vol: {volumeRow.value >= 1_000_000
            ? `${(volumeRow.value / 1_000_000).toFixed(1)}M`
            : volumeRow.value >= 1_000
            ? `${(volumeRow.value / 1_000).toFixed(0)}K`
            : String(volumeRow.value)}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PriceChart({ ticker }: { ticker: string }) {
  const [range,   setRange]   = useState<RangeKey>("3M");
  const [data,    setData]    = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const fetchData = useCallback((r: RangeKey) => {
    setLoading(true);
    setError(null);
    const rangeConf = RANGES.find((x) => x.key === r)!;
    const qs = "ytd" in rangeConf && rangeConf.ytd
      ? `ytd=1`
      : `days=${"days" in rangeConf ? rangeConf.days : 90}`;

    fetch(`/api/price-history?ticker=${encodeURIComponent(ticker)}&${qs}`)
      .then((res) => res.json())
      .then((d: PricePoint[]) => { setData(d); setLoading(false); })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  }, [ticker]);

  useEffect(() => { fetchData(range); }, [range, fetchData]);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="h-3 bg-gray-800 rounded w-24 animate-pulse" />
          <div className="flex gap-1">
            {RANGES.map((r) => <div key={r.key} className="w-8 h-6 bg-gray-800 rounded animate-pulse" />)}
          </div>
        </div>
        <div className="h-[180px] bg-gray-800/40 rounded animate-pulse" />
      </div>
    );
  }

  if (error || !data.length) {
    return (
      <div className="h-[220px] rounded-xl border border-gray-800 bg-gray-900/40 flex items-center justify-center">
        <span className="text-gray-600 text-sm">Brak danych cenowych</span>
      </div>
    );
  }

  // Format date labels based on range
  const displayData: DisplayPoint[] = data.map((d) => {
    let label: string;
    const dateStr = d.date.slice(0, 10);
    if (range === "1M") {
      label = dateStr.slice(5); // MM-DD
    } else if (range === "3M" || range === "YTD") {
      label = dateStr.slice(5); // MM-DD
    } else {
      label = dateStr.slice(2, 10); // YY-MM-DD
    }
    return { ...d, label };
  });

  const prices   = data.map((d) => Number(d.close)).filter(Boolean);
  const minPrice = Math.min(...prices) * 0.995;
  const maxPrice = Math.max(...prices) * 1.005;
  const volumes  = data.map((d) => Number(d.volume ?? 0));
  const maxVol   = Math.max(...volumes) || 1;

  const firstClose = prices[0];
  const lastClose  = prices[prices.length - 1];
  const perfPct    = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;
  const perfPositive = perfPct >= 0;
  const lineColor  = perfPositive ? "#22c55e" : "#ef4444";

  const lastPoint = data[data.length - 1];
  const isLive    = lastPoint
    ? (Date.now() - new Date(lastPoint.date).getTime()) < 48 * 3600_000
    : false;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 pt-4 pb-2">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {isLive && (
            <span className="flex items-center gap-1 text-xs text-green-400 font-mono">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              LIVE
            </span>
          )}
          <LiveTimestamp date={lastPoint?.date} prefix="ostatnia cena" staleAfter={86_400_000} />
          <span className={`text-xs font-bold tabular-nums ${perfPositive ? "text-green-400" : "text-red-400"}`}>
            {perfPositive ? "▲ +" : "▼ "}{Math.abs(perfPct).toFixed(2)}% ({range})
          </span>
        </div>

        {/* Time range buttons */}
        <div className="flex items-center gap-0.5 bg-gray-800/50 rounded-lg p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                range === r.key
                  ? "bg-gray-700 text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart: Price line + Volume bars (dual axis) */}
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={displayData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: "#6b7280", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          {/* Left Y axis: price */}
          <YAxis
            yAxisId="price"
            domain={[minPrice, maxPrice]}
            tick={{ fill: "#6b7280", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => v.toFixed(0)}
            width={44}
          />
          {/* Right Y axis: volume (hidden ticks) */}
          <YAxis
            yAxisId="volume"
            orientation="right"
            domain={[0, maxVol * 4]}
            tick={false}
            axisLine={false}
            width={0}
          />
          <Tooltip content={<CustomTooltip />} />
          {/* Volume bars (behind price line) */}
          <Bar
            yAxisId="volume"
            dataKey="volume"
            fill="#374151"
            opacity={0.6}
            radius={[1, 1, 0, 0]}
          />
          {/* Price line */}
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="close"
            stroke={lineColor}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: lineColor, stroke: "#111827" }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
