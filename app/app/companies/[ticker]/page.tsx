import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import AiChat        from "@/app/components/AiChat";
import PriceChart    from "@/app/components/PriceChart";
import FinancialKpis from "@/app/components/FinancialKpis";

export const dynamic = "force-dynamic";

type Event = {
  id: string;
  title: string;
  event_type: string | null;
  impact_score: number | null;
  published_at: string | null;
  url: string | null;
};

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

function EventTypeBadge({ type }: { type: string | null }) {
  const labels: Record<string, string> = {
    earnings:   "Wyniki",
    dividend:   "Dywidenda",
    regulatory: "Regulacje",
    other:      "Inne",
  };
  const label = type ? (labels[type] ?? type) : "—";

  return (
    <span className="inline-block text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 font-medium whitespace-nowrap">
      {label}
    </span>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pl-PL", {
    day:   "2-digit",
    month: "short",
    year:  "numeric",
  });
}

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

  const [{ data: company }, { data: events }, { data: latestPrice }] = await Promise.all([
    supabase
      .from("companies")
      .select("ticker, name, sector, market")
      .eq("ticker", ticker)
      .maybeSingle(),
    supabase
      .from("company_events")
      .select("id, title, event_type, impact_score, published_at, url")
      .eq("ticker", ticker)
      .order("published_at", { ascending: false })
      .limit(20),
    supabase
      .from("price_history")
      .select("close, date")
      .eq("ticker", ticker)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!company) notFound();

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Back */}
        <Link
          href="/companies"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300 transition-colors mb-8"
        >
          ← Spółki
        </Link>

        {/* Header */}
        <div className="mb-10">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-5xl font-bold font-mono text-white tracking-tight">
              {company.ticker}
            </h1>
            <span className="text-xs px-2.5 py-1 rounded-md bg-gray-800 text-gray-400 font-mono">
              {company.market}
            </span>
          </div>
          <div className="mt-2 text-xl text-gray-300 font-medium">{company.name}</div>
          {company.sector && (
            <div className="mt-1 text-sm text-gray-500">{company.sector}</div>
          )}
        </div>

        {/* Price bar */}
        <div className="mb-6">
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
        </div>

        {/* Price chart */}
        <div className="mb-6">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
            Wykres cen (30 dni)
          </h2>
          <PriceChart ticker={ticker} />
        </div>

        {/* Financial KPIs */}
        <div className="mb-8">
          <FinancialKpis ticker={ticker} />
        </div>

        {/* AI Chat */}
        <div className="mb-10">
          <AiChat ticker={ticker} />
        </div>

        {/* Events */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-4">
            Ostatnie zdarzenia
          </h2>

          {!events?.length ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-16 text-center text-gray-500">
              Brak danych
            </div>
          ) : (
            <div className="rounded-xl border border-gray-800 overflow-hidden divide-y divide-gray-800/60">
              {(events as Event[]).map((e) => (
                <div
                  key={e.id}
                  className="flex items-start gap-3 px-4 py-3.5 hover:bg-gray-900/60 transition-colors"
                >
                  {/* Date */}
                  <div className="text-xs text-gray-600 w-24 shrink-0 pt-0.5 tabular-nums">
                    {formatDate(e.published_at)}
                  </div>

                  {/* Event type */}
                  <div className="w-24 shrink-0 pt-0.5">
                    <EventTypeBadge type={e.event_type} />
                  </div>

                  {/* Title */}
                  <div className="flex-1 text-sm text-gray-200 leading-snug min-w-0">
                    {e.url ? (
                      <a
                        href={e.url}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-blue-400 transition-colors"
                      >
                        {e.title}
                      </a>
                    ) : (
                      e.title
                    )}
                  </div>

                  {/* Impact badge */}
                  <div className="shrink-0 pt-0.5">
                    <ImpactBadge score={e.impact_score} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
