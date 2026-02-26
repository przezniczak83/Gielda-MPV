// app/app/reports/[ticker]/page.tsx
// AI-generated company report page.

import { createClient } from "@supabase/supabase-js";
import ReportClient from "./ReportClient";
import Link from "next/link";

export const revalidate = 0; // Always dynamic (report generation is on-demand)

interface PageProps {
  params: Promise<{ ticker: string }>;
}

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { ticker } = await params;
  return { title: `Raport ${ticker.toUpperCase()} — Giełda Monitor` };
}

export default async function ReportPage({ params }: PageProps) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

  // Check if company exists
  const db = supabase();
  const { data: company } = await db
    .from("companies")
    .select("ticker, name, sector, market")
    .eq("ticker", ticker)
    .maybeSingle();

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Print-only header */}
      <div className="hidden print:block mb-6">
        <div className="flex justify-between items-start text-xs text-gray-400">
          <span>Giełda Monitor · AI Report</span>
          <span>Wygenerowano: {new Date().toLocaleDateString("pl-PL")}</span>
        </div>
        <hr className="border-gray-300 my-2" />
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="mb-6 print:hidden">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
            <Link href="/" className="hover:text-gray-300">Dashboard</Link>
            <span>›</span>
            {company && (
              <>
                <Link href={`/companies/${ticker}`} className="hover:text-gray-300">{ticker}</Link>
                <span>›</span>
              </>
            )}
            <span className="text-gray-400">Raport AI</span>
          </div>
          <h1 className="text-2xl font-bold text-white">
            {company ? `${company.name} (${ticker})` : ticker}
            {" "}
            <span className="text-base font-normal text-gray-500">— Raport AI</span>
          </h1>
          {company && (
            <p className="text-sm text-gray-500 mt-1">
              {company.sector} · {company.market}
            </p>
          )}
        </div>

        {!company ? (
          <div className="rounded-xl border border-red-800/50 bg-red-900/20 px-6 py-8 text-center">
            <p className="text-red-400">Ticker <strong>{ticker}</strong> nie znaleziony w bazie.</p>
            <Link href="/companies" className="text-sm text-blue-400 hover:text-blue-300 mt-2 inline-block">
              ← Powrót do listy spółek
            </Link>
          </div>
        ) : (
          <ReportClient ticker={ticker} />
        )}
      </div>
    </div>
  );
}
