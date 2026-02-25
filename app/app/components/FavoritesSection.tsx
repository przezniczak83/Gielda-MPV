"use client";

// FavoritesSection — shows favorites + recently visited on companies list page.
// Reads from localStorage, updates on favorites-changed event.

import { useState, useEffect } from "react";
import Link from "next/link";
import { getFavorites, getRecentCompanies, type RecentCompany } from "@/lib/storage";
import FavoriteButton from "./FavoriteButton";

interface CompanyInfo {
  ticker: string;
  name:   string;
}

interface Props {
  // All companies from server for name lookup
  companies: CompanyInfo[];
}

export default function FavoritesSection({ companies }: Props) {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent,    setRecent]    = useState<RecentCompany[]>([]);

  function refresh() {
    setFavorites(getFavorites());
    setRecent(getRecentCompanies());
  }

  useEffect(() => {
    refresh();
    window.addEventListener("favorites-changed", refresh);
    return () => window.removeEventListener("favorites-changed", refresh);
  }, []);

  const nameMap = new Map(companies.map(c => [c.ticker, c.name]));

  if (favorites.length === 0 && recent.length === 0) return null;

  return (
    <div className="mb-8 space-y-4">
      {favorites.length > 0 && (
        <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-4">
          <h2 className="text-xs font-semibold text-yellow-500/70 uppercase tracking-widest mb-3 flex items-center gap-2">
            <span>★</span> Ulubione
          </h2>
          <div className="flex flex-wrap gap-2">
            {favorites.map(ticker => (
              <div key={ticker} className="flex items-center gap-1.5">
                <Link
                  href={`/companies/${ticker}`}
                  className="px-3 py-1.5 rounded-lg bg-gray-800/80 border border-gray-700 text-sm text-blue-400 hover:text-blue-300 hover:border-blue-500/40 transition-colors font-mono font-semibold"
                >
                  {ticker}
                  {nameMap.has(ticker) && (
                    <span className="text-gray-500 font-normal ml-1.5 text-xs">{nameMap.get(ticker)}</span>
                  )}
                </Link>
                <FavoriteButton ticker={ticker} size="sm" />
              </div>
            ))}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/20 p-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
            <span>🕐</span> Ostatnio przeglądane
          </h2>
          <div className="flex flex-wrap gap-2">
            {recent.map(r => (
              <Link
                key={r.ticker}
                href={`/companies/${r.ticker}`}
                className="px-3 py-1.5 rounded-lg bg-gray-800/60 border border-gray-800 text-sm text-gray-300 hover:text-gray-100 hover:border-gray-600 transition-colors font-mono"
              >
                {r.ticker}
                {r.name && (
                  <span className="text-gray-600 font-normal ml-1.5 text-xs hidden sm:inline">{r.name}</span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
