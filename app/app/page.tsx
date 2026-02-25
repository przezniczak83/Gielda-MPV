import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const revalidate = 300; // ISR: 5 minutes

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

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60)  return `${mins}m temu`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs}h temu`;
  return formatDate(iso);
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

function RecBadge({ rec }: { rec: string }) {
  const cls =
    rec === "BUY"       ? "bg-green-500/15 text-green-400 border border-green-500/25" :
    rec === "SELL"      ? "bg-red-500/15 text-red-400 border border-red-500/25" :
    rec === "OVERWEIGHT"? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" :
    "bg-gray-500/15 text-gray-400 border border-gray-500/25";

  return (
    <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full ${cls}`}>
      {rec}
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

type AlertedEvent = {
  ticker:     string;
  title:      string;
  alerted_at: string | null;
};

type Recommendation = {
  ticker:         string;
  recommendation: string;
  target_price:   number | null;
  received_at:    string | null;
};

type TopCompany = {
  ticker:    string;
  avg_score: number;
  events:    number;
};

type UpcomingEvent = {
  ticker:     string;
  event_type: string;
  event_date: string;
  title:      string;
};

const CAL_EMOJI: Record<string, string> = {
  earnings:        "📊",
  dividend_exdate: "💰",
  agm:             "🏛️",
  analyst_day:     "🎤",
  other:           "📌",
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const oneDayAgo    = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const todayStart   = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  const [
    { count: companyCount },
    { count: eventsTodayCount },
    { count: alertsTodayCount },
    { data: lastEventData },
    { data: recentEvents },
    { data: topEventsRaw },
    { data: alertedEvents },
    { data: recommendations },
    { data: upcomingEvents },
  ] = await Promise.all([
    supabase.from("companies").select("*", { count: "exact", head: true }),
    supabase.from("company_events").select("*", { count: "exact", head: true }).gt("created_at", oneDayAgo),
    supabase.from("company_events").select("*", { count: "exact", head: true }).gt("alerted_at", todayStart),
    supabase.from("company_events").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase
      .from("company_events")
      .select("ticker, title, event_type, impact_score, published_at")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("company_events")
      .select("ticker, impact_score")
      .gt("created_at", sevenDaysAgo),
    supabase
      .from("company_events")
      .select("ticker, title, alerted_at")
      .not("alerted_at", "is", null)
      .order("alerted_at", { ascending: false })
      .limit(5),
    supabase
      .from("early_recommendations")
      .select("ticker, recommendation, target_price, received_at")
      .order("received_at", { ascending: false })
      .limit(5),
    supabase
      .from("calendar_events")
      .select("ticker, event_type, event_date, title")
      .gte("event_date", todayStart)
      .order("event_date", { ascending: true })
      .limit(5),
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

        {/* ── Stats bar ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <StatCard label="Spółki w bazie"    value={companyCount     ?? 0} />
          <StatCard label="Eventy dziś (24h)" value={eventsTodayCount ?? 0} accent />
          <StatCard label="Alerty dziś"       value={alertsTodayCount ?? 0} accent />
          <StatCard label="Ostatni event"     value={formatDate(lastUpdated)} isText />
        </div>

        {/* ── Main + Sidebar ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">

          {/* Left column */}
          <div className="flex flex-col gap-6">

            {/* Ostatnie eventy */}
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

          </div>

          {/* Right sidebar */}
          <div className="flex flex-col gap-6">

            {/* Top spółki */}
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

            {/* Ostatnie alerty Telegram */}
            <div>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
                Ostatnie alerty Telegram
              </h2>
              {!(alertedEvents as AlertedEvent[])?.length ? (
                <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-6 text-center text-gray-500 text-sm">
                  Brak alertów
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {(alertedEvents as AlertedEvent[]).map((a, i) => (
                    <div key={i} className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          href={`/companies/${a.ticker}`}
                          className="font-mono font-bold text-blue-400 hover:text-blue-300 text-xs transition-colors"
                        >
                          {a.ticker}
                        </Link>
                        <span className="text-xs text-gray-600 tabular-nums whitespace-nowrap">
                          {timeAgo(a.alerted_at)}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 truncate">{a.title}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Rekomendacje DM */}
            <div>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
                Rekomendacje DM
              </h2>
              {!(recommendations as Recommendation[])?.length ? (
                <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-6 text-center text-gray-500 text-sm">
                  Brak rekomendacji
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {(recommendations as Recommendation[]).map((r, i) => (
                    <div key={i} className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          href={`/companies/${r.ticker}`}
                          className="font-mono font-bold text-blue-400 hover:text-blue-300 text-xs transition-colors"
                        >
                          {r.ticker}
                        </Link>
                        <RecBadge rec={r.recommendation} />
                      </div>
                      {r.target_price !== null && (
                        <div className="text-xs text-gray-400 mt-0.5">
                          Cel: <span className="text-gray-200 font-medium tabular-nums">{r.target_price} PLN</span>
                        </div>
                      )}
                      <div className="text-xs text-gray-600 mt-0.5">{timeAgo(r.received_at)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Nadchodzące eventy */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                  Nadchodzące eventy
                </h2>
                <Link href="/calendar" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
                  Wszystkie →
                </Link>
              </div>
              {!(upcomingEvents as UpcomingEvent[])?.length ? (
                <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-6 text-center text-gray-500 text-sm">
                  Brak nadchodzących eventów
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {(upcomingEvents as UpcomingEvent[]).map((ev, i) => {
                    const date = new Date(ev.event_date);
                    const isToday = date.toDateString() === new Date().toDateString();
                    return (
                      <div key={i} className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-2.5 flex items-center gap-3">
                        <span className="text-base">{CAL_EMOJI[ev.event_type] ?? "📌"}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/companies/${ev.ticker}`}
                              className="font-mono font-bold text-blue-400 hover:text-blue-300 text-xs transition-colors"
                            >
                              {ev.ticker}
                            </Link>
                            <span className={`text-xs tabular-nums ${isToday ? "text-yellow-400 font-bold" : "text-gray-500"}`}>
                              {isToday ? "DZIŚ" : date.toLocaleDateString("pl-PL", { day: "2-digit", month: "short" })}
                            </span>
                          </div>
                          <div className="text-xs text-gray-400 truncate mt-0.5">{ev.title}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

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
