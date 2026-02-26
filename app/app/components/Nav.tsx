"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

const links = [
  { href: "/",           label: "Dashboard"     },
  { href: "/companies",  label: "Spółki"        },
  { href: "/screener",   label: "Screener"      },
  { href: "/macro",      label: "Makro"         },
  { href: "/watchlists", label: "Watchlisty"    },
  { href: "/calendar",   label: "Kalendarz"     },
  { href: "/alerts",        label: "Alerty"        },
  { href: "/paper-trading", label: "Paper Trade"   },
  { href: "/upload",        label: "Wgraj raport"  },
  { href: "/status",        label: "Status"        },
  { href: "/settings",      label: "⚙ Ustawienia" },
];

interface NavStats {
  alerts_count: number;
  events_today: number;
}

export default function Nav() {
  const pathname   = usePathname();
  const [open, setOpen]   = useState(false);
  const [stats, setStats] = useState<NavStats | null>(null);

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

  return (
    <nav className="bg-gray-900 border-b border-gray-800 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 text-white font-bold text-lg tracking-tight shrink-0"
        >
          📈 Giełda Monitor
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-1">
          {links.map(({ href, label }) => {
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
                className={`relative px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-gray-700 text-white"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                }`}
              >
                {label}
                {badge !== null && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden flex flex-col gap-1 p-2 rounded-md hover:bg-gray-800 transition-colors"
          onClick={() => setOpen(v => !v)}
          aria-label="Menu"
        >
          <span className={`block w-5 h-0.5 bg-gray-400 transition-transform ${open ? "rotate-45 translate-y-1.5" : ""}`} />
          <span className={`block w-5 h-0.5 bg-gray-400 transition-opacity ${open ? "opacity-0" : ""}`} />
          <span className={`block w-5 h-0.5 bg-gray-400 transition-transform ${open ? "-rotate-45 -translate-y-1.5" : ""}`} />
        </button>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden border-t border-gray-800 bg-gray-900 px-4 py-3 flex flex-col gap-1">
          {links.map(({ href, label }) => {
            const isActive =
              href === "/"
                ? pathname === "/"
                : pathname === href || pathname.startsWith(href + "/");

            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-gray-700 text-white"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
