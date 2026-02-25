"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

// ── Lazy-loaded heavy components ─────────────────────────────────────────────

const PriceChart = dynamic(
  () => import("./PriceChart"),
  {
    loading: () => <div className="h-[180px] bg-gray-800 animate-pulse rounded-xl" />,
    ssr:     false,
  },
);

const FinancialKpis = dynamic(
  () => import("./FinancialKpis"),
  {
    loading: () => <div className="h-48 bg-gray-800 animate-pulse rounded-xl" />,
    ssr:     false,
  },
);

const MoatWidget = dynamic(
  () => import("./MoatWidget"),
  {
    loading: () => <div className="h-32 bg-gray-800 animate-pulse rounded-xl" />,
    ssr:     false,
  },
);

const ForecastWidget = dynamic(
  () => import("./ForecastWidget"),
  {
    loading: () => <div className="h-32 bg-gray-800 animate-pulse rounded-xl" />,
    ssr:     false,
  },
);

const ConsensusWidget = dynamic(
  () => import("./ConsensusWidget"),
  {
    loading: () => <div className="h-24 bg-gray-800 animate-pulse rounded-xl" />,
    ssr:     false,
  },
);

const PeerComparison = dynamic(
  () => import("./PeerComparison"),
  {
    loading: () => <div className="h-32 bg-gray-800 animate-pulse rounded-xl" />,
    ssr:     false,
  },
);

const OwnershipWidget = dynamic(
  () => import("./OwnershipWidget"),
  {
    loading: () => <div className="h-24 bg-gray-800 animate-pulse rounded-xl" />,
    ssr:     false,
  },
);

const AiChat = dynamic(
  () => import("./AiChat"),
  {
    loading: () => <div className="h-48 bg-gray-800 animate-pulse rounded-xl" />,
    ssr:     false,
  },
);

// ── Types (mirror server page.tsx) ─────────────────────────────────────────

type Event = {
  id:           string;
  title:        string;
  event_type:   string | null;
  impact_score: number | null;
  published_at: string | null;
  url:          string | null;
};

type LatestPrice = {
  close: number;
  date:  string;
} | null;

// ── Small helpers ───────────────────────────────────────────────────────────

function ImpactBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-gray-600 text-xs">—</span>;
  const cls =
    score >= 7 ? "bg-red-500/15 text-red-400 border border-red-500/25"
    : score >= 4 ? "bg-yellow-500/15 text-yellow-400 border border-yellow-500/25"
    : "bg-gray-500/15 text-gray-400 border border-gray-500/25";
  return (
    <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${cls}`}>
      {score}
    </span>
  );
}

function EventTypeBadge({ type }: { type: string | null }) {
  const labels: Record<string, string> = {
    earnings: "Wyniki", dividend: "Dywidenda", regulatory: "Regulacje", other: "Inne",
  };
  return (
    <span className="inline-block text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 font-medium whitespace-nowrap">
      {type ? (labels[type] ?? type) : "—"}
    </span>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Tab definitions ─────────────────────────────────────────────────────────

const TABS = ["Przegląd", "Finanse", "Eventy", "AI Chat"] as const;
type Tab = typeof TABS[number];

// ── Main component ──────────────────────────────────────────────────────────

export default function CompanyTabs({
  ticker,
  sector,
  events,
  latestPrice,
}: {
  ticker:       string;
  sector?:      string | null;
  events:       Event[];
  latestPrice:  LatestPrice;
}) {
  const [activeTab,  setActiveTab]  = useState<Tab>("Przegląd");
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await fetch("/api/analyze", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ticker }),
      });
      setLastRefresh(new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }));
      window.dispatchEvent(new CustomEvent("kpis-refreshed", { detail: { ticker } }));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div>
      {/* Price bar + Refresh */}
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-5 py-4 inline-flex items-baseline gap-3">
          <span className="text-xs text-gray-500 font-medium">Ostatnia cena</span>
          {latestPrice ? (
            <>
              <span className="text-2xl font-bold text-white tabular-nums">
                {Number(latestPrice.close).toFixed(2)} PLN
              </span>
              <span className="text-xs text-gray-500">{latestPrice.date}</span>
            </>
          ) : (
            <span className="text-gray-600 text-sm">Brak danych</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-xs text-gray-600">Odświeżono {lastRefresh}</span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 transition-colors font-medium"
          >
            {refreshing ? "↻ Liczę…" : "↻ Odśwież dane"}
          </button>
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 mb-6 border-b border-gray-800 pb-0">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors -mb-px border-b-2 ${
              activeTab === tab
                ? "text-white border-blue-500 bg-gray-900/40"
                : "text-gray-500 border-transparent hover:text-gray-300 hover:border-gray-600"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {activeTab === "Przegląd" && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
              Wykres cen (30 dni)
            </h2>
            <PriceChart ticker={ticker} />
          </div>
          <HealthOverview ticker={ticker} />
          <OwnershipWidget ticker={ticker} />
        </div>
      )}

      {activeTab === "Finanse" && (
        <div className="space-y-8">
          <FinancialKpis ticker={ticker} />
          <MoatWidget ticker={ticker} sector={sector} />
          <PeerComparison ticker={ticker} />
          <ConsensusWidget ticker={ticker} />
          <ForecastWidget ticker={ticker} />
        </div>
      )}

      {activeTab === "Eventy" && (
        <EventsList events={events} />
      )}

      {activeTab === "AI Chat" && (
        <AiChat ticker={ticker} />
      )}
    </div>
  );
}

// ── HealthOverview — lightweight card for Przegląd tab ─────────────────────

interface KpiRow {
  value:    number | null;
  metadata: Record<string, unknown> | null;
}
interface KpisApiResponse {
  health_score:   KpiRow | null;
  red_flags:      KpiRow | null;
  dividend_score: KpiRow | null;
}

function HealthOverview({ ticker }: { ticker: string }) {
  const [data, setData] = useState<KpisApiResponse | null>(null);

  function loadKpis() {
    fetch(`/api/company-kpis?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then((d: KpisApiResponse) => setData(d))
      .catch(() => {});
  }

  useEffect(() => {
    loadKpis();
    const handler = () => loadKpis();
    window.addEventListener("kpis-refreshed", handler);
    return () => window.removeEventListener("kpis-refreshed", handler);
  }, [ticker]);

  const hs    = data?.health_score;
  const rf    = data?.red_flags;
  const score = hs?.value ?? null;
  const flagsCount = rf?.value ?? null;
  const comment = (hs?.metadata as { comment?: string } | null)?.comment ?? "";

  const scoreColor =
    score === null ? "text-gray-500"
    : score >= 7 ? "text-green-400"
    : score >= 4 ? "text-yellow-400"
    : "text-red-400";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3">
        <div className="text-xs text-gray-500 font-medium mb-1">Health Score</div>
        <div className={`text-2xl font-bold tabular-nums ${scoreColor}`}>
          {score !== null ? `${score.toFixed(1)}/10` : "—"}
        </div>
      </div>
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3">
        <div className="text-xs text-gray-500 font-medium mb-1">Red Flags</div>
        <div className={`text-2xl font-bold tabular-nums ${flagsCount !== null && flagsCount > 0 ? "text-red-400" : "text-green-400"}`}>
          {flagsCount !== null ? (flagsCount > 0 ? `⚠️ ${flagsCount}` : "✓ 0") : "—"}
        </div>
      </div>
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3">
        <div className="text-xs text-gray-500 font-medium mb-1">Dywidenda</div>
        <div className="text-sm font-bold text-gray-300">
          {data === null ? "—" : (() => {
            const ds = data.dividend_score;
            if (!ds) return "Brak danych";
            const risk = (ds.metadata as { cut_risk?: string } | null)?.cut_risk;
            const color = risk === "HIGH" ? "text-red-400" : risk === "MEDIUM" ? "text-yellow-400" : "text-green-400";
            return <span className={color}>{risk === "HIGH" ? "HIGH risk" : risk === "MEDIUM" ? "MEDIUM risk" : "LOW risk"}</span>;
          })()}
        </div>
      </div>
      {comment && (
        <div className="col-span-full rounded-lg border border-gray-800 bg-gray-900/20 px-4 py-3">
          <p className="text-xs text-gray-400 italic leading-relaxed">{comment}</p>
        </div>
      )}
    </div>
  );
}

// ── EventsList ──────────────────────────────────────────────────────────────

function EventsList({ events }: { events: Event[] }) {
  if (!events.length) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-16 text-center text-gray-500">
        Brak danych
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden divide-y divide-gray-800/60">
      {events.map(e => (
        <div
          key={e.id}
          className="flex items-start gap-3 px-4 py-3.5 hover:bg-gray-900/60 transition-colors"
        >
          <div className="text-xs text-gray-600 w-24 shrink-0 pt-0.5 tabular-nums">
            {formatDate(e.published_at)}
          </div>
          <div className="w-24 shrink-0 pt-0.5">
            <EventTypeBadge type={e.event_type} />
          </div>
          <div className="flex-1 text-sm text-gray-200 leading-snug min-w-0">
            {e.url ? (
              <a href={e.url} target="_blank" rel="noreferrer" className="hover:text-blue-400 transition-colors">
                {e.title}
              </a>
            ) : e.title}
          </div>
          <div className="shrink-0 pt-0.5">
            <ImpactBadge score={e.impact_score} />
          </div>
        </div>
      ))}
    </div>
  );
}
