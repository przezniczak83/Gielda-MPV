import Link    from "next/link";
import { createClient } from "@supabase/supabase-js";
import CorrelationMatrix from "../components/CorrelationMatrix";

export const revalidate = 3600; // ISR: 1 hour

const DEFAULT_TICKERS = [
  "PKO","PKN","PZU","KGH","PEO","SPL","LPP","DNP","ALE","CDR",
  "JSW","PGE","ENA","ATT","CPS","MBK","BDX","KRU","XTB","GPW",
];

async function getRiskInsights() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data } = await supabase
    .from("price_correlations")
    .select("ticker_a, ticker_b, correlation")
    .in("ticker_a", DEFAULT_TICKERS)
    .in("ticker_b", DEFAULT_TICKERS)
    .gte("correlation", 0.65)
    .order("correlation", { ascending: false })
    .limit(10);

  const { data: divergers } = await supabase
    .from("price_correlations")
    .select("ticker_a, ticker_b, correlation")
    .in("ticker_a", DEFAULT_TICKERS)
    .in("ticker_b", DEFAULT_TICKERS)
    .lte("correlation", -0.15)
    .order("correlation", { ascending: true })
    .limit(5);

  return {
    highCorr:   data ?? [],
    lowCorr:    divergers ?? [],
  };
}

export default async function HeatmapPage() {
  const { highCorr, lowCorr } = await getRiskInsights();

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-xs text-gray-600 mb-2">
            <Link href="/" className="hover:text-gray-400 transition-colors">Dashboard</Link>
            <span>/</span>
            <span className="text-gray-400">Heatmapa korelacji</span>
          </div>
          <h1 className="text-xl font-bold text-white">Heatmapa korelacji</h1>
          <p className="text-gray-500 text-xs mt-0.5">
            Korelacje cenowe między spółkami GPW (WIG20 + selekcja) — dane tygodniowe, 90 dni
          </p>
        </div>

        {/* Main layout: Matrix + Risk Insights sidebar */}
        <div className="flex flex-col xl:flex-row gap-6">

          {/* Matrix */}
          <div className="flex-1 min-w-0 rounded-xl border border-gray-800 bg-gray-900/40 p-5">
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
              Macierz korelacji
            </h2>
            <CorrelationMatrix />
          </div>

          {/* Risk Insights sidebar */}
          <div className="xl:w-72 shrink-0 flex flex-col gap-4">

            {/* High correlation = concentrated risk */}
            <div className="rounded-xl border border-red-800/30 bg-red-900/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm">⚠️</span>
                <h3 className="text-xs font-semibold text-red-400 uppercase tracking-widest">
                  Koncentracja ryzyka
                </h3>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                Pary spółek silnie skorelowanych (korelacja ≥ 0.65) — trzymanie obu może nie dywersyfikować portfela.
              </p>
              {highCorr.length === 0 ? (
                <div className="text-xs text-gray-600 text-center py-2">Brak danych</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {highCorr.map((r, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg bg-gray-900/60 border border-gray-800 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Link href={`/companies/${r.ticker_a}`} className="font-mono text-xs font-bold text-blue-400 hover:text-blue-300 transition-colors">
                          {r.ticker_a}
                        </Link>
                        <span className="text-gray-600 text-xs">↔</span>
                        <Link href={`/companies/${r.ticker_b}`} className="font-mono text-xs font-bold text-blue-400 hover:text-blue-300 transition-colors">
                          {r.ticker_b}
                        </Link>
                      </div>
                      <span className={`text-xs font-bold tabular-nums ${r.correlation >= 0.8 ? "text-red-400" : "text-orange-400"}`}>
                        {r.correlation.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Low/negative correlation = diversifiers */}
            <div className="rounded-xl border border-emerald-800/30 bg-emerald-900/10 p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm">✅</span>
                <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-widest">
                  Dywersyfikatory
                </h3>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                Pary z niską lub ujemną korelacją — dobre do dywersyfikacji portfela.
              </p>
              {lowCorr.length === 0 ? (
                <div className="text-xs text-gray-600 text-center py-2">Brak danych</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {lowCorr.map((r, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg bg-gray-900/60 border border-gray-800 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Link href={`/companies/${r.ticker_a}`} className="font-mono text-xs font-bold text-blue-400 hover:text-blue-300 transition-colors">
                          {r.ticker_a}
                        </Link>
                        <span className="text-gray-600 text-xs">↔</span>
                        <Link href={`/companies/${r.ticker_b}`} className="font-mono text-xs font-bold text-blue-400 hover:text-blue-300 transition-colors">
                          {r.ticker_b}
                        </Link>
                      </div>
                      <span className="text-emerald-400 text-xs font-bold tabular-nums">
                        {r.correlation.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Info box */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">
                Jak czytać wykres?
              </h3>
              <div className="flex flex-col gap-1.5 text-xs text-gray-400">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-green-600 shrink-0" />
                  <span>Silna korelacja (+0.7 do +1.0)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-gray-700 shrink-0" />
                  <span>Brak korelacji (ok. 0)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-red-700 shrink-0" />
                  <span>Korelacja ujemna (−0.5 do −1.0)</span>
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
