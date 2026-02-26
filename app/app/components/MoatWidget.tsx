"use client";

import { useEffect, useState } from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip,
} from "recharts";
import { LiveTimestamp } from "./LiveTimestamp";

// Sectors eligible for MOAT display
const TECH_SECTORS = new Set([
  "Technology", "Gaming", "E-commerce", "Fintech",
  "SaaS", "Streaming", "Data/Cloud", "AI/Defense",
  "Semiconductors", "Enterprise", "Tech",
]);

interface Dimension {
  score:     number;
  rationale: string;
}

interface MoatMetadata {
  dimensions: {
    d1_network_effects:   Dimension;
    d2_switching_costs:   Dimension;
    d3_cost_advantages:   Dimension;
    d4_intangible_assets: Dimension;
    d5_efficient_scale:   Dimension;
    d6_ai_disruption_risk:Dimension;
    d7_data_moat:         Dimension;
  };
  moat_strength: "WIDE" | "NARROW" | "NONE";
  summary:       string;
}

interface KpiRow {
  value:         number | null;
  metadata:      MoatMetadata | null;
  calculated_at: string | null;
}

interface ApiResponse {
  moat_score: KpiRow | null;
}

const DIM_LABELS: Array<{ key: keyof MoatMetadata["dimensions"]; short: string; full: string }> = [
  { key: "d1_network_effects",   short: "Network",     full: "Network Effects" },
  { key: "d2_switching_costs",   short: "Switching",   full: "Switching Costs" },
  { key: "d3_cost_advantages",   short: "Cost Adv.",   full: "Cost Advantages" },
  { key: "d4_intangible_assets", short: "Intangible",  full: "Intangible Assets" },
  { key: "d5_efficient_scale",   short: "Scale",       full: "Efficient Scale" },
  { key: "d6_ai_disruption_risk",short: "AI Safety",   full: "AI Disruption Risk (odwrócona)" },
  { key: "d7_data_moat",         short: "Data",        full: "Data Moat" },
];

function MoatBadge({ strength }: { strength: "WIDE" | "NARROW" | "NONE" }) {
  const cls =
    strength === "WIDE"   ? "bg-green-500/15  text-green-400  border border-green-500/30" :
    strength === "NARROW" ? "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30" :
                            "bg-red-500/15    text-red-400    border border-red-500/30";
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full ${cls}`}>
      {strength === "WIDE" ? "🏰" : strength === "NARROW" ? "🪨" : "🕳️"} {strength} MOAT
    </span>
  );
}

export default function MoatWidget({ ticker, sector }: { ticker: string; sector?: string | null }) {
  const [data, setData] = useState<ApiResponse | null>(null);

  function load() {
    fetch(`/api/company-kpis?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then((d: ApiResponse) => setData(d))
      .catch(() => {});
  }

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener("kpis-refreshed", handler);
    return () => window.removeEventListener("kpis-refreshed", handler);
  }, [ticker]);

  // Only render for tech sectors
  if (sector && !TECH_SECTORS.has(sector)) return null;

  const kpi  = data?.moat_score;
  const meta = kpi?.metadata;
  const dims = meta?.dimensions;

  if (!data) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-5 py-8 text-center text-gray-600 text-sm animate-pulse">
        Ładowanie MOAT…
      </div>
    );
  }

  if (!kpi || !dims) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-5 py-6">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
          MOAT Analysis
        </h3>
        <p className="text-sm text-gray-600 italic">
          Brak danych — kliknij „↻ Odśwież dane" aby uruchomić analizę.
        </p>
      </div>
    );
  }

  const radarData = DIM_LABELS.map(d => ({
    dimension: d.short,
    score:     dims[d.key]?.score ?? 5,
    fullName:  d.full,
  }));

  const overall        = kpi.value ?? 0;
  const moat_strength  = meta?.moat_strength ?? "NONE";
  const summary        = meta?.summary ?? "";

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-5 py-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
          MOAT-7 Analysis
          <LiveTimestamp date={kpi?.calculated_at} prefix="analiza" />
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-white tabular-nums">
            {overall.toFixed(1)}<span className="text-gray-500 text-sm font-normal">/10</span>
          </span>
          <MoatBadge strength={moat_strength} />
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <p className="text-xs text-gray-400 italic mb-4 leading-relaxed">{summary}</p>
      )}

      {/* Radar Chart */}
      <div className="mb-5" style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={radarData} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
            <PolarGrid stroke="#1f2937" />
            <PolarAngleAxis
              dataKey="dimension"
              tick={{ fill: "#6b7280", fontSize: 10 }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 10]}
              tick={{ fill: "#4b5563", fontSize: 9 }}
              tickCount={3}
            />
            <Radar
              name="MOAT Score"
              dataKey="score"
              stroke="#3b82f6"
              fill="#3b82f6"
              fillOpacity={0.15}
              strokeWidth={2}
            />
            <Tooltip
              contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
              formatter={(val: number | undefined) => [`${val ?? 0}/10`, "Score"] as [string, string]}
              labelFormatter={(label) => {
                const found = radarData.find(d => d.dimension === String(label));
                return found?.fullName ?? String(label);
              }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Dimension details */}
      <div className="space-y-2">
        {DIM_LABELS.map(d => {
          const dim = dims[d.key];
          const score = dim?.score ?? 5;
          const scoreColor =
            score >= 8 ? "text-green-400" :
            score >= 5 ? "text-yellow-400" :
                         "text-red-400";

          return (
            <div key={d.key} className="flex items-start gap-3">
              <span className={`text-sm font-bold tabular-nums w-8 shrink-0 ${scoreColor}`}>
                {score}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold text-gray-400">{d.full}</span>
                {dim?.rationale && (
                  <span className="text-xs text-gray-600 ml-2">{dim.rationale}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
