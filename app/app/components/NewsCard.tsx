"use client";

import Link from "next/link";

// ── Types ──────────────────────────────────────────────────────────────────────

interface KeyFact {
  type:        string;
  description: string;
  detail?:     string;
  impact?:     "positive" | "negative" | "neutral";
}

export interface NewsCardItem {
  id:              number;
  url:             string;
  title:           string;
  source:          string;
  published_at:    string | null;
  tickers:         string[] | null;
  sentiment:       number | null;
  impact_score:    number | null;
  category:        string | null;
  ai_summary:      string | null;
  is_breaking:     boolean | null;
  key_facts:       KeyFact[] | null;
  source_count?:   number;
  sources?:        string[];
  relevance_score?: number | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

export const SOURCE_COLORS: Record<string, string> = {
  pap:      "bg-blue-900/70 text-blue-300",
  bankier:  "bg-orange-900/70 text-orange-300",
  stooq:    "bg-purple-900/70 text-purple-300",
  strefa:   "bg-green-900/70 text-green-300",
  wp:       "bg-red-900/70 text-red-300",
  youtube:  "bg-pink-900/70 text-pink-300",
  espi:     "bg-amber-900/70 text-amber-300",
  gpw:      "bg-green-900/40 text-green-300",
  knf:      "bg-yellow-900/40 text-yellow-300",
  money:    "bg-orange-900/40 text-orange-300",
  pb:       "bg-cyan-900/40 text-cyan-300",
  parkiet:  "bg-blue-900/40 text-blue-300",
  rp:       "bg-slate-700/40 text-slate-300",
  cashless: "bg-teal-900/40 text-teal-300",
  comparic: "bg-violet-900/40 text-violet-300",
};

// Left border accent color for the card
function borderAccent(item: NewsCardItem): string {
  if (item.source === "espi")                        return "border-l-amber-600";
  if (item.is_breaking)                              return "border-l-red-600";
  if ((item.impact_score ?? 0) >= 8)                 return "border-l-orange-500";
  if ((item.impact_score ?? 0) >= 6)                 return "border-l-yellow-600";
  if ((item.sentiment ?? 0) >  0.4)                  return "border-l-emerald-700";
  if ((item.sentiment ?? 0) < -0.4)                  return "border-l-red-800";
  return "border-l-gray-700";
}

function cardBg(item: NewsCardItem): string {
  if (item.is_breaking)    return "bg-red-950/20 border-red-800/40";
  if (item.source === "espi") return "bg-amber-950/15 border-amber-800/30";
  return "bg-gray-900/40 border-gray-800";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m    = Math.floor(diff / 60_000);
  if (m < 1)  return "teraz";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "wczoraj" : `${d}d`;
}

function sentimentDot(s: number | null) {
  if (s === null) return { dot: "bg-gray-600", cls: "text-gray-500", label: "—" };
  if (s >  0.3)   return { dot: "bg-emerald-500", cls: "text-emerald-400", label: `+${s.toFixed(2)}` };
  if (s < -0.3)   return { dot: "bg-red-500",     cls: "text-red-400",     label: s.toFixed(2) };
  return           { dot: "bg-yellow-500",  cls: "text-yellow-400", label: s.toFixed(2) };
}

function impactClass(score: number | null): string {
  if (!score) return "text-gray-600";
  if (score >= 8) return "text-red-400 font-bold";
  if (score >= 6) return "text-orange-400 font-bold";
  if (score >= 4) return "text-yellow-500";
  return "text-gray-600";
}

function factText(fact: KeyFact, maxLen = 65): string {
  const text = fact.description || fact.type || "";
  return text.length > maxLen ? text.slice(0, maxLen - 3) + "…" : text;
}

// ── Sub: Source badge + multi-source expand ────────────────────────────────────

function SourceBadge({ item }: { item: NewsCardItem }) {
  const count = item.source_count ?? 1;
  return (
    <div className="flex items-center gap-1 shrink-0">
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
        SOURCE_COLORS[item.source] ?? "bg-gray-800 text-gray-400"
      }`}>
        {item.source}
      </span>
      {count > 1 && (
        <span
          title={`Źródła: ${(item.sources ?? []).join(", ")}`}
          className="text-[9px] font-bold px-1 py-0.5 rounded bg-gray-700/80 text-gray-300 border border-gray-600/60 cursor-default"
        >
          +{count - 1}
        </span>
      )}
    </div>
  );
}

// ── Full card variant ──────────────────────────────────────────────────────────

export function NewsCardFull({ item }: { item: NewsCardItem }) {
  const sd = sentimentDot(item.sentiment);
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`group relative block rounded-xl border border-l-4 p-4 transition-colors hover:brightness-110 ${cardBg(item)} ${borderAccent(item)}`}
    >
      {/* Top row: source + live badge + time */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <SourceBadge item={item} />
          {item.is_breaking && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-700 text-white uppercase animate-pulse tracking-widest">
              LIVE
            </span>
          )}
          {item.category && (
            <span className="text-[9px] text-gray-500 bg-gray-800/60 px-1.5 py-0.5 rounded">
              {item.category}
            </span>
          )}
        </div>
        <span className="text-[10px] text-gray-600 shrink-0 tabular-nums">
          {timeAgo(item.published_at)}
        </span>
      </div>

      {/* Title */}
      <p className={`text-sm font-medium leading-snug line-clamp-2 group-hover:text-white transition-colors mb-1 ${
        item.is_breaking ? "text-red-200" : "text-gray-100"
      }`}>
        {item.title}
      </p>

      {/* AI summary */}
      {item.ai_summary && (
        <p className="text-[11px] text-gray-500 leading-snug line-clamp-2 mb-1.5">
          {item.ai_summary}
        </p>
      )}

      {/* Key facts chips */}
      {item.key_facts && item.key_facts.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {item.key_facts.slice(0, 3).map((fact, i) => (
            <span
              key={i}
              className="text-[9px] text-gray-500 bg-gray-800/70 border border-gray-700/50 px-1.5 py-0.5 rounded"
            >
              {factText(fact)}
            </span>
          ))}
        </div>
      )}

      {/* Meta row: tickers | impact | sentiment */}
      <div className="flex flex-wrap items-center gap-2 mt-1">
        {item.tickers?.length ? (
          <div className="flex gap-1 flex-wrap">
            {item.tickers.slice(0, 4).map(t => (
              <Link
                key={t}
                href={`/companies/${t}`}
                onClick={e => e.stopPropagation()}
                className="font-mono text-[10px] text-blue-400 hover:text-blue-300 bg-blue-900/20 border border-blue-800/30 px-1.5 py-0.5 rounded transition-colors"
              >
                {t}
              </Link>
            ))}
          </div>
        ) : null}

        {item.impact_score !== null && (
          <span className={`text-[10px] tabular-nums ${impactClass(item.impact_score)}`}>
            {item.impact_score}/10
          </span>
        )}

        {item.sentiment !== null && (
          <span className={`flex items-center gap-1 text-[10px] ${sd.cls}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${sd.dot}`} />
            {sd.label}
          </span>
        )}
      </div>
    </a>
  );
}

// ── Compact card variant ───────────────────────────────────────────────────────

export function NewsCardCompact({ item }: { item: NewsCardItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`group flex items-start gap-2 rounded-lg border border-l-4 px-3 py-2 transition-colors hover:brightness-110 ${cardBg(item)} ${borderAccent(item)}`}
    >
      <div className="flex flex-col items-start gap-0.5 shrink-0 mt-0.5">
        <SourceBadge item={item} />
        {item.is_breaking && (
          <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-red-700 text-white uppercase animate-pulse">
            LIVE
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className={`text-xs leading-snug line-clamp-2 group-hover:text-white transition-colors ${
          item.is_breaking ? "text-red-200 font-medium" : "text-gray-200"
        }`}>
          {item.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {item.tickers?.length ? (
            <span className="font-mono text-[10px] text-blue-400">
              {item.tickers.slice(0, 3).join(" ")}
            </span>
          ) : null}
          {item.impact_score !== null && (
            <span className={`text-[10px] tabular-nums ${impactClass(item.impact_score)}`}>
              {item.impact_score}/10
            </span>
          )}
          <span className="text-[10px] text-gray-600 ml-auto tabular-nums">
            {timeAgo(item.published_at)}
          </span>
        </div>
      </div>
    </a>
  );
}
