"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Watchlist {
  id:          number;
  name:        string;
  description: string | null;
  item_count:  number;
  created_at:  string;
}

export default function WatchlistsPage() {
  const [lists,    setLists]    = useState<Watchlist[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState("");
  const [newDesc,  setNewDesc]  = useState("");
  const [showForm, setShowForm] = useState(false);

  function load() {
    setLoading(true);
    fetch("/api/watchlists")
      .then(r => r.json())
      .then((d: Watchlist[]) => { setLists(d); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await fetch("/api/watchlists", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name: newName, description: newDesc }),
      });
      setNewName(""); setNewDesc(""); setShowForm(false);
      load();
    } finally { setCreating(false); }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-white">Watchlisty</h1>
          <button
            onClick={() => setShowForm(v => !v)}
            className="text-sm px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors"
          >
            + Utwórz nową
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="mb-8 rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-300">Nowa watchlista</h2>
            <input
              type="text" placeholder="Nazwa" value={newName} onChange={e => setNewName(e.target.value)}
              required
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
            <input
              type="text" placeholder="Opis (opcjonalny)" value={newDesc} onChange={e => setNewDesc(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
            <div className="flex gap-2">
              <button type="submit" disabled={creating}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors">
                {creating ? "Tworzę…" : "Utwórz"}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition-colors">
                Anuluj
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="text-center py-16 text-gray-600 animate-pulse">Ładowanie…</div>
        ) : (
          <div className="rounded-xl border border-gray-800 overflow-hidden divide-y divide-gray-800/60">
            {lists.map(list => (
              <Link
                key={list.id}
                href={`/watchlists/${list.id}`}
                className="flex items-center gap-4 px-5 py-4 hover:bg-gray-900/60 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{list.name}</div>
                  {list.description && (
                    <div className="text-xs text-gray-500 mt-0.5 truncate">{list.description}</div>
                  )}
                </div>
                <div className="text-xs text-gray-500 tabular-nums shrink-0">
                  {list.item_count} spółek
                </div>
                <span className="text-gray-600">→</span>
              </Link>
            ))}
            {!lists.length && (
              <div className="py-16 text-center text-gray-600">Brak watchlist</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
