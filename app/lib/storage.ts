// app/lib/storage.ts
// localStorage helpers for favorites and recently visited companies.
// Safe to use in SSR — all functions check for window before accessing.

const FAVORITES_KEY = "gm_favorites";
const RECENT_KEY    = "gm_recent";
const RECENT_MAX    = 8;

export interface RecentCompany {
  ticker:  string;
  name:    string;
  visitedAt: string; // ISO
}

// ─── Favorites ────────────────────────────────────────────────────────────────

export function getFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function isFavorite(ticker: string): boolean {
  return getFavorites().includes(ticker);
}

export function toggleFavorite(ticker: string): boolean {
  const favs = getFavorites();
  const idx  = favs.indexOf(ticker);
  if (idx === -1) {
    favs.push(ticker);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
    return true;
  } else {
    favs.splice(idx, 1);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
    return false;
  }
}

// ─── Recently Visited ─────────────────────────────────────────────────────────

export function getRecentCompanies(): RecentCompany[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as RecentCompany[];
  } catch {
    return [];
  }
}

export function trackVisit(ticker: string, name: string): void {
  if (typeof window === "undefined") return;
  try {
    const recent  = getRecentCompanies().filter(r => r.ticker !== ticker);
    const updated = [{ ticker, name, visitedAt: new Date().toISOString() }, ...recent].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
  } catch {
    // ignore storage errors
  }
}
