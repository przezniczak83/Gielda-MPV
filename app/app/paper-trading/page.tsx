"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Portfolio {
  id:           number;
  name:         string;
  description:  string | null;
  initial_cash: number;
  cash_balance: number;
  created_at:   string;
  updated_at:   string;
}

interface Position {
  ticker:        string;
  quantity:      number;
  avg_cost:      number | null;
  total_invested:number | null;
  current_price: number | null;
  market_value:  number | null;
  pnl:           number | null;
  pnl_pct:       number | null;
}

interface Trade {
  id:          number;
  ticker:      string;
  direction:   "BUY" | "SELL";
  quantity:    number;
  price:       number;
  total_value: number;
  note:        string | null;
  traded_at:   string;
}

interface PortfolioDetail {
  portfolio:     Portfolio;
  positions:     Position[];
  trades:        Trade[];
  latest_prices: Record<string, number>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | null, decimals = 2): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("pl-PL", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function pnlColor(n: number | null): string {
  if (n === null) return "text-gray-500";
  return n >= 0 ? "text-green-400" : "text-red-400";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function PaperTradingPage() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [selected,   setSelected]   = useState<number | null>(null);
  const [detail,     setDetail]     = useState<PortfolioDetail | null>(null);
  const [loading,    setLoading]    = useState(true);

  // Trade form state
  const [tradeTicker,    setTradeTicker]    = useState("");
  const [tradeDirection, setTradeDirection] = useState<"BUY" | "SELL">("BUY");
  const [tradeQty,       setTradeQty]       = useState("");
  const [tradePrice,     setTradePrice]     = useState("");
  const [tradeNote,      setTradeNote]      = useState("");
  const [tradeError,     setTradeError]     = useState("");
  const [trading,        setTrading]        = useState(false);

  // New portfolio form
  const [showCreate,    setShowCreate]    = useState(false);
  const [newName,       setNewName]       = useState("Mój Portfel");
  const [newCash,       setNewCash]       = useState("100000");
  const [creating,      setCreating]      = useState(false);

  const loadPortfolios = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/paper-trading");
      const data = await res.json() as Portfolio[];
      setPortfolios(Array.isArray(data) ? data : []);
      if (Array.isArray(data) && data.length > 0 && !selected) {
        setSelected(data[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [selected]);

  const loadDetail = useCallback(async (id: number) => {
    const res = await fetch(`/api/paper-trading?portfolio_id=${id}`);
    const data = await res.json() as PortfolioDetail;
    setDetail(data);
  }, []);

  useEffect(() => { void loadPortfolios(); }, [loadPortfolios]);

  useEffect(() => {
    if (selected) void loadDetail(selected);
  }, [selected, loadDetail]);

  async function handleTrade(e: React.FormEvent) {
    e.preventDefault();
    setTradeError("");
    if (!selected || !tradeTicker || !tradeQty || !tradePrice) {
      setTradeError("Uzupełnij ticker, ilość i cenę");
      return;
    }
    setTrading(true);
    try {
      const res = await fetch("/api/paper-trading", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          action:       "trade",
          portfolio_id: selected,
          ticker:       tradeTicker.toUpperCase(),
          direction:    tradeDirection,
          quantity:     parseInt(tradeQty),
          price:        parseFloat(tradePrice),
          note:         tradeNote || null,
        }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (!json.ok) {
        setTradeError(json.error ?? "Błąd transakcji");
        return;
      }
      setTradeTicker("");
      setTradeQty("");
      setTradePrice("");
      setTradeNote("");
      void loadDetail(selected);
    } finally {
      setTrading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/api/paper-trading", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          action:       "create_portfolio",
          name:         newName,
          initial_cash: parseFloat(newCash) || 100000,
        }),
      });
      const json = await res.json() as { ok?: boolean; portfolio?: Portfolio; error?: string };
      if (json.ok && json.portfolio) {
        setPortfolios(prev => [...prev, json.portfolio!]);
        setSelected(json.portfolio!.id);
        setShowCreate(false);
        setNewName("Mój Portfel");
        setNewCash("100000");
      }
    } finally {
      setCreating(false);
    }
  }

  // Summary for detail
  const totalMarketValue = detail?.positions.reduce((s, p) => s + (p.market_value ?? 0), 0) ?? 0;
  const totalPnl         = detail?.positions.reduce((s, p) => s + (p.pnl ?? 0), 0) ?? 0;
  const totalValue       = totalMarketValue + (detail?.portfolio.cash_balance ?? 0);
  const totalReturn      = detail ? totalValue - (detail.portfolio.initial_cash) : 0;
  const totalReturnPct   = detail ? (totalReturn / detail.portfolio.initial_cash) * 100 : 0;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-6xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Paper Trading</h1>
            <p className="text-gray-500 text-sm mt-1">Wirtualne inwestowanie bez ryzyka</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="text-sm px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors font-medium"
          >
            + Nowy portfel
          </button>
        </div>

        {/* Create portfolio form */}
        {showCreate && (
          <form onSubmit={handleCreate} className="mb-8 rounded-xl border border-gray-700 bg-gray-900/60 px-6 py-5 space-y-4">
            <h3 className="text-sm font-semibold text-white">Nowy portfel</h3>
            <div className="flex gap-4 flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <label className="text-xs text-gray-500 mb-1 block">Nazwa *</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="w-40">
                <label className="text-xs text-gray-500 mb-1 block">Kapitał startowy (PLN)</label>
                <input
                  type="number"
                  min="1000"
                  value={newCash}
                  onChange={e => setNewCash(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white tabular-nums focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={creating} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors">
                {creating ? "Tworzę..." : "Utwórz portfel"}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors">
                Anuluj
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="text-center py-16 text-gray-600 animate-pulse">Ładowanie…</div>
        ) : portfolios.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            Brak portfeli. Utwórz swój pierwszy portfel do paper tradingu.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Portfolio selector */}
            <div className="flex gap-2 flex-wrap">
              {portfolios.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelected(p.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    selected === p.id
                      ? "border-blue-500 bg-blue-500/10 text-blue-300"
                      : "border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>

            {detail && (
              <>
                {/* Portfolio summary */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3">
                    <div className="text-xs text-gray-500 mb-1">Gotówka</div>
                    <div className="text-xl font-bold tabular-nums text-white">{fmt(detail.portfolio.cash_balance)} PLN</div>
                  </div>
                  <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3">
                    <div className="text-xs text-gray-500 mb-1">Akcje (wartość)</div>
                    <div className="text-xl font-bold tabular-nums text-white">{totalMarketValue > 0 ? `${fmt(totalMarketValue)} PLN` : "—"}</div>
                  </div>
                  <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3">
                    <div className="text-xs text-gray-500 mb-1">Wartość portfela</div>
                    <div className="text-xl font-bold tabular-nums text-white">{fmt(totalValue)} PLN</div>
                  </div>
                  <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3">
                    <div className="text-xs text-gray-500 mb-1">Zwrot całkowity</div>
                    <div className={`text-xl font-bold tabular-nums ${pnlColor(totalReturn)}`}>
                      {totalReturn >= 0 ? "+" : ""}{fmt(totalReturn)} PLN
                      <span className="text-xs ml-1">({totalReturnPct >= 0 ? "+" : ""}{fmt(totalReturnPct, 1)}%)</span>
                    </div>
                  </div>
                </div>

                {/* Trade form */}
                <div className="rounded-xl border border-gray-800 bg-gray-900/30 px-5 py-4">
                  <h3 className="text-sm font-semibold text-gray-300 mb-3">Złóż zlecenie</h3>
                  <form onSubmit={handleTrade} className="flex flex-wrap gap-3 items-end">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Kierunek</label>
                      <div className="flex rounded-lg overflow-hidden border border-gray-700">
                        <button
                          type="button"
                          onClick={() => setTradeDirection("BUY")}
                          className={`px-4 py-2 text-sm font-bold transition-colors ${tradeDirection === "BUY" ? "bg-green-600 text-white" : "bg-gray-800 text-gray-500 hover:text-gray-300"}`}
                        >
                          KUP
                        </button>
                        <button
                          type="button"
                          onClick={() => setTradeDirection("SELL")}
                          className={`px-4 py-2 text-sm font-bold transition-colors ${tradeDirection === "SELL" ? "bg-red-600 text-white" : "bg-gray-800 text-gray-500 hover:text-gray-300"}`}
                        >
                          SPRZEDAJ
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Ticker</label>
                      <input
                        type="text"
                        required
                        placeholder="np. PKN"
                        value={tradeTicker}
                        onChange={e => setTradeTicker(e.target.value.toUpperCase())}
                        className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Ilość akcji</label>
                      <input
                        type="number"
                        required
                        min="1"
                        placeholder="100"
                        value={tradeQty}
                        onChange={e => setTradeQty(e.target.value)}
                        className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white tabular-nums focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Cena (PLN)</label>
                      <input
                        type="number"
                        required
                        min="0.01"
                        step="0.01"
                        placeholder="50.00"
                        value={tradePrice}
                        onChange={e => setTradePrice(e.target.value)}
                        className="w-28 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white tabular-nums focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="flex-1 min-w-[140px]">
                      <label className="text-xs text-gray-500 mb-1 block">Notatka</label>
                      <input
                        type="text"
                        placeholder="opcjonalnie"
                        value={tradeNote}
                        onChange={e => setTradeNote(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={trading}
                      className={`px-5 py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 ${
                        tradeDirection === "BUY"
                          ? "bg-green-600 hover:bg-green-500 text-white"
                          : "bg-red-600 hover:bg-red-500 text-white"
                      }`}
                    >
                      {trading ? "Realizuję..." : tradeDirection === "BUY" ? "Kup" : "Sprzedaj"}
                    </button>
                  </form>
                  {tradeError && (
                    <p className="text-red-400 text-xs mt-2">{tradeError}</p>
                  )}
                  {tradeQty && tradePrice && (
                    <p className="text-xs text-gray-600 mt-2 tabular-nums">
                      Wartość: {fmt(parseFloat(tradeQty || "0") * parseFloat(tradePrice || "0"))} PLN
                    </p>
                  )}
                </div>

                {/* Positions */}
                {detail.positions.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">Pozycje ({detail.positions.length})</h3>
                    <div className="rounded-xl border border-gray-800 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-800 bg-gray-900/60">
                            <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Ticker</th>
                            <th className="text-right text-xs font-semibold text-gray-500 uppercase px-4 py-3">Ilość</th>
                            <th className="text-right text-xs font-semibold text-gray-500 uppercase px-4 py-3">Śr. koszt</th>
                            <th className="text-right text-xs font-semibold text-gray-500 uppercase px-4 py-3">Cena akt.</th>
                            <th className="text-right text-xs font-semibold text-gray-500 uppercase px-4 py-3">Wartość</th>
                            <th className="text-right text-xs font-semibold text-gray-500 uppercase px-4 py-3">P&amp;L</th>
                            <th className="text-right text-xs font-semibold text-gray-500 uppercase px-4 py-3 hidden sm:table-cell">%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.positions.map(p => (
                            <tr key={p.ticker} className="border-b border-gray-800/50 last:border-b-0 hover:bg-gray-900/40 transition-colors">
                              <td className="px-4 py-3">
                                <Link href={`/companies/${p.ticker}`} className="font-mono font-bold text-blue-400 hover:text-blue-300 transition-colors">
                                  {p.ticker}
                                </Link>
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums text-gray-300">{p.quantity}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-gray-400">{fmt(p.avg_cost, 4)}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-gray-300">{p.current_price !== null ? fmt(p.current_price, 2) : "—"}</td>
                              <td className="px-4 py-3 text-right tabular-nums text-white font-medium">{p.market_value !== null ? fmt(p.market_value) : "—"}</td>
                              <td className={`px-4 py-3 text-right tabular-nums font-bold ${pnlColor(p.pnl)}`}>
                                {p.pnl !== null ? `${p.pnl >= 0 ? "+" : ""}${fmt(p.pnl)}` : "—"}
                              </td>
                              <td className={`px-4 py-3 text-right tabular-nums hidden sm:table-cell ${pnlColor(p.pnl_pct)}`}>
                                {p.pnl_pct !== null ? `${p.pnl_pct >= 0 ? "+" : ""}${fmt(p.pnl_pct, 1)}%` : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {totalPnl !== 0 && (
                      <p className={`text-xs mt-2 text-right tabular-nums font-bold ${pnlColor(totalPnl)}`}>
                        Łączny P&L na akcjach: {totalPnl >= 0 ? "+" : ""}{fmt(totalPnl)} PLN
                      </p>
                    )}
                  </div>
                )}

                {detail.positions.length === 0 && (
                  <div className="rounded-xl border border-dashed border-gray-800 py-12 text-center text-gray-600 text-sm">
                    Brak otwartych pozycji — kup pierwsze akcje powyżej
                  </div>
                )}

                {/* Trade history */}
                {detail.trades.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">Historia transakcji ({detail.trades.length})</h3>
                    <div className="rounded-xl border border-gray-800 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-800 bg-gray-900/60">
                            <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Data</th>
                            <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Ticker</th>
                            <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3">Kier.</th>
                            <th className="text-right text-xs font-semibold text-gray-500 uppercase px-4 py-3">Ilość</th>
                            <th className="text-right text-xs font-semibold text-gray-500 uppercase px-4 py-3">Cena</th>
                            <th className="text-right text-xs font-semibold text-gray-500 uppercase px-4 py-3">Wartość</th>
                            <th className="text-left text-xs font-semibold text-gray-500 uppercase px-4 py-3 hidden sm:table-cell">Notatka</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.trades.map(t => (
                            <tr key={t.id} className="border-b border-gray-800/50 last:border-b-0 hover:bg-gray-900/40 transition-colors">
                              <td className="px-4 py-2.5 text-xs text-gray-500">{formatDate(t.traded_at)}</td>
                              <td className="px-4 py-2.5">
                                <Link href={`/companies/${t.ticker}`} className="font-mono font-bold text-sm text-blue-400 hover:text-blue-300 transition-colors">
                                  {t.ticker}
                                </Link>
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                                  t.direction === "BUY"
                                    ? "bg-green-500/15 text-green-400"
                                    : "bg-red-500/15 text-red-400"
                                }`}>
                                  {t.direction}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-gray-300">{t.quantity}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">{fmt(t.price, 4)}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-white font-medium">{fmt(t.total_value)}</td>
                              <td className="px-4 py-2.5 text-xs text-gray-600 hidden sm:table-cell">{t.note ?? ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
