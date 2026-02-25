import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const revalidate = 60; // ISR: 1 minute — alerts change frequently

type AlertRow = {
  ticker:       string;
  title:        string;
  event_type:   string | null;
  impact_score: number;
  published_at: string | null;
  created_at:   string;
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pl-PL", {
    day:   "2-digit",
    month: "short",
    year:  "numeric",
  });
}

function ImpactBadge({ score }: { score: number }) {
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

export default async function AlertsPage() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const { data: alerts, error } = await supabase
    .from("company_events")
    .select("ticker, title, event_type, impact_score, published_at, created_at")
    .gte("impact_score", 7)
    .gt("created_at", sevenDaysAgo)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 text-red-400 p-8">
        Błąd: {error.message}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-5xl mx-auto px-6 py-10">

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">
            🚨 Alerty — wysokie impact score (7+)
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            Ostatnie 7 dni · {alerts?.length ?? 0} alert{(alerts?.length ?? 0) !== 1 ? "y" : ""}
          </p>
        </div>

        {!alerts?.length ? (
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-20 text-center text-gray-500">
            Brak alertów z impact score ≥ 7 w ostatnich 7 dniach
          </div>
        ) : (
          <div className="rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900/60">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">
                    Data
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">
                    Ticker
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">
                    Tytuł
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 hidden sm:table-cell">
                    Typ
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">
                    Score
                  </th>
                </tr>
              </thead>
              <tbody>
                {(alerts as AlertRow[]).map((a, i) => (
                  <tr
                    key={i}
                    className="border-b border-gray-800/50 last:border-b-0 hover:bg-gray-900/60 transition-colors"
                  >
                    <td className="px-4 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                      {formatDate(a.published_at || a.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/companies/${a.ticker}`}
                        className="font-mono font-bold text-blue-400 hover:text-blue-300 text-sm transition-colors"
                      >
                        {a.ticker}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-200 max-w-sm">
                      <div className="line-clamp-2">{a.title}</div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400">
                        {a.event_type ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ImpactBadge score={a.impact_score} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
