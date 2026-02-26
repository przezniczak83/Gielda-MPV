"use client";

import { useEffect, useState } from "react";

interface TickerItem {
  ticker:    string;
  name:      string;
  price:     string;
  change:    string;
  changePct: string;
}

export default function TickerTape() {
  const [items, setItems] = useState<TickerItem[]>([]);

  useEffect(() => {
    fetch("/api/ticker-tape")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setItems(d); })
      .catch(() => {});

    // Refresh every 60 seconds
    const id = setInterval(() => {
      fetch("/api/ticker-tape")
        .then((r) => r.json())
        .then((d) => { if (Array.isArray(d)) setItems(d); })
        .catch(() => {});
    }, 60_000);

    return () => clearInterval(id);
  }, []);

  if (items.length === 0) return null;

  // Duplicate items so the scroll loop is seamless
  const doubled = [...items, ...items];

  return (
    <div className="bg-gray-900 border-b border-gray-800 h-8 overflow-hidden flex items-center">
      <div className="ticker-tape-track flex items-center gap-0 whitespace-nowrap">
        {doubled.map((item, i) => {
          const pos = parseFloat(item.changePct) >= 0;
          const colorClass = pos ? "text-emerald-400" : "text-red-400";
          return (
            <span key={i} className="inline-flex items-center gap-1.5 px-4 text-xs font-mono">
              <span className="text-gray-300 font-semibold">{item.ticker}</span>
              <span className="text-white">{item.price}</span>
              <span className={colorClass}>
                {pos ? "▲" : "▼"} {Math.abs(parseFloat(item.changePct)).toFixed(2)}%
              </span>
              <span className="text-gray-700 ml-2">|</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
