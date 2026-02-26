"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const links = [
  { href: "/",           label: "Dashboard"    },
  { href: "/companies",  label: "Spółki"        },
  { href: "/screener",   label: "Screener"     },
  { href: "/macro",      label: "Makro"        },
  { href: "/watchlists", label: "Watchlisty"   },
  { href: "/calendar",   label: "Kalendarz"    },
  { href: "/alerts",     label: "Alerty"       },
  { href: "/heatmap",    label: "Heatmapa"     },
  { href: "/whatif",     label: "What-If"      },
  { href: "/upload",     label: "Wgraj raport" },
  { href: "/status",     label: "Status"       },
  { href: "/settings",   label: "Ustawienia"   },
];

export default function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <nav className="bg-gray-900 border-b border-gray-800 h-14 flex items-center">
      <div className="w-full px-4 md:px-6 flex items-center justify-between">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 text-white font-bold text-lg tracking-tight shrink-0"
        >
          📈 Giełda Monitor
        </Link>

        {/* Mobile hamburger — hidden on desktop (sidebar handles nav there) */}
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
        <div className="md:hidden absolute top-full left-0 right-0 border-t border-gray-800 bg-gray-900 px-4 py-3 flex flex-col gap-1 z-50">
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
