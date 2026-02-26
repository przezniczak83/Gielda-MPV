"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import FavoriteButton from "../components/FavoriteButton";
import FavoritesSection from "../components/FavoritesSection";

// ── Types ──────────────────────────────────────────────────────────────────────

type CompanyRow = {
  ticker:           string;
  name:             string;
  sector:           string | null;
  market:           string;
  last_news_at:     string | null;
  avg_sentiment_30d: number | null;
  news_count_30d:   number | null;
};

type SortKey = keyof CompanyRow | "";
type SortDir = "asc" | "desc";

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m    = Math.floor(diff / 60_000);
  if (m < 60)  return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function sentimentBadge(s: number | null) {
  if (s === null) return { cls: "text-gray-600", label: "—" };
  const label = `${s > 0 ? "+" : ""}${s.toFixed(2)}`;
  if (s >  0.3) return { cls: "text-emerald-400", label };
  if (s < -0.3) return { cls: "text-red-400", label };
  return { cls: "text-yellow-500", label };
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="text-gray-700 ml-1">↕</span>;
  return <span className="text-blue-400 ml-1">{dir === "asc" ? "↑" : "↓"}</span>;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [search,    setSearch]    = useState("");
  const [sector,    setSector]    = useState("");
  const [market,    setMarket]    = useState("");
  const [sortKey,   setSortKey]   = useState<SortKey>("");
  const [sortDir,   setSortDir]   = useState<SortDir>("desc");

  useEffect(() => {
    fetch("/api/companies-list")
      .then(r => r.json())
      .then((d: { companies: CompanyRow[] }) => setCompanies(d.companies ?? []))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Derived: unique sectors + markets for filter dropdowns
  const sectors = useMemo(() =>
    [...new Set(companies.map(c => c.sector).filter(Boolean) as string[])].sort(),
    [companies],
  );
  const markets = useMemo(() =>
    [...new Set(companies.map(c => c.market))].sort(),
    [companies],
  );

  // Filtered + sorted list
  const filtered = useMemo(() => {
    let list = companies;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c => c.ticker.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
    }
    if (sector) list = list.filter(c => c.sector === sector);
    if (market) list = list.filter(c => c.market === market);

    if (sortKey) {
      list = [...list].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return list;
  }, [companies, search, sector, market, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const gpw = filtered.filter(c => c.market === "GPW");
  const usa = filtered.filter(c => c.market !== "GPW");
  const all = companies;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <div className="max-w-5xl mx-auto px-6 py-10">
          <div className="h-8 w-48 bg-gray-800/50 rounded animate-pulse mb-6" />
          <div className="space-y-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-12 rounded bg-gray-800/50 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 text-red-400 p-8">
        Błąd pobierania danych: {error}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white">Spółki</h1>
          <p className="text-gray-500 mt-1 text-sm">{all.length} spółek w bazie</p>
        </div>

        {/* Favorites + recently visited (client) */}
        <FavoritesSection companies={all.map(c => ({ ticker: c.ticker, name: c.name }))} />

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-xl border border-gray-800 bg-gray-900/30">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Szukaj ticker / nazwa…"
            className="w-48 px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
          />
          <select
            value={sector}
            onChange={e => setSector(e.target.value)}
            className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-300 focus:outline-none focus:border-gray-500"
          >
            <option value="">Wszystkie sektory</option>
            {sectors.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={market}
            onChange={e => setMarket(e.target.value)}
            className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-300 focus:outline-none focus:border-gray-500"
          >
            <option value="">Wszystkie rynki</option>
            {markets.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          {(search || sector || market) && (
            <button
              onClick={() => { setSearch(""); setSector(""); setMarket(""); }}
              className="px-2 py-1 rounded bg-gray-800 border border-gray-700 text-xs text-gray-400 hover:text-white transition-colors"
            >
              ✕ Wyczyść
            </button>
          )}
          <span className="ml-auto text-[10px] text-gray-600">
            {filtered.length} / {all.length} spółek
          </span>
        </div>

        {gpw.length > 0 && (
          <CompanyTable title="GPW" rows={gpw} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
        )}
        {usa.length > 0 && (
          <CompanyTable title="USA" rows={usa} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
        )}
        {filtered.length === 0 && (
          <div className="py-12 text-center text-gray-600 text-sm">
            Brak spółek spełniających kryteria
          </div>
        )}
      </div>
    </div>
  );
}

// ── CompanyTable ───────────────────────────────────────────────────────────────

function CompanyTable({
  title,
  rows,
  sortKey,
  sortDir,
  onSort,
}: {
  title:   string;
  rows:    CompanyRow[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort:  (key: SortKey) => void;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="mb-10">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-3">
        {title} <span className="text-gray-700 font-normal">({rows.length})</span>
      </h2>
      <div className="rounded-xl border border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60">
                <Th sortable sortKey="ticker" active={sortKey === "ticker"} dir={sortDir} onSort={onSort} className="w-24">
                  Ticker
                </Th>
                <Th sortable sortKey="name" active={sortKey === "name"} dir={sortDir} onSort={onSort}>
                  Nazwa
                </Th>
                <Th sortable sortKey="sector" active={sortKey === "sector"} dir={sortDir} onSort={onSort} className="hidden sm:table-cell">
                  Sektor
                </Th>
                <Th sortable sortKey="avg_sentiment_30d" active={sortKey === "avg_sentiment_30d"} dir={sortDir} onSort={onSort} className="hidden md:table-cell w-28">
                  Sentiment
                </Th>
                <Th sortable sortKey="news_count_30d" active={sortKey === "news_count_30d"} dir={sortDir} onSort={onSort} className="hidden md:table-cell w-24">
                  Newsy (30d)
                </Th>
                <Th sortable sortKey="last_news_at" active={sortKey === "last_news_at"} dir={sortDir} onSort={onSort} className="hidden lg:table-cell w-28">
                  Ostatni news
                </Th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => {
                const sent = sentimentBadge(c.avg_sentiment_30d);
                return (
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
                    <td className="px-4 py-3 text-sm text-gray-200 max-w-[200px]">
                      <div className="truncate">{c.name}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 hidden sm:table-cell">
                      {c.sector ?? "—"}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={`text-xs font-mono tabular-nums ${sent.cls}`}>
                        {sent.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {c.news_count_30d !== null && c.news_count_30d > 0 ? (
                        <span className="text-xs text-gray-400 tabular-nums">{c.news_count_30d}</span>
                      ) : (
                        <span className="text-xs text-gray-700">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-[10px] text-gray-600 tabular-nums">
                        {timeAgo(c.last_news_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <FavoriteButton ticker={c.ticker} size="sm" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Th ────────────────────────────────────────────────────────────────────────

function Th({
  children,
  className = "",
  sortable = false,
  sortKey,
  active,
  dir,
  onSort,
}: {
  children:   React.ReactNode;
  className?: string;
  sortable?:  boolean;
  sortKey?:   SortKey;
  active?:    boolean;
  dir?:       SortDir;
  onSort?:    (key: SortKey) => void;
}) {
  return (
    <th
      className={`text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-3 ${
        sortable ? "cursor-pointer select-none hover:text-gray-300 transition-colors" : ""
      } ${className}`}
      onClick={sortable && sortKey ? () => onSort?.(sortKey) : undefined}
    >
      {children}
      {sortable && sortKey && <SortIcon active={active ?? false} dir={dir ?? "desc"} />}
    </th>
  );
}
