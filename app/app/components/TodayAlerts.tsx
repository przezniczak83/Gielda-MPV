"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface AlertItem {
  ticker:     string;
  title:      string;
  alerted_at: string;
  impact_score: number | null;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60)  return `${mins}m temu`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs}h temu`;
  return new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "short" });
}

export default function TodayAlerts() {
  const [items, setItems]     = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    fetch(`/api/today-alerts?since=${encodeURIComponent(todayStart)}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setItems(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 animate-pulse h-48" />
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
          Alerty dziś
        </h2>
        <Link href="/alerts" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
          Wszystkie →
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-6">Brak alertów dziś</div>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
          {items.map((a, i) => {
            const score = a.impact_score ?? 0;
            const dotColor =
              score >= 7 ? "bg-red-500" :
              score >= 4 ? "bg-yellow-500" :
              "bg-gray-500";
            return (
              <div key={i} className="flex items-start gap-2.5 rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2">
                <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${dotColor}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/companies/${a.ticker}`}
                      className="font-mono font-bold text-blue-400 hover:text-blue-300 text-xs transition-colors"
                    >
                      {a.ticker}
                    </Link>
                    <span className="text-gray-600 text-xs">{timeAgo(a.alerted_at)}</span>
                  </div>
                  <div className="text-xs text-gray-400 truncate mt-0.5">{a.title}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
