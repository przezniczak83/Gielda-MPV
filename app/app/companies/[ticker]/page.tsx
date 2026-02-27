import Link         from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import CompanyTabs   from "@/app/components/CompanyTabs";
import TrackVisit    from "@/app/components/TrackVisit";
import FavoriteButton from "@/app/components/FavoriteButton";

export const revalidate = 300; // ISR: re-render every 5 minutes

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

function isFresh(computedAt: string, maxMinutes: number): boolean {
  const age = (Date.now() - new Date(computedAt).getTime()) / 1000 / 60;
  return age < maxMinutes;
}

type CompanyProfile = {
  ticker:      string;
  name:        string;
  sector:      string | null;
  market:      string;
  ceo:         string | null;
  website_url: string | null;
  ir_url:      string | null;
  indices:     string[] | null;
  city:        string | null;
  description: string | null;
};

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

  const db = supabase();

  // ── Always fetch company profile + 2 prices (for change%) ─────────────────
  const [{ data: company }, { data: prices }, { data: snapRow }] = await Promise.all([
    db.from("companies")
      .select("ticker, name, sector, market, ceo, website_url, ir_url, indices, city, description")
      .eq("ticker", ticker)
      .maybeSingle(),
    db.from("price_history")
      .select("close, date")
      .eq("ticker", ticker)
      .order("date", { ascending: false })
      .limit(2),
    db.from("company_snapshot")
      .select("snapshot, computed_at")
      .eq("ticker", ticker)
      .maybeSingle(),
  ]);

  if (!company) notFound();

  const latestPrice = prices?.[0] ?? null;
  const prevClose   = prices?.[1]?.close ?? null;

  // ── Try snapshot for events ────────────────────────────────────────────────
  if (snapRow && isFresh(snapRow.computed_at, 30)) {
    const snap = snapRow.snapshot as {
      recent_events: Array<{
        id: string; title: string; event_type: string | null;
        impact_score: number | null; published_at: string | null; url: string | null;
      }>;
    };

    return (
      <CompanyPageLayout
        company={company as CompanyProfile}
        events={snap.recent_events}
        latestPrice={latestPrice}
        prevClose={prevClose}
      />
    );
  }

  // ── Fallback: live events query ────────────────────────────────────────────
  const { data: events } = await db
    .from("company_events")
    .select("id, title, event_type, impact_score, published_at, url")
    .eq("ticker", ticker)
    .order("published_at", { ascending: false })
    .limit(20);

  return (
    <CompanyPageLayout
      company={company as CompanyProfile}
      events={(events ?? []) as Parameters<typeof CompanyTabs>[0]["events"]}
      latestPrice={latestPrice}
      prevClose={prevClose}
    />
  );
}

// ─── Layout (shared between snapshot and live paths) ─────────────────────────

function CompanyPageLayout({
  company,
  events,
  latestPrice,
  prevClose,
}: {
  company:     CompanyProfile;
  events:      Parameters<typeof CompanyTabs>[0]["events"];
  latestPrice: { close: number; date: string } | null;
  prevClose:   number | null;
}) {
  const { ticker, name, sector, market, ceo, website_url, ir_url, indices, city, description } = company;

  const priceChangePct = (latestPrice && prevClose && prevClose > 0)
    ? ((latestPrice.close - prevClose) / prevClose * 100)
    : null;

  const changePositive = priceChangePct !== null && priceChangePct >= 0;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-4xl mx-auto px-4 py-6 md:px-6 md:py-10">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-gray-600 mb-6">
          <Link href="/" className="hover:text-gray-400 transition-colors">Dashboard</Link>
          <span>/</span>
          <Link href="/companies" className="hover:text-gray-400 transition-colors">Spółki</Link>
          <span>/</span>
          <span className="text-gray-400 font-medium font-mono">{ticker}</span>
          {sector && (
            <>
              <span className="ml-2 text-gray-700">·</span>
              <span className="text-gray-600">{sector}</span>
            </>
          )}
          {market && (
            <>
              <span className="text-gray-700">·</span>
              <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">{market}</span>
            </>
          )}
        </nav>

        {/* Track visit (client, no render) */}
        <TrackVisit ticker={ticker} name={name} />

        {/* ── Enriched Header ──────────────────────────────────────────────── */}
        <div className="mb-8 space-y-3">

          {/* Row 1: ticker + market badge + indices + actions */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-3xl md:text-5xl font-bold font-mono text-white tracking-tight">
              {ticker}
            </h1>
            <span className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-400 font-mono">
              {market}
            </span>
            {indices?.map(idx => (
              <span
                key={idx}
                className="text-xs px-2 py-1 rounded bg-blue-900/30 text-blue-400 border border-blue-800/50 font-medium"
              >
                {idx}
              </span>
            ))}
            <FavoriteButton ticker={ticker} />
            <Link
              href={`/reports/${ticker}`}
              className="text-xs px-2.5 py-1 rounded-md bg-blue-900/40 hover:bg-blue-900/60 text-blue-400 border border-blue-800/50 transition-colors"
            >
              📄 Raport AI
            </Link>
          </div>

          {/* Row 2: full name + sector + city */}
          <div>
            <div className="text-xl text-gray-200 font-medium">{name}</div>
            <div className="text-sm text-gray-500 mt-0.5">
              {[sector, city].filter(Boolean).join(" · ")}
            </div>
          </div>

          {/* Row 3: price + change */}
          {latestPrice && (
            <div className="flex items-baseline gap-3">
              <span className="text-2xl md:text-3xl font-bold text-white tabular-nums">
                {Number(latestPrice.close).toFixed(2)} PLN
              </span>
              {priceChangePct !== null && (
                <span className={`text-sm font-semibold tabular-nums ${changePositive ? "text-green-400" : "text-red-400"}`}>
                  {changePositive ? "+" : ""}{priceChangePct.toFixed(2)}%
                </span>
              )}
              <span className="text-xs text-gray-600">{latestPrice.date}</span>
            </div>
          )}

          {/* Row 4: CEO + links */}
          {(ceo || website_url || ir_url) && (
            <div className="flex items-center gap-4 text-xs flex-wrap">
              {ceo && (
                <span className="text-gray-400">
                  CEO: <span className="text-gray-200">{ceo}</span>
                </span>
              )}
              {website_url && (
                <a
                  href={website_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-gray-400 hover:text-blue-400 transition-colors"
                >
                  🌐 Strona www
                </a>
              )}
              {ir_url && (
                <a
                  href={ir_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-gray-400 hover:text-blue-400 transition-colors"
                >
                  📊 Relacje Inwestorskie
                </a>
              )}
            </div>
          )}

          {/* Row 5: description */}
          {description && (
            <p className="text-sm text-gray-400 leading-relaxed max-w-2xl border-l-2 border-gray-800 pl-3">
              {description}
            </p>
          )}
        </div>

        {/* Tabbed content (client component) */}
        <CompanyTabs
          ticker={ticker}
          sector={sector}
          market={market}
          events={events}
          latestPrice={latestPrice}
        />

      </div>
    </div>
  );
}
