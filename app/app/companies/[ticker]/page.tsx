import Link         from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import CompanyTabs   from "@/app/components/CompanyTabs";

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

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

  const db = supabase();

  // ── Try snapshot first (single query, fast) ────────────────────────────────
  const { data: snapRow } = await db
    .from("company_snapshot")
    .select("snapshot, computed_at")
    .eq("ticker", ticker)
    .maybeSingle();

  if (snapRow && isFresh(snapRow.computed_at, 30)) {
    const snap = snapRow.snapshot as {
      company:       { ticker: string; name: string; sector: string | null; market: string };
      price:         { close: number; date: string } | null;
      recent_events: Array<{
        id: string; title: string; event_type: string | null;
        impact_score: number | null; published_at: string | null; url: string | null;
      }>;
    };

    return (
      <CompanyPageLayout
        ticker={ticker}
        name={snap.company.name}
        market={snap.company.market}
        sector={snap.company.sector}
        events={snap.recent_events}
        latestPrice={snap.price}
      />
    );
  }

  // ── Fallback: live queries (3 parallel) ────────────────────────────────────
  const [{ data: company }, { data: events }, { data: latestPrice }] = await Promise.all([
    db.from("companies")
      .select("ticker, name, sector, market")
      .eq("ticker", ticker)
      .maybeSingle(),
    db.from("company_events")
      .select("id, title, event_type, impact_score, published_at, url")
      .eq("ticker", ticker)
      .order("published_at", { ascending: false })
      .limit(20),
    db.from("price_history")
      .select("close, date")
      .eq("ticker", ticker)
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!company) notFound();

  return (
    <CompanyPageLayout
      ticker={ticker}
      name={company.name}
      market={company.market}
      sector={company.sector}
      events={(events ?? []) as Parameters<typeof CompanyTabs>[0]["events"]}
      latestPrice={latestPrice as { close: number; date: string } | null}
    />
  );
}

// ─── Layout (shared between snapshot and live paths) ─────────────────────────

function CompanyPageLayout({
  ticker,
  name,
  market,
  sector,
  events,
  latestPrice,
}: {
  ticker:      string;
  name:        string;
  market:      string;
  sector:      string | null;
  events:      Parameters<typeof CompanyTabs>[0]["events"];
  latestPrice: { close: number; date: string } | null;
}) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-4xl mx-auto px-6 py-10">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-gray-500 mb-8">
          <Link href="/companies" className="hover:text-gray-300 transition-colors">
            Spółki
          </Link>
          <span className="text-gray-700">/</span>
          <span className="text-gray-300 font-medium">{ticker}</span>
        </nav>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-5xl font-bold font-mono text-white tracking-tight">
              {ticker}
            </h1>
            <span className="text-xs px-2.5 py-1 rounded-md bg-gray-800 text-gray-400 font-mono">
              {market}
            </span>
          </div>
          <div className="mt-2 text-xl text-gray-300 font-medium">{name}</div>
          {sector && (
            <div className="mt-1 text-sm text-gray-500">{sector}</div>
          )}
        </div>

        {/* Tabbed content (client component) */}
        <CompanyTabs
          ticker={ticker}
          sector={sector}
          events={events}
          latestPrice={latestPrice}
        />

      </div>
    </div>
  );
}
