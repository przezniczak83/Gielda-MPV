// app/app/macro/page.tsx
// Macro indicators page — NBP exchange rates + Stooq WIBOR + GUS BDL CPI + optional FRED USA data + Claude Haiku interpretation.

import { createClient } from "@supabase/supabase-js";
import MacroInterpretation from "../components/MacroInterpretation";

export const revalidate = 60; // 1h — macro data changes ~every 6h

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

function ArrowBadge({ change, invertColor = false }: { change: number | null; invertColor?: boolean }) {
  if (change === null) return null;
  const positive = change >= 0;
  // For FX: PLN stronger (currency falling) = green. For economic indicators: positive = normal
  const cls = invertColor
    ? (positive ? "text-red-400"   : "text-green-400")  // FX: falling = PLN stronger = good
    : (positive ? "text-green-400" : "text-red-400");    // economic: rising is context-dependent
  return (
    <span className={`text-xs font-mono ${cls}`}>
      {positive ? "▲" : "▼"} {Math.abs(change).toFixed(3)}%
    </span>
  );
}

function IndicatorCard({ ind, invertColor = false }: { ind: MacroRow; invertColor?: boolean }) {
  const isPercent = [
    "Fed Funds Rate", "US CPI (YoY)", "US 10Y Treasury", "US Unemployment",
    "WIBOR 1M", "WIBOR 3M", "WIBOR 6M", "PL CPI (YoY)",
  ].includes(ind.name);
  const valueStr  = isPercent
    ? `${Number(ind.value).toFixed(2)}%`
    : Number(ind.value).toFixed(4);
  const prevStr   = isPercent && ind.prev_value != null
    ? `${Number(ind.prev_value).toFixed(2)}%`
    : ind.prev_value != null
      ? Number(ind.prev_value).toFixed(4)
      : null;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-5 py-4">
      <div className="text-xs text-gray-500 font-medium tracking-wide mb-1 flex items-center justify-between">
        <span>{ind.name}</span>
        <span className="text-[10px] text-gray-700 font-mono">{ind.source}</span>
      </div>
      <div className="text-2xl font-bold text-white font-mono">
        {valueStr}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <ArrowBadge change={ind.change_pct} invertColor={invertColor} />
        {ind.period && (
          <span className="text-xs text-gray-600">{ind.period}</span>
        )}
      </div>
      {prevStr && (
        <div className="text-xs text-gray-600 mt-1">
          poprz. {prevStr}
        </div>
      )}
    </div>
  );
}

export default async function MacroPage() {
  const db = supabase();

  // Get latest reading for each indicator
  const { data: allRows } = await db
    .from("macro_indicators")
    .select("id, name, value, prev_value, change_pct, source, fetched_at, period")
    .order("fetched_at", { ascending: false })
    .limit(200);

  // Deduplicate — keep the most recent per name
  const latestMap = new Map<string, MacroRow>();
  for (const row of (allRows ?? []) as MacroRow[]) {
    if (!latestMap.has(row.name)) {
      latestMap.set(row.name, row);
    }
  }
  const allIndicators = Array.from(latestMap.values());

  // Split by source
  const nbpIndicators   = allIndicators.filter(i => i.source === "NBP");
  const wiborIndicators = allIndicators.filter(i => i.source === "Stooq");
  const cpiIndicators   = allIndicators.filter(i => i.source === "GUS BDL");
  const fredIndicators  = allIndicators.filter(i => i.source === "FRED");

  const lastFetch = allIndicators.length > 0
    ? new Date(allIndicators[0].fetched_at).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })
    : null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-4xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Wskaźniki Makro</h1>
          <p className="text-sm text-gray-500 mt-1">
            Źródło: NBP API
            {" "}· Stooq WIBOR · GUS BDL CPI{fredIndicators.length > 0 ? " · FRED API" : ""}
            {" "}· aktualizacja co 6h
            {lastFetch && <span className="ml-2">· ostatnia: {lastFetch}</span>}
          </p>
        </div>

        {allIndicators.length === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-6 py-10 text-center">
            <p className="text-gray-500 text-sm">Brak danych makro.</p>
            <p className="text-gray-600 text-xs mt-2">
              Uruchom Edge Function <code className="bg-gray-800 px-1 rounded">fetch-macro</code> aby pobrać dane.
            </p>
          </div>
        ) : (
          <>
            {/* NBP Exchange rate cards */}
            {nbpIndicators.length > 0 && (
              <section className="mb-8">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
                  Kursy walut (NBP)
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {nbpIndicators.map((ind) => (
                    <IndicatorCard key={ind.name} ind={ind} invertColor={true} />
                  ))}
                </div>
              </section>
            )}

            {/* WIBOR rates */}
            {wiborIndicators.length > 0 && (
              <section className="mb-8">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
                  Stopy WIBOR (Stooq)
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {wiborIndicators.map((ind) => (
                    <IndicatorCard key={ind.name} ind={ind} invertColor={false} />
                  ))}
                </div>
              </section>
            )}

            {/* PL CPI */}
            {cpiIndicators.length > 0 && (
              <section className="mb-8">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
                  Inflacja PL (GUS BDL)
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {cpiIndicators.map((ind) => (
                    <IndicatorCard key={ind.name} ind={ind} invertColor={false} />
                  ))}
                </div>
              </section>
            )}

            {/* FRED USA macro indicators */}
            {fredIndicators.length > 0 ? (
              <section className="mb-8">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
                  USA Makro (FRED)
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {fredIndicators.map((ind) => (
                    <IndicatorCard key={ind.name} ind={ind} invertColor={false} />
                  ))}
                </div>
              </section>
            ) : (
              <section className="mb-8">
                <div className="rounded-xl border border-gray-800/50 border-dashed px-5 py-4 text-center">
                  <p className="text-gray-600 text-xs">
                    Dane USA (Fed Rate, CPI, 10Y Treasury) niedostępne.
                  </p>
                  <p className="text-gray-700 text-xs mt-1 font-mono">
                    Skonfiguruj: <code>supabase secrets set FRED_API_KEY=klucz</code>
                    {" · "}
                    <a
                      href="https://fred.stlouisfed.org/docs/api/api_key.html"
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:text-blue-500"
                    >
                      Bezpłatny klucz →
                    </a>
                  </p>
                </div>
              </section>
            )}

            {/* AI Interpretation */}
            <MacroInterpretation indicators={allIndicators} />
          </>
        )}

      </div>
    </div>
  );
}
