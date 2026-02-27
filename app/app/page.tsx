import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import TopMovers   from "./components/TopMovers";
import TodayAlerts from "./components/TodayAlerts";
import NewsWidget  from "./components/NewsWidget";

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

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
    rec === "BUY"        ? "bg-green-500/15 text-green-400 border border-green-500/25" :
    rec === "SELL"       ? "bg-red-500/15 text-red-400 border border-red-500/25"       :
    rec === "OVERWEIGHT" ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" :
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

type Recommendation = {
  ticker:         string;
  recommendation: string;
  target_price:   number | null;
  received_at:    string | null;
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
  const twelveHAgo   = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
  const todayStart   = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  // Morning brief: only relevant 6:00–12:00 Warsaw time
  const warsawHour = parseInt(
    new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Europe/Warsaw" }),
    10,
  );
  const showMorningBrief = warsawHour >= 6 && warsawHour < 12;

  const client = db();

  const [
    { count: eventsTodayCount },
    { count: alertsTodayCount },
    { data: lastEventData },
    { data: recentEvents },
    { data: recommendations },
    { data: upcomingEvents },
    { count: morningAlertsCount },
    { count: morningCalendarCount },
    { count: morningRecsCount },
    { count: news24hCount },
    { count: breakingCount },
    { data: avgSentimentData },
  ] = await Promise.all([
    client.from("company_events").select("*", { count: "exact", head: true }).gt("created_at", oneDayAgo),
    client.from("company_events").select("*", { count: "exact", head: true }).gt("alerted_at", todayStart),
    client.from("company_events").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    client
      .from("company_events")
      .select("ticker, title, event_type, impact_score, published_at")
      .order("created_at", { ascending: false })
      .limit(15),
    client
      .from("early_recommendations")
      .select("ticker, recommendation, target_price, received_at")
      .order("received_at", { ascending: false })
      .limit(5),
    client
      .from("calendar_events")
      .select("ticker, event_type, event_date, title")
      .gte("event_date", todayStart)
      .order("event_date", { ascending: true })
      .limit(6),
    client.from("company_events").select("*", { count: "exact", head: true })
      .gte("published_at", twelveHAgo).gte("impact_score", 6),
    client.from("calendar_events").select("*", { count: "exact", head: true })
      .gte("event_date", todayStart)
      .lte("event_date", new Date(Date.now() + 48 * 3600 * 1000).toISOString()),
    client.from("analyst_forecasts").select("*", { count: "exact", head: true })
      .gte("created_at", oneDayAgo),
    // News stats (24h)
    client.from("news_items").select("*", { count: "exact", head: true })
      .eq("ai_processed", true).gte("published_at", oneDayAgo),
    client.from("news_items").select("*", { count: "exact", head: true })
      .eq("ai_processed", true).eq("is_breaking", true).gte("published_at", oneDayAgo),
    client.from("news_items").select("sentiment")
      .eq("ai_processed", true).gte("published_at", oneDayAgo)
      .not("sentiment", "is", null).limit(200),
  ]);

  const lastUpdated = lastEventData?.created_at ?? null;

  // Compute avg sentiment from news last 24h
  const sentimentValues = (avgSentimentData ?? []).map((r: { sentiment: number | null }) => r.sentiment).filter((s): s is number => s !== null);
  const avgNewsSentiment = sentimentValues.length > 0
    ? sentimentValues.reduce((a, b) => a + b, 0) / sentimentValues.length
    : null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-white">Command Center</h1>
          <p className="text-gray-500 text-xs mt-0.5">
            Aktualizacja: {formatDateTime(lastUpdated)}
          </p>
        </div>

        {/* ── Morning Brief ────────────────────────────────────────── */}
        {showMorningBrief && (
          <div className="mb-5 rounded-xl border border-amber-800/40 bg-amber-900/10 px-5 py-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4 flex-wrap">
                <span className="text-sm font-semibold text-amber-300 flex items-center gap-1.5">
                  🌅 Morning Brief
                  <span className="text-xs text-amber-700 font-normal">
                    {new Date().toLocaleDateString("pl-PL", {
                      weekday: "long", day: "numeric", month: "long",
                      timeZone: "Europe/Warsaw",
                    })}
                  </span>
                </span>
                <div className="flex items-center gap-4 text-sm">
                  <span>
                    <span className={(morningAlertsCount ?? 0) > 0 ? "text-red-400 font-bold" : "text-gray-500"}>
                      ⚡ {morningAlertsCount ?? 0}
                    </span>
                    <span className="text-gray-600 text-xs ml-1">alertów</span>
                  </span>
                  <span>
                    <span className={(morningCalendarCount ?? 0) > 0 ? "text-blue-400 font-bold" : "text-gray-500"}>
                      📅 {morningCalendarCount ?? 0}
                    </span>
                    <span className="text-gray-600 text-xs ml-1">eventów</span>
                  </span>
                  <span>
                    <span className={(morningRecsCount ?? 0) > 0 ? "text-green-400 font-bold" : "text-gray-500"}>
                      💼 {morningRecsCount ?? 0}
                    </span>
                    <span className="text-gray-600 text-xs ml-1">rekomendacji</span>
                  </span>
                </div>
              </div>
              <Link
                href="/alerts"
                className="text-xs px-3 py-1.5 rounded-md bg-amber-900/30 hover:bg-amber-900/50 border border-amber-700/40 text-amber-300 transition-colors whitespace-nowrap"
              >
                Szczegóły →
              </Link>
            </div>
          </div>
        )}

        {/* ── Stats bar ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="Newsy (24h)"   value={news24hCount     ?? 0} accent />
          <StatCard label="Breaking (24h)" value={breakingCount   ?? 0} accent={!!breakingCount && breakingCount > 0} danger={!!breakingCount && breakingCount > 0} />
          <StatCard label="Sentiment (24h)" value={
            avgNewsSentiment !== null
              ? `${avgNewsSentiment > 0 ? "+" : ""}${avgNewsSentiment.toFixed(2)}`
              : "—"
          } isText sentimentVal={avgNewsSentiment} />
          <StatCard label="Alerty dziś"   value={alertsTodayCount ?? 0} accent />
        </div>

        {/* ── 4-Quadrant Command Center ─────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">

          {/* Q1: Top Movers */}
          <TopMovers />

          {/* Q2: Today Alerts (client widget) */}
          <TodayAlerts />

          {/* Q3: Recent Events */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                Ostatnie eventy
              </h2>
              <Link href="/companies" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
                Wszystkie spółki →
              </Link>
            </div>
            {!recentEvents?.length ? (
              <div className="py-10 text-center text-gray-500 text-sm">Brak danych</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <Th>Data</Th>
                      <Th>Ticker</Th>
                      <Th className="hidden md:table-cell">Tytuł</Th>
                      <Th>Score</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {(recentEvents as EventRow[]).map((e, i) => (
                      <tr key={i} className="border-b border-gray-800/40 last:border-b-0 hover:bg-gray-900/60 transition-colors">
                        <td className="py-2.5 pr-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                          {formatDate(e.published_at)}
                        </td>
                        <td className="py-2.5 pr-3">
                          <Link
                            href={`/companies/${e.ticker}`}
                            className="font-mono font-bold text-blue-400 hover:text-blue-300 text-xs transition-colors"
                          >
                            {e.ticker}
                          </Link>
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-gray-300 hidden md:table-cell max-w-[200px]">
                          <div className="truncate">{e.title}</div>
                        </td>
                        <td className="py-2.5">
                          <ImpactBadge score={e.impact_score} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Q4: Right panel (Recommendations + Upcoming events) */}
          <div className="flex flex-col gap-4">

            {/* Rekomendacje */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
                Rekomendacje DM
              </h2>
              {!(recommendations as Recommendation[])?.length ? (
                <div className="py-4 text-center text-gray-500 text-sm">Brak rekomendacji</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {(recommendations as Recommendation[]).map((r, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-gray-800 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/companies/${r.ticker}`}
                          className="font-mono font-bold text-blue-400 hover:text-blue-300 text-xs transition-colors"
                        >
                          {r.ticker}
                        </Link>
                        {r.target_price !== null && (
                          <span className="text-xs text-gray-400">
                            Cel: <span className="text-gray-200 font-medium tabular-nums">{r.target_price}</span>
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-600">{timeAgo(r.received_at)}</span>
                        <RecBadge rec={r.recommendation} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Nadchodzące eventy */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                  Nadchodzące eventy
                </h2>
                <Link href="/calendar" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
                  Kalendarz →
                </Link>
              </div>
              {!(upcomingEvents as UpcomingEvent[])?.length ? (
                <div className="py-4 text-center text-gray-500 text-sm">Brak nadchodzących eventów</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {(upcomingEvents as UpcomingEvent[]).map((ev, i) => {
                    const date    = new Date(ev.event_date);
                    const isToday = date.toDateString() === new Date().toDateString();
                    return (
                      <div key={i} className="flex items-center gap-2.5 rounded-lg border border-gray-800 px-3 py-2">
                        <span className="text-sm">{CAL_EMOJI[ev.event_type] ?? "📌"}</span>
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
                          <div className="text-xs text-gray-400 truncate">{ev.title}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── News Widget (full width) ──────────────────────────────── */}
        <NewsWidget />

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
  danger = false,
  sentimentVal,
}: {
  label:         string;
  value:         string | number;
  accent?:       boolean;
  isText?:       boolean;
  danger?:       boolean;
  sentimentVal?: number | null;
}) {
  const sentimentColor =
    sentimentVal === undefined || sentimentVal === null ? "text-gray-200"
    : sentimentVal > 0.3  ? "text-emerald-400"
    : sentimentVal < -0.3 ? "text-red-400"
    : "text-yellow-400";

  const textColor =
    sentimentVal !== undefined  ? sentimentColor
    : danger                    ? "text-red-400"
    : accent                    ? "text-blue-400"
    : "text-white";

  return (
    <div className={`rounded-xl border bg-gray-900/40 px-4 py-3 ${
      danger ? "border-red-900/30" : "border-gray-800"
    }`}>
      <div className="text-xs text-gray-500 font-medium mb-1">{label}</div>
      <div className={`font-bold tabular-nums ${isText ? "text-base" : "text-2xl"} ${textColor}`}>
        {value}
      </div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`text-left text-xs font-semibold text-gray-500 uppercase tracking-wide pb-2 ${className}`}>
      {children}
    </th>
  );
}
