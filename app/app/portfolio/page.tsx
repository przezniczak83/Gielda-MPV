"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface PortfolioPosition {
  id:             number;
  ticker:         string;
  company_name:   string | null;
  shares:         number;
  avg_buy_price:  number;
  current_price:  number | null;
  market_value:   number | null;
  unrealized_pnl: number | null;
  pnl_pct:        number | null;
  currency:       string;
  opened_at:      string;
  notes:          string | null;
}

interface Company { ticker: string; name: string }

interface PortfolioEvent {
  id:           string;
  ticker:       string;
  title:        string;
  event_type:   string | null;
  impact_score: number | null;
  published_at: string | null;
}

function pnlColor(val: number | null): string {
  if (val == null) return "text-gray-400";
  return val >= 0 ? "text-green-400" : "text-red-400";
}

function fmtNum(val: number | null, decimals = 2): string {
  if (val == null) return "—";
  return val.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export default function PortfolioPage() {
  const [positions,   setPositions]   = useState<PortfolioPosition[]>([]);
  const [companies,   setCompanies]   = useState<Company[]>([]);
  const [events,      setEvents]      = useState<PortfolioEvent[]>([]);
  const [loading,     setLoading]     = useState(true);

  // Form state
  const [ticker,        setTicker]        = useState("");
  const [shares,        setShares]        = useState("");
  const [avgBuyPrice,   setAvgBuyPrice]   = useState("");
  const [notes,         setNotes]         = useState("");
  const [adding,        setAdding]        = useState(false);
  const [removing,      setRemoving]      = useState<number | null>(null);
  const [addError,      setAddError]      = useState("");

  async function loadPositions() {
    setLoading(true);
    try {
      const [posRes, compRes] = await Promise.all([
        fetch("/api/portfolio"),
        fetch("/api/companies-list"),
      ]);
      const pos  = await posRes.json()  as PortfolioPosition[];
      const comp = await compRes.json() as Company[];
      setPositions(pos);
      setCompanies(comp);
      if (comp.length > 0 && !ticker) setTicker(comp[0].ticker);

      // Fetch events for portfolio tickers
      if (pos.length > 0) {
        const tickers = pos.map(p => p.ticker).join(",");
        const evRes = await fetch(`/api/portfolio/events?tickers=${tickers}`);
        if (evRes.ok) setEvents(await evRes.json() as PortfolioEvent[]);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { loadPositions(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    if (!ticker || !shares || !avgBuyPrice) return;
    setAdding(true);
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          shares:         parseFloat(shares),
          avg_buy_price:  parseFloat(avgBuyPrice),
          notes:          notes || undefined,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) { setAddError(json.error ?? "Błąd"); return; }
      setShares(""); setAvgBuyPrice(""); setNotes("");
      await loadPositions();
    } finally { setAdding(false); }
  }

  async function handleRemove(id: number) {
    setRemoving(id);
    try {
      await fetch("/api/portfolio", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await loadPositions();
    } finally { setRemoving(null); }
  }

  // Summary stats
  const totalValue = positions.reduce((s, p) => s + (p.market_value ?? 0), 0);
  const totalPnl   = positions.reduce((s, p) => s + (p.unrealized_pnl ?? 0), 0);
  const totalCost  = positions.reduce((s, p) => s + p.avg_buy_price * p.shares, 0);
  const totalPct   = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-5xl mx-auto px-6 py-10">

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Portfel</h1>
          <p className="text-gray-500 text-sm mt-1">Śledź pozycje i wyniki inwestycyjne</p>
        </div>

        {/* ── Summary cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { label: "Wartość portfela", value: totalValue > 0 ? `${fmtNum(totalValue)} PLN` : "—", color: "text-white" },
            { label: "Całkowity PnL",    value: positions.length > 0 ? `${totalPnl >= 0 ? "+" : ""}${fmtNum(totalPnl)} PLN` : "—", color: pnlColor(totalPnl) },
            { label: "Zwrot %",          value: positions.length > 0 ? `${totalPct >= 0 ? "+" : ""}${totalPct.toFixed(2)}%` : "—", color: pnlColor(totalPct) },
            { label: "Pozycje",          value: String(positions.length), color: "text-white" },
          ].map(card => (
            <div key={card.label} className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3">
              <div className="text-xs text-gray-500 mb-1">{card.label}</div>
              <div className={`text-xl font-bold tabular-nums ${card.color}`}>{card.value}</div>
            </div>
          ))}
        </div>

        {/* ── Positions table ── */}
        {loading ? (
          <div className="text-center py-12 text-gray-600 animate-pulse">Ładowanie…</div>
        ) : positions.length === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 py-12 text-center text-gray-500 mb-8">
            Brak pozycji. Dodaj pierwszą spółkę poniżej.
          </div>
        ) : (
          <div className="rounded-xl border border-gray-800 overflow-hidden mb-8">
            <table className="w-full text-sm">
              <thead className="bg-gray-900/60">
                <tr>
                  {["Ticker", "Nazwa", "Akcji", "Śr. cena", "Akt. cena", "Wartość", "PnL", "PnL %", ""].map(h => (
                    <th key={h} className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-widest ${h === "" ? "" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/60">
                {positions.map(p => (
                  <tr key={p.id} className="hover:bg-gray-900/40 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/companies/${p.ticker}`} className="font-mono font-bold text-white hover:text-blue-400 transition-colors">
                        {p.ticker}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs max-w-[120px] truncate">{p.company_name ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-300">{p.shares}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-300 font-mono">{fmtNum(p.avg_buy_price)}</td>
                    <td className="px-4 py-3 tabular-nums text-white font-mono">{p.current_price != null ? fmtNum(p.current_price) : "—"}</td>
                    <td className="px-4 py-3 tabular-nums text-gray-200 font-mono">{p.market_value != null ? `${fmtNum(p.market_value)} PLN` : "—"}</td>
                    <td className={`px-4 py-3 tabular-nums font-mono font-semibold ${pnlColor(p.unrealized_pnl)}`}>
                      {p.unrealized_pnl != null ? `${p.unrealized_pnl >= 0 ? "+" : ""}${fmtNum(p.unrealized_pnl)} PLN` : "—"}
                    </td>
                    <td className={`px-4 py-3 tabular-nums font-semibold ${pnlColor(p.pnl_pct)}`}>
                      {p.pnl_pct != null ? `${p.pnl_pct >= 0 ? "+" : ""}${p.pnl_pct.toFixed(2)}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleRemove(p.id)}
                        disabled={removing === p.id}
                        className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
                      >
                        {removing === p.id ? "…" : "Zamknij"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Add position form ── */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-5 mb-8">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">Dodaj pozycję</h2>
          <form onSubmit={handleAdd} className="flex gap-3 flex-wrap items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Ticker</label>
              <select
                value={ticker}
                onChange={e => setTicker(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 min-w-40"
              >
                {companies.map(c => (
                  <option key={c.ticker} value={c.ticker}>{c.ticker} — {c.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Liczba akcji</label>
              <input
                type="number" step="0.0001" min="0.0001" placeholder="100"
                value={shares} onChange={e => setShares(e.target.value)} required
                className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 w-28"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Śr. cena kupna (PLN)</label>
              <input
                type="number" step="0.01" min="0.01" placeholder="45.50"
                value={avgBuyPrice} onChange={e => setAvgBuyPrice(e.target.value)} required
                className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 w-32"
              />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-32">
              <label className="text-xs text-gray-500">Notatka</label>
              <input
                type="text" placeholder="Opcjonalnie"
                value={notes} onChange={e => setNotes(e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              type="submit" disabled={adding}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors whitespace-nowrap"
            >
              {adding ? "Dodaję…" : "+ Dodaj do portfela"}
            </button>
          </form>
          {addError && <p className="mt-2 text-xs text-red-400">{addError}</p>}
        </div>

        {/* ── Portfolio alerts (recent events) ── */}
        {events.length > 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Ostatnie alerty portfela</h2>
            <div className="space-y-2">
              {events.slice(0, 5).map(ev => (
                <div key={ev.id} className="flex items-start gap-3 text-sm">
                  <span className="text-yellow-400 shrink-0">⚠️</span>
                  <span className="font-mono font-bold text-white shrink-0 w-12">{ev.ticker}</span>
                  <span className="text-gray-400 flex-1 truncate">{ev.title}</span>
                  {ev.impact_score != null && (
                    <span className={`text-xs font-bold shrink-0 ${ev.impact_score >= 7 ? "text-red-400" : ev.impact_score >= 4 ? "text-yellow-400" : "text-gray-500"}`}>
                      {ev.impact_score}/10
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
