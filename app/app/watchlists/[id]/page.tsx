"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams }  from "next/navigation";

interface Company { name: string; sector: string; market: string }
interface PriceRow { close: number; date: string }

interface WatchlistItem {
  ticker:             string;
  notes:              string | null;
  alert_price_above:  number | null;
  alert_price_below:  number | null;
  added_at:           string;
  companies:          Company | null;
  price_history:      PriceRow[] | null;
}

interface WatchlistDetail {
  id:          number;
  name:        string;
  description: string | null;
  items:       WatchlistItem[];
}

interface CompanyOption { ticker: string; name: string }

export default function WatchlistDetailPage() {
  const params   = useParams<{ id: string }>();
  const id       = params.id;

  const [list,     setList]     = useState<WatchlistDetail | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [addTicker, setAddTicker] = useState("");
  const [addNotes,  setAddNotes]  = useState("");
  const [adding,   setAdding]   = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch(`/api/watchlists/${id}`)
      .then(r => r.json())
      .then((d: WatchlistDetail) => { setList(d); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    load();
    fetch("/api/companies-list")
      .then(r => r.json())
      .then((d: CompanyOption[]) => {
        setCompanies(d);
        if (d.length > 0) setAddTicker(d[0].ticker);
      })
      .catch(() => {});
  }, [id]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addTicker) return;
    setAdding(true);
    try {
      await fetch(`/api/watchlists/${id}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ticker: addTicker, notes: addNotes }),
      });
      setAddNotes("");
      load();
    } finally { setAdding(false); }
  }

  async function handleRemove(ticker: string) {
    setRemoving(ticker);
    try {
      await fetch(`/api/watchlists/${id}`, {
        method:  "DELETE",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ticker }),
      });
      load();
    } finally { setRemoving(null); }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-600 animate-pulse">
      Ładowanie…
    </div>
  );

  if (!list) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center text-gray-500">
      Nie znaleziono watchlisty.
    </div>
  );

  const itemTickers = new Set(list.items.map(i => i.ticker));

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-4xl mx-auto px-6 py-10">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-gray-500 mb-8">
          <Link href="/watchlists" className="hover:text-gray-300 transition-colors">Watchlisty</Link>
          <span className="text-gray-700">/</span>
          <span className="text-gray-300 font-medium">{list.name}</span>
        </nav>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">{list.name}</h1>
          {list.description && <p className="text-gray-500 text-sm mt-1">{list.description}</p>}
        </div>

        {/* Add company form */}
        <form onSubmit={handleAdd} className="mb-8 rounded-xl border border-gray-800 bg-gray-900/40 p-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Dodaj spółkę</h2>
          <div className="flex gap-3 flex-wrap">
            <select
              value={addTicker} onChange={e => setAddTicker(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              {companies.filter(c => !itemTickers.has(c.ticker)).map(c => (
                <option key={c.ticker} value={c.ticker}>{c.ticker} — {c.name}</option>
              ))}
            </select>
            <input
              type="text" placeholder="Notatka (opcjonalnie)" value={addNotes}
              onChange={e => setAddNotes(e.target.value)}
              className="flex-1 min-w-48 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
            <button type="submit" disabled={adding}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors whitespace-nowrap">
              {adding ? "Dodaję…" : "+ Dodaj"}
            </button>
          </div>
        </form>

        {/* Items table */}
        {list.items.length === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-16 text-center text-gray-500">
            Watchlista jest pusta. Dodaj pierwszą spółkę powyżej.
          </div>
        ) : (
          <div className="rounded-xl border border-gray-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/60">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-widest">Ticker</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-widest">Nazwa</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-widest">Cena</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-widest">Notatka</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {list.items.map(item => {
                  const latestPrice = item.price_history?.[0];
                  const comp        = item.companies;
                  return (
                    <tr key={item.ticker} className="hover:bg-gray-900/40 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/companies/${item.ticker}`}
                          className="font-mono font-bold text-white hover:text-blue-400 transition-colors">
                          {item.ticker}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-300 max-w-[160px] truncate">
                        {comp?.name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-white">
                        {latestPrice ? `${Number(latestPrice.close).toFixed(2)} PLN` : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-[160px] truncate">
                        {item.notes ?? ""}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleRemove(item.ticker)}
                          disabled={removing === item.ticker}
                          className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
                        >
                          {removing === item.ticker ? "…" : "Usuń"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
