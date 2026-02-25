// app/app/macro/page.tsx
// Macro indicators page — NBP exchange rates + Claude Haiku interpretation.

import { createClient } from "@supabase/supabase-js";
import MacroInterpretation from "../components/MacroInterpretation";

export const revalidate = 3600; // 1h — macro data changes ~every 6h

interface MacroRow {
  id:         number;
  name:       string;
  value:      number;
  prev_value: number | null;
  change_pct: number | null;
  source:     string;
  fetched_at: string;
  period:     string | null;
}

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

function ArrowBadge({ change }: { change: number | null }) {
  if (change === null) return null;
  const positive = change >= 0;
  const cls = positive ? "text-red-400" : "text-green-400"; // PLN stronger = green
  return (
    <span className={`text-xs font-mono ${cls}`}>
      {positive ? "▲" : "▼"} {Math.abs(change).toFixed(3)}%
    </span>
  );
}

export default async function MacroPage() {
  const db = supabase();

  // Get latest reading for each indicator
  const { data: allRows } = await db
    .from("macro_indicators")
    .select("id, name, value, prev_value, change_pct, source, fetched_at, period")
    .order("fetched_at", { ascending: false })
    .limit(100);

  // Deduplicate — keep the most recent per name
  const latestMap = new Map<string, MacroRow>();
  for (const row of (allRows ?? []) as MacroRow[]) {
    if (!latestMap.has(row.name)) {
      latestMap.set(row.name, row);
    }
  }
  const indicators = Array.from(latestMap.values());

  const lastFetch = indicators.length > 0
    ? new Date(indicators[0].fetched_at).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })
    : null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-4xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Wskaźniki Makro</h1>
          <p className="text-sm text-gray-500 mt-1">
            Źródło: NBP API · aktualizacja co 6h
            {lastFetch && <span className="ml-2">· ostatnia: {lastFetch}</span>}
          </p>
        </div>

        {indicators.length === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-6 py-10 text-center">
            <p className="text-gray-500 text-sm">Brak danych makro.</p>
            <p className="text-gray-600 text-xs mt-2">
              Uruchom Edge Function <code className="bg-gray-800 px-1 rounded">fetch-macro</code> aby pobrać dane.
            </p>
          </div>
        ) : (
          <>
            {/* Exchange rate cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              {indicators.map((ind) => (
                <div
                  key={ind.name}
                  className="rounded-xl border border-gray-800 bg-gray-900/40 px-5 py-4"
                >
                  <div className="text-xs text-gray-500 font-medium tracking-wide mb-1">
                    {ind.name}
                  </div>
                  <div className="text-2xl font-bold text-white font-mono">
                    {Number(ind.value).toFixed(4)}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <ArrowBadge change={ind.change_pct} />
                    {ind.period && (
                      <span className="text-xs text-gray-600">{ind.period}</span>
                    )}
                  </div>
                  {ind.prev_value != null && (
                    <div className="text-xs text-gray-600 mt-1">
                      poprz. {Number(ind.prev_value).toFixed(4)}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* AI Interpretation */}
            <MacroInterpretation indicators={indicators} />
          </>
        )}

      </div>
    </div>
  );
}
