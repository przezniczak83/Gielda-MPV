// supabase/functions/process-news/ticker-matcher.ts
// Three-layer deterministic ticker matcher for news articles.
//
// Layer 1 — Pattern matching (confidence 0.90–0.95):
//   $PKN, (CDR), GPW:PKN, "ticker PKN", "spółka PKN", "akcje PKN"
//
// Layer 2 — Alias matching (confidence 0.70–0.95):
//   ticker_aliases table, word-boundary regex, sorted longest-first
//
// Layer 3 — Company name matching (confidence 0.70–0.80):
//   companies.name and official_name substring search
//
// Module-level cache: loaded ONCE per cold-start (i.e. once per batch invocation).
// Call preloadMatcherCache() at the start of a batch; subsequent per-item calls
// reuse the in-memory data.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MatchEvidence {
  method:   "pattern" | "alias" | "company_name";
  matched:  string;
  ticker:   string;
  position: number;
  in_title: boolean;
}

export interface MatchResult {
  tickers:    string[];
  confidence: Record<string, number>;
  method:     "deterministic" | "ai_needed";
  evidence:   MatchEvidence[];
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface AliasRow   { ticker: string; alias: string }
interface CompanyRow { ticker: string; name: string; official_name: string | null }

interface Hit { confidence: number; evidence: MatchEvidence }

// ─── Module-level cache (valid for the lifetime of this isolate) ──────────────

let _aliases:   AliasRow[]   | null = null;
let _companies: CompanyRow[] | null = null;
let _validSet:  Set<string>  | null = null;

/** Load aliases and companies from DB into module-level cache.
 *  Call once per batch; subsequent calls are no-ops if cache is already filled. */
export async function preloadMatcherCache(supabase: SupabaseClient): Promise<void> {
  if (_aliases && _companies) return; // already loaded

  const [aliasRes, compRes] = await Promise.all([
    supabase.from("ticker_aliases").select("ticker, alias").limit(5000),
    supabase.from("companies").select("ticker, name, official_name"),
  ]);

  _aliases   = (aliasRes.data  ?? []) as AliasRow[];
  _companies = (compRes.data   ?? []) as CompanyRow[];
  _validSet  = new Set(_companies.map(c => c.ticker));

  console.log(`[ticker-matcher] cache: ${_aliases.length} aliases, ${_companies.length} companies`);
}

async function ensureCache(supabase: SupabaseClient): Promise<{
  aliases:   AliasRow[];
  companies: CompanyRow[];
  validSet:  Set<string>;
}> {
  if (!_aliases || !_companies || !_validSet) {
    await preloadMatcherCache(supabase);
  }
  return { aliases: _aliases!, companies: _companies!, validSet: _validSet! };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function merge(map: Map<string, Hit>, ticker: string, hit: Hit): void {
  const existing = map.get(ticker);
  if (!existing || hit.confidence > existing.confidence) {
    map.set(ticker, hit);
  }
}

// ─── Layer 1: Pattern matching ────────────────────────────────────────────────

const CONTEXT_WORDS = [
  "ticker", "spółka", "spólka", "akcje", "akcja", "kurs", "walory", "akcjonariusz",
];

function matchPatterns(
  titleLower: string,
  bodyLower:  string,
  validSet:   Set<string>,
): Map<string, Hit> {
  const result = new Map<string, Hit>();

  for (const [text, in_title] of [[titleLower, true], [bodyLower, false]] as const) {
    // $PKN, $AAPL
    for (const m of text.matchAll(/\$([A-Za-z]{2,10})\b/g)) {
      const tk = m[1].toUpperCase();
      if (!validSet.has(tk)) continue;
      merge(result, tk, { confidence: 0.95, evidence: { method: "pattern", matched: `$${tk}`, ticker: tk, position: m.index!, in_title } });
    }

    // (PKN), (CDR)
    for (const m of text.matchAll(/\(([A-Z]{2,10})\)/g)) {
      const tk = m[1].toUpperCase();
      if (!validSet.has(tk)) continue;
      merge(result, tk, { confidence: 0.95, evidence: { method: "pattern", matched: `(${tk})`, ticker: tk, position: m.index!, in_title } });
    }

    // GPW:PKN
    for (const m of text.matchAll(/gpw:([A-Za-z]{2,10})\b/gi)) {
      const tk = m[1].toUpperCase();
      if (!validSet.has(tk)) continue;
      merge(result, tk, { confidence: 0.95, evidence: { method: "pattern", matched: `GPW:${tk}`, ticker: tk, position: m.index!, in_title } });
    }

    // "spółka PKN", "ticker CDR", "akcje KGHM" (context phrase + uppercase ticker)
    for (const phrase of CONTEXT_WORDS) {
      const re = new RegExp(`\\b${phrase}\\s+([A-Z]{2,10})\\b`, "gi");
      for (const m of text.matchAll(re)) {
        const tk = m[1].toUpperCase();
        if (!validSet.has(tk)) continue;
        merge(result, tk, { confidence: 0.90, evidence: { method: "pattern", matched: `${phrase} ${tk}`, ticker: tk, position: m.index!, in_title } });
      }
    }
  }

  return result;
}

// ─── Layer 2: Alias matching ──────────────────────────────────────────────────

function matchAliases(
  titleLower: string,
  bodyLower:  string,
  aliases:    AliasRow[],
  validSet:   Set<string>,
): Map<string, Hit> {
  const result = new Map<string, Hit>();

  // Sort: longest alias first (most specific), skip very short ones
  const sorted = [...aliases]
    .filter(a => a.alias.length >= 4 && validSet.has(a.ticker))
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const { ticker, alias } of sorted) {
    const al      = alias.toLowerCase();
    const escaped = escapeRegex(al);
    const re      = new RegExp(`\\b${escaped}\\b`, "gi");

    const inTitle = re.test(titleLower);
    re.lastIndex  = 0;
    const inBody  = re.test(bodyLower);

    if (!inTitle && !inBody) continue;

    // Confidence: length-based + title boost
    const base =
      alias.length > 8 ? 0.90 :
      alias.length > 5 ? 0.80 : 0.70;
    const conf    = base + (inTitle ? 0.05 : 0);
    const pos     = inTitle ? titleLower.search(new RegExp(`\\b${escaped}\\b`, "i")) : bodyLower.search(new RegExp(`\\b${escaped}\\b`, "i"));

    merge(result, ticker, {
      confidence: Math.min(conf, 0.95),
      evidence: { method: "alias", matched: alias, ticker, position: Math.max(0, pos), in_title: inTitle },
    });

    if (result.size >= 8) break; // performance cap — usually enough
  }

  return result;
}

// ─── Layer 3: Company name matching ──────────────────────────────────────────

function matchCompanyNames(
  titleLower: string,
  bodyLower:  string,
  companies:  CompanyRow[],
): Map<string, Hit> {
  const result = new Map<string, Hit>();

  for (const company of companies) {
    const checks: Array<{ n: string; baseConf: number }> = [
      { n: company.name.toLowerCase(),          baseConf: 0.70 },
      ...(company.official_name
        ? [{ n: company.official_name.toLowerCase(), baseConf: 0.75 }]
        : []),
    ];

    for (const { n, baseConf } of checks) {
      if (n.length < 5) continue; // too short = too ambiguous

      const inTitle = titleLower.includes(n);
      const inBody  = bodyLower.includes(n);
      if (!inTitle && !inBody) continue;

      const conf = baseConf + (inTitle ? 0.05 : 0);
      const pos  = inTitle ? titleLower.indexOf(n) : bodyLower.indexOf(n);

      merge(result, company.ticker, {
        confidence: conf,
        evidence: { method: "company_name", matched: n, ticker: company.ticker, position: pos, in_title: inTitle },
      });
    }
  }

  return result;
}

// ─── Main export ─────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.6;
const MAX_TICKERS          = 5;

/** Run 3-layer deterministic ticker matching.
 *
 *  Uses module-level cache — call preloadMatcherCache() once per batch for best
 *  performance; will auto-load if cache is empty.
 */
export async function matchTickersDeterministic(
  title:    string,
  body:     string,
  supabase: SupabaseClient,
): Promise<MatchResult> {
  const { aliases, companies, validSet } = await ensureCache(supabase);

  const titleLower = title.toLowerCase();
  const bodyLower  = body.toLowerCase();

  // Run layers
  const l1 = matchPatterns(titleLower, bodyLower, validSet);
  const l2 = matchAliases(titleLower, bodyLower, aliases, validSet);
  const l3 = matchCompanyNames(titleLower, bodyLower, companies);

  // Merge: highest confidence wins per ticker
  // Process l3 → l2 → l1 (l1 = pattern has priority)
  const merged = new Map<string, Hit>();
  for (const layer of [l3, l2, l1]) {
    for (const [ticker, hit] of layer) {
      merge(merged, ticker, hit);
    }
  }

  // Filter and rank
  const qualified = [...merged.entries()]
    .filter(([, h]) => h.confidence >= CONFIDENCE_THRESHOLD)
    .sort((a, b) => b[1].confidence - a[1].confidence)
    .slice(0, MAX_TICKERS);

  if (qualified.length === 0) {
    return { tickers: [], confidence: {}, method: "ai_needed", evidence: [] };
  }

  return {
    tickers:    qualified.map(([t]) => t),
    confidence: Object.fromEntries(qualified.map(([t, h]) => [t, h.confidence])),
    method:     "deterministic",
    evidence:   qualified.map(([, h]) => h.evidence),
  };
}
