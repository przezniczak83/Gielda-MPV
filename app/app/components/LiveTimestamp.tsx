"use client";

// app/app/components/LiveTimestamp.tsx
// Displays a human-readable relative time label that updates every minute.
// Shows yellow warning when data is >1h stale.

import { useEffect, useState } from "react";

interface Props {
  date?:      string | null;
  prefix?:    string;   // e.g. "kurs", "dane finansowe", "analiza"
  className?: string;
  staleAfter?: number;  // ms after which label turns yellow (default: 3600000 = 1h)
}

function computeLabel(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);

  if (mins  <  1)  return "przed chwilą";
  if (mins  < 60)  return `${mins} min temu`;
  if (hours < 24)  return `${hours}h temu`;
  return `${days}d temu`;
}

export function LiveTimestamp({
  date,
  prefix    = "aktualizacja",
  className = "",
  staleAfter = 3_600_000,
}: Props) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    if (!date) {
      setLabel("brak danych");
      return;
    }

    const update = () => setLabel(computeLabel(date));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [date]);

  const isStale = !date || (Date.now() - new Date(date).getTime()) > staleAfter;

  if (!label) return null;

  return (
    <span className={`text-xs font-mono ${isStale ? "text-yellow-500/70" : "text-gray-600"} ${className}`}>
      · {prefix} {label}
      {isStale && <span className="ml-1 opacity-70">⚠</span>}
    </span>
  );
}
