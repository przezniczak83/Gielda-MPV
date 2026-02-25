"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface CalendarEvent {
  id:           number;
  ticker:       string;
  company_name: string | null;
  event_type:   string;
  event_date:   string;
  title:        string;
  description:  string | null;
}

interface WeekGroup {
  label:  string;
  events: CalendarEvent[];
}

const EVENT_EMOJI: Record<string, string> = {
  earnings:       "📊",
  dividend_exdate:"💰",
  agm:            "🏛️",
  analyst_day:    "🎤",
  other:          "📌",
};

const EVENT_LABEL: Record<string, string> = {
  earnings:       "Wyniki",
  dividend_exdate:"Dywidenda",
  agm:            "WZA",
  analyst_day:    "Analitycy",
  other:          "Inne",
};

const DAY_PL = ["Nd", "Pn", "Wt", "Śr", "Cz", "Pt", "Sb"];
const MONTH_PL = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatWeekLabel(weekStart: Date): string {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  return `${weekStart.getDate()} — ${weekEnd.getDate()} ${MONTH_PL[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`;
}

function isToday(date: Date): boolean {
  const now = new Date();
  return date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
}

function isTomorrow(date: Date): boolean {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return date.getDate() === tomorrow.getDate() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getFullYear() === tomorrow.getFullYear();
}

function isThisWeek(date: Date): boolean {
  const now = new Date();
  const weekStart = getWeekStart(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return date >= weekStart && date < weekEnd;
}

export default function CalendarPage() {
  const [events,  setEvents]  = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/calendar?limit=50")
      .then(r => r.json())
      .then((d: CalendarEvent[]) => { setEvents(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Group by ISO week
  const weekGroups: WeekGroup[] = [];
  const weekMap = new Map<string, CalendarEvent[]>();

  for (const ev of events) {
    const date = new Date(ev.event_date);
    const ws = getWeekStart(date);
    const key = ws.toISOString();
    if (!weekMap.has(key)) weekMap.set(key, []);
    weekMap.get(key)!.push(ev);
  }

  for (const [key, evs] of weekMap.entries()) {
    const ws = new Date(key);
    weekGroups.push({ label: formatWeekLabel(ws), events: evs });
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-3xl mx-auto px-6 py-10">

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Kalendarz eventów</h1>
          <p className="text-gray-500 text-sm mt-1">Nadchodzące wyniki, dywidendy i wydarzenia korporacyjne</p>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-600 animate-pulse">Ładowanie…</div>
        ) : events.length === 0 ? (
          <div className="text-center py-16 text-gray-500">Brak nadchodzących eventów</div>
        ) : (
          <div className="space-y-8">
            {weekGroups.map(wg => (
              <div key={wg.label}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                    📅 Tydzień {wg.label}
                  </span>
                  <div className="flex-1 h-px bg-gray-800" />
                </div>

                <div className="rounded-xl border border-gray-800 overflow-hidden divide-y divide-gray-800/60">
                  {wg.events.map(ev => {
                    const date     = new Date(ev.event_date);
                    const todayEv  = isToday(date);
                    const tomorrowEv = isTomorrow(date);
                    const thisWeekEv = isThisWeek(date);

                    const rowBg = todayEv || tomorrowEv
                      ? "bg-yellow-500/5 border-l-2 border-l-yellow-500/40"
                      : thisWeekEv
                      ? ""
                      : "opacity-75";

                    const emoji = EVENT_EMOJI[ev.event_type] ?? "📌";
                    const label = EVENT_LABEL[ev.event_type] ?? ev.event_type;

                    return (
                      <div key={ev.id} className={`flex items-center gap-4 px-4 py-3.5 hover:bg-gray-900/40 transition-colors ${rowBg}`}>
                        {/* Day */}
                        <div className="w-14 shrink-0 text-center">
                          <div className="text-xs text-gray-500">{DAY_PL[date.getDay()]}</div>
                          <div className={`text-lg font-bold tabular-nums ${todayEv ? "text-yellow-400" : tomorrowEv ? "text-yellow-300" : "text-gray-300"}`}>
                            {date.getDate()}.{String(date.getMonth() + 1).padStart(2, "0")}
                          </div>
                          {todayEv   && <div className="text-[10px] text-yellow-400 font-bold">DZIŚ</div>}
                          {tomorrowEv && <div className="text-[10px] text-yellow-300">JUTRO</div>}
                        </div>

                        {/* Emoji + type */}
                        <div className="w-20 shrink-0 text-center">
                          <div className="text-lg">{emoji}</div>
                          <div className="text-[10px] text-gray-500 font-medium">{label}</div>
                        </div>

                        {/* Ticker + title */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <Link href={`/companies/${ev.ticker}`}
                              className="font-mono font-bold text-white hover:text-blue-400 transition-colors text-sm">
                              {ev.ticker}
                            </Link>
                            {ev.company_name && (
                              <span className="text-xs text-gray-500 truncate">{ev.company_name}</span>
                            )}
                          </div>
                          <div className="text-sm text-gray-300 truncate">{ev.title}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
