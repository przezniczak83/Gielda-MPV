import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pl-PL", {
    day:   "2-digit",
    month: "short",
    year:  "numeric",
  });
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pl-PL", {
    day:    "2-digit",
    month:  "short",
    hour:   "2-digit",
    minute: "2-digit",
  });
}

function ImpactBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-gray-600 text-xs">—</span>;

  let cls: string;
  if (score >= 7) {
    cls = "bg-red-500/15 text-red-400 border border-red-500/25";
  } else if (score >= 4) {
    cls = "bg-yellow-500/15 text-yellow-400 border border-yellow-500/25";
  } else {
    cls = "bg-gray-500/15 text-gray-400 border border-gray-500/25";
  }

  return (
    <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${cls}`}>
      {score}
    </span>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type EventRow = {
  ticker:       string;
  title:        string;
  event_type:   string | null;
  impact_score: number | null;
  published_at: string | null;
};

type TopCompany = {
  ticker:    string;
  avg_score: number;
  events:    number;
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const oneDayAgo    = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const [
    { count: companyCount },
    { count: eventsTodayCount },
    { data: lastEventData },
    { data: recentEvents },
    { data: topEventsRaw },
  ] = await Promise.all([
    // Sekcja 1 — stats
    supabase.from("companies").select("*", { count: "exact", head: true }),
    supabase.from("company_events").select("*", { count: "exact", head: true }).gt("created_at", oneDayAgo),
    supabase.from("company_events").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    // Sekcja 2 — last 20 events
    supabase
      .from("company_events")
      .select("ticker, title, event_type, impact_score, published_at")
      .order("created_at", { ascending: false })
      .limit(20),
    // Sekcja 3 — top companies (7d) — fetch raw, aggregate in JS
    supabase
      .from("company_events")
      .select("ticker, impact_score")
      .gt("created_at", sevenDaysAgo),
  ]);

  // Aggregate top companies
  const tickerMap: Record<string, { sum: number; count: number }> = {};
  for (const e of topEventsRaw ?? []) {
    if (!tickerMap[e.ticker]) tickerMap[e.ticker] = { sum: 0, count: 0 };
    tickerMap[e.ticker].sum   += e.impact_score ?? 0;
    tickerMap[e.ticker].count += 1;
  }
  const topCompanies: TopCompany[] = Object.entries(tickerMap)
    .map(([ticker, { sum, count }]) => ({
      ticker,
      avg_score: Math.round((sum / count) * 10) / 10,
      events:    count,
    }))
    .sort((a, b) => b.avg_score - a.avg_score)
    .slice(0, 5);

  const lastUpdated = lastEventData?.created_at ?? null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Aktualizacja: {formatDateTime(lastUpdated)}</p>
        </div>

        {/* ── Sekcja 1: Stats bar ───────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatCard label="Spółki w bazie" value={companyCount ?? 0} />
          <StatCard label="Eventy dziś (24h)" value={eventsTodayCount ?? 0} accent />
          <StatCard
            label="Ostatni event"
            value={formatDate(lastUpdated)}
            isText
          />
        </div>

        {/* ── Sekcja 2 + 3: Main + Sidebar ──────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">

          {/* Sekcja 2 — Ostatnie eventy */}
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
              Ostatnie eventy
            </h2>
            <div className="rounded-xl border border-gray-800 overflow-hidden">
              {!recentEvents?.length ? (
                <div className="py-16 text-center text-gray-500 text-sm">Brak danych</div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-900/60">
                      <Th>Data</Th>
                      <Th>Ticker</Th>
                      <Th className="hidden md:table-cell">Tytuł</Th>
                      <Th className="hidden sm:table-cell">Typ</Th>
                      <Th>Score</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(recentEvents as EventRow[]).map((e, i) => (
                      <tr
                        key={i}
                        className="border-b border-gray-800/50 last:border-b-0 hover:bg-gray-900/60 transition-colors"
                      >
                        <td className="px-4 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                          {formatDate(e.published_at)}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/companies/${e.ticker}`}
                            className="font-mono font-bold text-blue-400 hover:text-blue-300 text-sm transition-colors"
                          >
                            {e.ticker}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300 hidden md:table-cell max-w-xs">
                          <div className="truncate">{e.title}</div>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400">
                            {e.event_type ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <ImpactBadge score={e.impact_score} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Sekcja 3 — Top spółki (sidebar) */}
          <div>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
              Top spółki (7 dni)
            </h2>
            {!topCompanies.length ? (
              <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-10 text-center text-gray-500 text-sm">
                Brak danych
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {topCompanies.map((c) => (
                  <Link
                    key={c.ticker}
                    href={`/companies/${c.ticker}`}
                    className="rounded-xl border border-gray-800 bg-gray-900/40 hover:bg-gray-900/80 transition-colors px-4 py-3 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-mono font-bold text-white text-sm">{c.ticker}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{c.events} event{c.events !== 1 ? "y" : ""}</div>
                    </div>
                    <ImpactBadge score={c.avg_score} />
                  </Link>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent = false,
  isText = false,
}: {
  label:    string;
  value:    string | number;
  accent?:  boolean;
  isText?:  boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-5 py-4">
      <div className="text-xs text-gray-500 font-medium mb-1">{label}</div>
      <div className={`font-bold tabular-nums ${isText ? "text-lg text-gray-200" : "text-3xl"} ${accent ? "text-blue-400" : "text-white"}`}>
        {value}
      </div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 ${className}`}>
      {children}
    </th>
  );
}
