"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface CompanyResult {
  ticker: string;
  name:   string;
  sector: string | null;
  market: string | null;
  type:   "company";
}

interface EventResult {
  id:          number;
  ticker:      string;
  title:       string;
  event_type:  string | null;
  published_at:string | null;
  type:        "event";
}

interface SearchResults {
  companies: CompanyResult[];
  events:    EventResult[];
}

export default function GlobalSearch() {
  const [open,    setOpen]    = useState(false);
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState<SearchResults>({ companies: [], events: [] });
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef  = useRef<HTMLInputElement>(null);
  const router    = useRouter();

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setResults({ companies: [], events: [] });
      setSelected(0);
    }
  }, [open]);

  // Debounced search
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleInput(val: string) {
    setQuery(val);
    setSelected(0);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!val.trim() || val.length < 2) {
      setResults({ companies: [], events: [] });
      return;
    }
    setLoading(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(val)}`);
        const data = await res.json() as SearchResults;
        setResults(data);
      } catch { /* ignore */ }
      setLoading(false);
    }, 300);
  }

  const allResults: Array<{ label: string; sub: string; href: string }> = [
    ...results.companies.map(c => ({
      label: `${c.ticker} — ${c.name}`,
      sub:   c.sector ?? c.market ?? "Spółka",
      href:  `/companies/${c.ticker}`,
    })),
    ...results.events.map(e => ({
      label: `${e.ticker}: ${e.title}`,
      sub:   e.event_type ?? "Event",
      href:  `/companies/${e.ticker}#events`,
    })),
  ];

  function navigate(href: string) {
    setOpen(false);
    router.push(href);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected(s => Math.min(s + 1, allResults.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    if (e.key === "Enter" && allResults[selected]) navigate(allResults[selected].href);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md bg-gray-800/60 hover:bg-gray-800 border border-gray-700/50 text-gray-500 text-xs transition-colors"
      >
        <span>Szukaj…</span>
        <kbd className="text-[10px] bg-gray-700/60 px-1.5 py-0.5 rounded font-mono text-gray-400">⌘K</kbd>
      </button>
    );
  }

  const hasResults = allResults.length > 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
        onClick={() => setOpen(false)}
      />

      {/* Modal */}
      <div className="fixed top-[20vh] left-1/2 -translate-x-1/2 w-full max-w-lg z-50 px-4">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">
          {/* Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
            <span className="text-gray-500 text-lg">🔍</span>
            <input
              ref={inputRef}
              value={query}
              onChange={e => handleInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Szukaj spółki lub eventu… (PKN, CDR, Wyniki)"
              className="flex-1 bg-transparent text-white text-sm placeholder-gray-500 outline-none"
            />
            {loading && <span className="text-xs text-gray-600 animate-pulse">Szukam…</span>}
            <kbd
              onClick={() => setOpen(false)}
              className="text-[10px] bg-gray-800 px-1.5 py-0.5 rounded font-mono text-gray-500 cursor-pointer hover:text-gray-300"
            >
              Esc
            </kbd>
          </div>

          {/* Results */}
          {query.length >= 2 && (
            <div className="max-h-80 overflow-y-auto">
              {!hasResults && !loading ? (
                <div className="px-4 py-6 text-center text-gray-500 text-sm">Brak wyników dla „{query}"</div>
              ) : (
                <>
                  {results.companies.length > 0 && (
                    <>
                      <div className="px-4 py-2 text-[10px] font-semibold text-gray-600 uppercase tracking-widest bg-gray-900/80">
                        Spółki
                      </div>
                      {results.companies.map((c, i) => {
                        const idx = i;
                        return (
                          <button
                            key={c.ticker}
                            onClick={() => navigate(`/companies/${c.ticker}`)}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-800/60 transition-colors ${selected === idx ? "bg-gray-800/60" : ""}`}
                          >
                            <span className="font-mono font-bold text-white text-sm w-14 shrink-0">{c.ticker}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-gray-200 truncate">{c.name}</div>
                              <div className="text-xs text-gray-500">{c.sector ?? c.market}</div>
                            </div>
                            <span className="text-gray-600 text-xs">→</span>
                          </button>
                        );
                      })}
                    </>
                  )}

                  {results.events.length > 0 && (
                    <>
                      <div className="px-4 py-2 text-[10px] font-semibold text-gray-600 uppercase tracking-widest bg-gray-900/80">
                        Eventy
                      </div>
                      {results.events.map((e, i) => {
                        const idx = results.companies.length + i;
                        return (
                          <button
                            key={e.id}
                            onClick={() => navigate(`/companies/${e.ticker}`)}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-800/60 transition-colors ${selected === idx ? "bg-gray-800/60" : ""}`}
                          >
                            <span className="font-mono font-bold text-blue-400 text-sm w-14 shrink-0">{e.ticker}</span>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-gray-300 truncate">{e.title}</div>
                              <div className="text-xs text-gray-500">{e.event_type}</div>
                            </div>
                            <span className="text-gray-600 text-xs">→</span>
                          </button>
                        );
                      })}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Footer hint */}
          {query.length < 2 && (
            <div className="px-4 py-3 text-xs text-gray-600 flex gap-4">
              <span><kbd className="font-mono">↑↓</kbd> nawigacja</span>
              <span><kbd className="font-mono">↵</kbd> otwórz</span>
              <span><kbd className="font-mono">Esc</kbd> zamknij</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
