import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const revalidate = 600; // ISR: 10 minutes — company list rarely changes

export default async function CompaniesPage() {
  const { data: companies, error } = await supabase
    .from("companies")
    .select("ticker, name, sector, market")
    .order("market")
    .order("ticker");

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 text-red-400 p-8">
        Błąd pobierania danych: {error.message}
      </div>
    );
  }

  const gpw = (companies ?? []).filter((c) => c.market === "GPW");
  const usa = (companies ?? []).filter((c) => c.market === "USA");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Spółki</h1>
          <p className="text-gray-500 mt-1 text-sm">{companies?.length ?? 0} spółek w bazie</p>
        </div>

        <CompanyTable title="GPW" rows={gpw} />
        <CompanyTable title="USA" rows={usa} />
      </div>
    </div>
  );
}

type CompanyRow = {
  ticker: string;
  name: string;
  sector: string | null;
  market: string;
};

function CompanyTable({ title, rows }: { title: string; rows: CompanyRow[] }) {
  if (rows.length === 0) return null;

  return (
    <div className="mb-10">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-3">
        {title}
      </h2>
      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900/60">
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 w-24">
                Ticker
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3">
                Nazwa
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 hidden sm:table-cell">
                Sektor
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 w-20">
                Rynek
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr
                key={c.ticker}
                className={`border-b border-gray-800/50 hover:bg-gray-900/80 transition-colors ${
                  i === rows.length - 1 ? "border-b-0" : ""
                }`}
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/companies/${c.ticker}`}
                    className="font-mono font-bold text-blue-400 hover:text-blue-300 transition-colors text-sm"
                  >
                    {c.ticker}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-gray-200">{c.name}</td>
                <td className="px-4 py-3 text-sm text-gray-500 hidden sm:table-cell">
                  {c.sector ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 font-mono">
                    {c.market}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
