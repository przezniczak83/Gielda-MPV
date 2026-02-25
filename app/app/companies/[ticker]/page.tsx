import Link         from "next/link";
import { notFound } from "next/navigation";
import { supabase }  from "@/lib/supabase";
import CompanyTabs   from "@/app/components/CompanyTabs";

export const dynamic = "force-dynamic";

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

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-gray-500 mb-8">
          <Link href="/companies" className="hover:text-gray-300 transition-colors">
            Spółki
          </Link>
          <span className="text-gray-700">/</span>
          <span className="text-gray-300 font-medium">{company.ticker}</span>
        </nav>

        {/* Header */}
        <div className="mb-8">
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

        {/* Tabbed content (client component) */}
        <CompanyTabs
          ticker={ticker}
          events={(events ?? []) as Parameters<typeof CompanyTabs>[0]["events"]}
          latestPrice={latestPrice as { close: number; date: string } | null}
        />

      </div>
    </div>
  );
}
