"use client";

import { useEffect, useState, useRef } from "react";

interface HeatmapData {
  tickers:       string[];
  matrix:        (number | null)[][];
  labels:        Record<string, string>;
  risk_clusters: { a: string; b: string; corr: number }[];
  diversifiers:  { a: string; b: string; corr: number }[];
  computed_at:   string | null;
  error?:        string;
}

function corrToColor(c: number | null): string {
  if (c === null) return "bg-gray-800";
  if (c >= 0.9)  return "bg-green-700";
  if (c >= 0.7)  return "bg-green-600";
  if (c >= 0.5)  return "bg-green-500/70";
  if (c >= 0.3)  return "bg-emerald-600/50";
  if (c >= 0.1)  return "bg-gray-600";
  if (c >= -0.1) return "bg-gray-700";
  if (c >= -0.3) return "bg-orange-700/60";
  if (c >= -0.5) return "bg-red-600/60";
  return "bg-red-700";
}

function corrToText(c: number | null): string {
  if (c === null) return "text-gray-600";
  if (c >= 0.5)  return "text-green-200";
  if (c <= -0.3) return "text-red-200";
  return "text-gray-300";
}

function formatAge(iso: string | null): string {
  if (!iso) return "";
  const hrs = Math.floor((Date.now() - new Date(iso).getTime()) / 3600_000);
  if (hrs < 1)   return "< 1h temu";
  if (hrs < 24)  return `${hrs}h temu`;
  return `${Math.floor(hrs / 24)}d temu`;
}

export default function CorrelationMatrix({ customTickers }: { customTickers?: string[] }) {
  const [data, setData]       = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const containerRef          = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const qs = customTickers ? `?tickers=${customTickers.join(",")}` : "";
    fetch(`/api/heatmap${qs}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [customTickers]);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-6 animate-pulse">
        <div className="h-4 bg-gray-800 rounded w-1/4 mb-4" />
        <div className="grid grid-cols-10 gap-1">
          {Array.from({ length: 100 }).map((_, i) => (
            <div key={i} className="aspect-square bg-gray-800 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-8 text-center text-gray-500">
        Brak danych korelacji. Dane obliczane są cyklicznie.
      </div>
    );
  }

  const { tickers, matrix, labels } = data;
  const n = tickers.length;

  if (n === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-8 text-center text-gray-500">
        Brak danych korelacji
      </div>
    );
  }

  const cellSize = Math.max(24, Math.min(40, Math.floor(560 / n)));

  return (
    <div ref={containerRef} className="relative">
      {/* Legend */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-xs text-gray-500">Korelacja:</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-red-700" />
          <span className="text-xs text-gray-500">−1.0</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-gray-700" />
          <span className="text-xs text-gray-500">0</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-600" />
          <span className="text-xs text-gray-500">+1.0</span>
        </div>
        {data.computed_at && (
          <span className="text-xs text-gray-700 ml-auto">
            Obliczono: {formatAge(data.computed_at)}
          </span>
        )}
      </div>

      {/* Matrix */}
      <div className="overflow-auto">
        <div style={{ display: "grid", gridTemplateColumns: `${cellSize * 1.5}px repeat(${n}, ${cellSize}px)`, gap: 2, width: "max-content" }}>

          {/* Empty top-left corner */}
          <div />

          {/* Column headers */}
          {tickers.map((t) => (
            <div
              key={t}
              title={labels[t] ?? t}
              style={{ height: cellSize * 1.5, fontSize: 10, writingMode: "vertical-rl", textOrientation: "mixed", transform: "rotate(180deg)" }}
              className="flex items-center justify-center text-gray-400 font-mono font-bold overflow-hidden"
            >
              {t}
            </div>
          ))}

          {/* Rows */}
          {tickers.map((rowTicker, i) => (
            <>
              {/* Row label */}
              <div
                key={`label-${rowTicker}`}
                style={{ height: cellSize, fontSize: 10 }}
                className="flex items-center justify-end pr-1.5 text-gray-400 font-mono font-bold"
              >
                {rowTicker}
              </div>

              {/* Cells */}
              {tickers.map((colTicker, j) => {
                const val = matrix[i]?.[j] ?? null;
                const isDiag = i === j;
                return (
                  <div
                    key={`cell-${i}-${j}`}
                    style={{ width: cellSize, height: cellSize, fontSize: 9 }}
                    className={`rounded flex items-center justify-center cursor-default transition-opacity hover:opacity-80 ${corrToColor(val)} ${corrToText(val)} ${isDiag ? "opacity-40" : ""}`}
                    onMouseEnter={(e) => {
                      const rect = (e.target as HTMLElement).getBoundingClientRect();
                      const containerRect = containerRef.current?.getBoundingClientRect() ?? rect;
                      setTooltip({
                        text: `${rowTicker} ↔ ${colTicker}: ${val !== null ? val.toFixed(3) : "—"}`,
                        x: rect.left - containerRect.left + cellSize / 2,
                        y: rect.top  - containerRect.top  - 28,
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  >
                    {val !== null && !isDiag && cellSize >= 28 ? (
                      <span className="tabular-nums">{val.toFixed(2)}</span>
                    ) : isDiag ? (
                      <span>—</span>
                    ) : null}
                  </div>
                );
              })}
            </>
          ))}
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-gray-800 border border-gray-700 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap z-50"
          style={{ left: tooltip.x, top: tooltip.y, transform: "translateX(-50%)" }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
