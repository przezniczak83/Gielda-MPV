"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const links = [
  { href: "/",           label: "Dashboard",     icon: "⊞" },
  { href: "/companies",  label: "Spółki",         icon: "🏢" },
  { href: "/screener",   label: "Screener",       icon: "🔍" },
  { href: "/macro",      label: "Makro",          icon: "📊" },
  { href: "/watchlists", label: "Watchlisty",     icon: "⭐" },
  { href: "/calendar",   label: "Kalendarz",      icon: "📅" },
  { href: "/alerts",     label: "Alerty",         icon: "🔔" },
  { href: "/news",       label: "Newsy",          icon: "📰" },
  { href: "/heatmap",    label: "Heatmapa",       icon: "🌡" },
  { href: "/whatif",     label: "What-If",        icon: "🧪" },
  { href: "/upload",     label: "Wgraj raport",   icon: "📤" },
  { href: "/status",     label: "Status",         icon: "💚" },
  { href: "/settings",   label: "Ustawienia",     icon: "⚙" },
];

interface NavStats {
  alerts_count: number;
  events_today: number;
}

export default function LeftSidebar() {
  const pathname = usePathname();
  const [stats, setStats] = useState<NavStats | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res  = await fetch("/api/nav-stats");
        const data = await res.json() as NavStats;
        if (!cancelled) setStats(data);
      } catch { /* silent */ }
    }
    poll();
    const id = setInterval(poll, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const w = collapsed ? "w-14" : "w-52";

  return (
    <aside
      className={`hidden md:flex flex-col ${w} bg-gray-900 border-r border-gray-800 sticky top-14 h-[calc(100vh-3.5rem)] shrink-0 transition-all duration-200 z-30`}
    >
      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(v => !v)}
        className="flex items-center justify-end px-3 py-2.5 text-gray-500 hover:text-gray-300 text-sm border-b border-gray-800"
        title={collapsed ? "Rozwiń" : "Zwiń"}
      >
        {collapsed ? "▶" : "◀"}
      </button>

      {/* Nav links */}
      <nav className="flex flex-col gap-0.5 p-2 flex-1 overflow-y-auto">
        {links.map(({ href, label, icon }) => {
          const isActive =
            href === "/"
              ? pathname === "/"
              : pathname === href || pathname.startsWith(href + "/");

          const badge =
            href === "/alerts" && stats && stats.alerts_count > 0
              ? stats.alerts_count
              : null;

          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={`relative flex items-center gap-3 px-2 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              }`}
            >
              <span className="text-base leading-none shrink-0 w-5 text-center">{icon}</span>
              {!collapsed && <span className="truncate">{label}</span>}
              {badge !== null && (
                <span className={`${collapsed ? "absolute -top-1 -right-1" : "ml-auto"} min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center`}>
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="p-3 border-t border-gray-800 text-xs text-gray-600">
          GPW Monitor
        </div>
      )}
    </aside>
  );
}
