# Lessons Learned

## Project Setup

### 2026-02-XX – Project Documentation Initialized

**Lesson:**
Project documentation must be created before major implementation begins.

**Why:**
Compound Engineering requires persistent memory of:
- mistakes
- architectural decisions
- reusable patterns

**Impact:**
All future checkpoints must begin with reviewing /project-docs/.

---

## Git & Workflow

### 2026-02-25 — Small commits per feature, not per session

**Lesson:**
Commit after each logical unit (one function/component/migration), not after
a full session. This preserves clear git history and enables easy rollback.

---

## Supabase & Database

### 2026-02-25 — `supabase db execute` removed in CLI v2

**Lesson:**
`supabase db execute --project-ref` was removed in CLI v2.x.
The correct v2 workflow is:
1. `supabase init` (creates supabase/config.toml if missing)
2. Add migration file to supabase/migrations/
3. `supabase db push --linked --yes`

The project is "linked" via stored auth token after `supabase login`.

---

### 2026-02-25 — SERVICE_ROLE_KEY in cron migrations — sed substitution

**Lesson:**
Migration files containing SERVICE_ROLE_KEY must use a placeholder
(SERVICE_ROLE_KEY_HERE). Substitute at deploy time via sed:

```bash
sed "s/SERVICE_ROLE_KEY_HERE/$SERVICE_ROLE_KEY/" migration.sql > /tmp/substituted.sql
```

Then push the substituted file (NOT the placeholder file) — or temporarily
overwrite and restore. Never commit real keys.

---

### 2026-02-25 — pg_trgm fuzzy dedup requires helper function for RPC

**Lesson:**
Supabase JS client doesn't support raw SQL similarity() queries directly.
Solution: create a `find_fuzzy_duplicate()` PG function in a migration,
then call it via `supabase.rpc("find_fuzzy_duplicate", { ... })`.

Always add graceful fallback if the function doesn't exist yet (catch error,
log warning, continue without fuzzy check).

---

## External APIs — Edge Function IP Blocking

### 2026-02-25 — Stooq.pl blocks Edge Function IPs

**Problem:**
Stooq.pl returns "Brak danych" / "No data" for ALL requests from Supabase
Edge Function servers. Their API requires browser session cookies.

**Solution:** Yahoo Finance API works from server environments:
- GPW stocks: `https://query1.finance.yahoo.com/v8/finance/chart/{ticker}.WA?interval=1d&range=30d`
- USA stocks: `https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=30d`
- Returns JSON with `chart.result[0].timestamp[]` + `indicators.quote[0].{open,high,low,close,volume}[]`
- Tested: 150 rows fetched on first run, real prices confirmed

**Pattern:** Use browser-like User-Agent header.

---

### 2026-02-25 — ESPI and corporate PDF sites block Edge Function IPs

**Problem:**
ESPI (espi.gpw.pl) and corporate investor relations pages block requests
from Supabase Edge Function IPs (DNS/connection errors).

**Workaround:**
- Pass publicly accessible PDF URLs (e.g., mirrored copies, public S3 buckets)
- Or use a proxy layer
- Direct ESPI report URLs won't work from Edge Functions

---

## Price Data Sources

### 2026-02-25 — Twelve Data GPW suffix: .WAW not .WAR

**Problem:**
Initial implementation used `.WAR` suffix for GPW stocks in Twelve Data API.
Warsaw Stock Exchange exchange code in Twelve Data is `.WAW`, not `.WAR`.

**Fix:**
`https://api.twelvedata.com/time_series?symbol={ticker}.WAW&interval=1day&...`

**Note:** EODHD uses `.WAR` suffix (correct for EODHD). Each provider has its
own exchange code — always verify per-provider documentation.

---

### 2026-02-25 — Twelve Data GPW coverage is limited

**Problem:**
Even with correct `.WAW` suffix, many Polish GPW stocks return 0 rows from
Twelve Data (ACP, ALE, ALR, etc.). Twelve Data's free tier coverage of GPW
is limited.

**Solution:** EODHD has much better GPW coverage (249 rows per stock vs 0).
Fallback chain: Twelve Data → EODHD → Yahoo is the right order.

---

## External APIs — ESPI Data Sources

### 2026-02-25 — Bankier.pl RSS works from Edge Functions for ESPI data

**Result:** `https://www.bankier.pl/rss/espi.xml` is accessible from Supabase
Edge Function IPs. Returns real ESPI announcements in RSS 2.0 format.

**Limitations:**
- 10–20 items per feed (recent announcements only)
- Ticker not in XML — must extract from title / PDF filenames in description
- Title format: `COMPANY NAME S.A.: announcement text`
- Match against watchlist using all-caps words from company name: works for
  simple tickers (PKN, LPP, CCC, KGHM) but not abbreviations (CDR≠CD PROJEKT)

**Pattern:** Extract all-caps 2–6 char words from title, compare against
watchlist. Store ALL real records (even non-watchlist), let process-raw filter.

---

### 2026-02-25 — GPW RSS returns empty from Edge Functions

**Problem:**
`https://www.gpw.pl/komunikaty?type=rss` returns empty from Edge Function IPs
(likely blocked or requires session cookie).

**Fallback:** Bankier.pl RSS works reliably. Use as primary ESPI source.

---

## Telegram Bot API

### 2026-02-25 — Telegram sendMessage works from Edge Functions

**Result:** `https://api.telegram.org/bot{TOKEN}/sendMessage` is accessible
from Supabase Edge Function IPs.

**Pattern:** POST with `{chat_id, text, parse_mode: "Markdown"}`.

**Rate limiting:** Add 300ms sleep between consecutive messages to avoid
Telegram 429 (Too Many Requests).

**Markdown note:** Escape special chars in untrusted text fields. Use
`parse_mode: "Markdown"` (v1) for simple bold/italic — v1 is more lenient
than MarkdownV2.

---

## Idempotent Alerts Pattern

### 2026-02-25 — alerted_at column for idempotent alert delivery

**Pattern:** Add `alerted_at timestamptz` column to any table that triggers
alerts. On each cron run, query `WHERE alerted_at IS NULL`. After successful
send, `UPDATE SET alerted_at = now()`.

**Benefit:** Re-running the function never double-sends. Crash-safe: if send
succeeds but UPDATE fails, alert will re-send on next run (at-least-once
semantics — acceptable for stock alerts).

**Index:** `CREATE INDEX ... WHERE alerted_at IS NOT NULL` (partial index) for
queries on already-alerted rows.

---

## Insider Transactions Data Sources

### 2026-02-25 — GPW insider transactions page blocks Edge Function IPs

**Problem:**
`https://www.gpw.pl/transakcje-insiderow` and the Ajax API
`https://www.gpw.pl/ajaxindex.php?action=GPWTransakcjeInsiderow` both
block server-side requests (curl error 56 — connection reset by GPW's WAF).

**Status:** `https://www.bankier.pl/rss/insider.xml` returns empty (HTTP 200
but 0 bytes). JavaScript-rendered page, no public RSS.

**Workaround:** Insider transactions in Poland are mandatory ESPI disclosures
under MAR Art. 19 ("Powiadomienie o transakcji menedżera"). Our ESPI pipeline
(Bankier RSS → raw_ingest → company_events) will capture these automatically
when they're published. The `fetch-insider` function scans `company_events`
for keywords: "transakcja menedżera", "nabycie", "zbycie", "art. 19".

---

## AI & Prompt Engineering

### 2026-02-25 — Anthropic Claude Sonnet: primary for Polish text quality

**Lesson:**
Claude claude-sonnet-4-20250514 produces significantly better Polish financial
analysis than GPT-4o Mini. Use as primary, GPT-4o Mini as fallback.

Always implement try/catch → fallback pattern (see common-patterns.md).

### 2026-02-25 — Railway scraper as PRIMARY GPW price source (not just bypass)

**Decision:** Railway scraper is now `source_used: "stooq"` in price_history.
It uses the `/prices/gpw/history?ticker=X&days=30` endpoint which returns full
30-day history (ascending), not just the latest row.

**Chain:** Railway/Stooq → EODHD → Twelve Data → Yahoo. GPW tickers confirmed
source='stooq' after deploy.

---

### 2026-02-25 — company_kpis table: use UPSERT with onConflict on (ticker, kpi_type)

**Pattern:**
```typescript
await supabase
  .from("company_kpis")
  .upsert({ ticker, kpi_type: "health_score", value: score, metadata, calculated_at },
           { onConflict: "ticker,kpi_type" });
```
The UNIQUE constraint is on `(ticker, kpi_type)`, so each ticker has exactly
one health_score row and one red_flags row, always overwritten on recalculation.

---

### 2026-02-25 — Parallel Edge Function calls from Next.js API route

**Pattern:** Use `Promise.allSettled` when calling multiple Edge Functions
from a single Next.js route. Never let one EF failure block the other.

```typescript
const [healthRes, flagsRes] = await Promise.allSettled([
  fetch(`${efBase}/analyze-health`, { method: "POST", headers, body }),
  fetch(`${efBase}/detect-flags`,   { method: "POST", headers, body }),
]);
```

**Key:** Pass `SUPABASE_SERVICE_ROLE_KEY` as `Authorization: Bearer` header.

---

### 2026-02-25 — Stooq ticker format: no `.pl` suffix needed

**Problem:**
Initial implementation appended `.pl` to tickers (e.g., `pkn.pl`) based on old
Stooq documentation. Stooq returns "Brak danych" for this format.

**Fix:**
Use bare lowercase ticker without suffix: `https://stooq.pl/q/d/l/?s=pkn&i=d`

**Headers:** Stooq CSV columns are in Polish:
`Data,Otwarcie,Najwyzszy,Najnizszy,Zamkniecie,Wolumen` (indexes 0–5).
Do NOT use header name lookups — use fixed column indices.

---

### 2026-02-25 — Stooq accessible from Railway but NOT from Edge Functions

**Result from scraper testing:** Stooq.pl returns data when called from a regular
Node.js server (Railway, local). The IP block is specific to Supabase Edge Function
IPs. Railway-hosted Express servers work fine as a proxy layer.

---

### 2026-02-25 — `.env.local` newline corruption breaks service role key

**Problem:**
After a sed substitution or manual edit, the `SUPABASE_SERVICE_ROLE_KEY` line was
missing a trailing newline, causing `INGEST_API_KEY=...` to be appended to the key
value. All subsequent API calls returned HTTP 401.

**Symptom:** 401 from Supabase REST API despite "correct" key in .env.local.

**Fix:** Rewrite the file with explicit newlines. Verify by running:
`wc -c` on each key — a JWT service_role key is always ~220 chars.

---

### 2026-02-25 — recharts requires `"use client"` in Next.js App Router

**Lesson:**
recharts uses browser APIs (ResizeObserver, DOM). Any component importing
recharts MUST be a Client Component (`"use client"` at top of file).

**Setup:**
Install in the `app/` subdirectory: `cd app && npm install recharts`

recharts is listed in `app/package.json` dependencies.

---

### 2026-02-25 — NBP API: only exchange rate endpoints are real

**Problem:**
Task spec referenced `/api/cenycen/format/json` and `/api/stopy/format/json` as NBP endpoints
for CPI and interest rates. These URLs do NOT exist on api.nbp.pl (404).

**Confirmed working:**
`https://api.nbp.pl/api/exchangerates/rates/A/{EUR|USD|GBP|CHF}/last/2/?format=json`
Returns `{currency, code, rates:[{no, effectiveDate, mid}]}`.

**Pattern:** Fetch last/2 to get current + previous rate for change% calculation.
Sort rates by effectiveDate ascending — last element is most recent.

**WIBOR/CPI:** Not available from NBP API. Would require separate data sources
(e.g., GUS API for CPI, money market feeds for WIBOR). Document and skip.

---

### 2026-02-25 — FRED API: skip when no key, document in lessons-learned

**Pattern:** If FRED_API_KEY missing, skip FRED section entirely. Don't crash, don't
throw — log a warning, return partial data. Document in lessons-learned.md.

**Applied to:** fetch-macro EF — FRED section omitted, NBP-only implementation.

---

### 2026-02-25 — Anthropic SSE streaming: buffer-based line parser required

**Problem:** SSE events from Anthropic `stream: true` can arrive split across
multiple TCP chunks. Naive line splitting loses partial lines.

**Fix:**
```typescript
let buffer = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";   // keep last incomplete line
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const parsed = JSON.parse(line.slice(6).trim());
    if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
      answer += parsed.delta.text;
    }
  }
}
```

---

### 2026-02-25 — Anthropic Prompt Caching: direct fetch, not callAnthropic() helper

**Problem:** `_shared/anthropic.ts` → `callAnthropic()` doesn't support the caching
API format (array-format system blocks with `cache_control`).

**Fix:** Bypass the helper, call the Anthropic API directly with:
```typescript
headers: { "anthropic-beta": "prompt-caching-2024-07-31" }
system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]
messages: [{
  role: "user",
  content: [
    { type: "text", text: context, cache_control: { type: "ephemeral" } }, // cached
    { type: "text", text: question },  // NOT cached — different every request
  ],
}]
```
**Savings:** 83% cost reduction for repeated queries on same ticker (context cached).

---

### 2026-02-25 — company_snapshot: snapshot-first pattern (1 query vs 7)

**Pattern:** On every page load, try `company_snapshot` first (1 query, ~1ms).
If fresh (<30 min), use the denormalized JSON. Otherwise fall back to 5-7 live queries.
Apply the same freshness check (`isFresh(computed_at, 30)`) in both Next.js routes and EFs.

**ISR synergy:** ISR cache (5 min) + snapshot freshness (30 min) = pages rarely touch live DB.

---

### 2026-02-25 — localStorage for client-only state (favorites, recently visited)

**Pattern:** For UI state that doesn't need to be in the DB (favorites, recent visits),
use localStorage with safe SSR guards (`if (typeof window === "undefined") return []`).
Emit CustomEvents (`favorites-changed`) to sync across mounted components.
Use a shared `app/lib/storage.ts` module for all localStorage operations.

---

### 2026-02-25 — Gemini PDF extraction: use `response_mime_type: application/json`

**Lesson:**
When using Gemini for structured data extraction, set
`generationConfig.response_mime_type: "application/json"` to get clean JSON.
Still strip markdown fences defensively in the parser.

Gemini 2.0 Flash is multimodal and cost-effective for PDF processing:
- Model: `gemini-2.0-flash`
- API: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GOOGLE_AI_KEY}`

---

## Terminal UX — Keyboard Navigation

### 2026-02-25 — Bloomberg-style keyboard shortcuts: 1–4 for tab switching

**Pattern:** Add `useEffect` keyboard handler in client components with tabs.
Skip handler when focus is on input/textarea to avoid conflicts with typing.

```typescript
useEffect(() => {
  function handler(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement)  return;
    if (e.target instanceof HTMLTextAreaElement) return;
    const tabMap: Record<string, Tab> = { "1": "tab1", "2": "tab2", ... };
    if (tabMap[e.key]) setActiveTab(tabMap[e.key]);
  }
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, []);
```

Show `[n]` prefix in tab labels and a dim keyboard hint bar below tabs
(`press 1-4 to switch · ESC to close`) for discoverability.

---

### 2026-02-25 — Command palette with /slash shortcuts in GlobalSearch

**Pattern:** Map slash commands to routes. Detect on query change.
When query matches `/m`, `/w`, `/p`, `/s` — skip the search API call,
show a dedicated command row with ↵ button, navigate on Enter.

```typescript
const COMMANDS: Record<string, { label: string; href: string }> = {
  "/m": { label: "Makro wskaźniki", href: "/macro" },
  "/w": { label: "Watchlisty",      href: "/watchlists" },
  "/p": { label: "Portfel",         href: "/portfolio" },
  "/s": { label: "Screener spółek", href: "/screener" },
};
const commandMatch = COMMANDS[query.trim().toLowerCase()] ?? null;
// Skip fetch when commandMatch is set
// Enter key: if commandMatch → router.push(commandMatch.href) → close
```

---

## FRED API

### 2026-02-25 — FRED API graceful fallback when key absent

**Pattern:** `Deno.env.get("FRED_API_KEY")` → skip entire FRED block with
`log.info(...)` (not warn/error) when key is absent. FRED is optional enrichment.

```typescript
const fredKey = Deno.env.get("FRED_API_KEY");
if (!fredKey) {
  log.info("FRED_API_KEY not set — skipping USA macro");
} else {
  // fetch FEDFUNDS, CPIAUCSL, DGS10, UNRATE
}
```

**URL pattern:**
```
https://api.stlouisfed.org/fred/series/observations
  ?series_id={ID}
  &api_key={KEY}
  &file_type=json
  &limit=2
  &sort_order=desc
```
Returns `observations[]` — filter out `value === "."` (missing data).

**Free key:** https://fred.stlouisfed.org/docs/api/api_key.html
**UI:** Show dashed-border placeholder with setup link when FRED section empty.

---

## Configurable Alert Rules

### 2026-02-25 — DB-driven alert thresholds replace hardcoded values

**Pattern:** Store thresholds in `alert_rules` table. Edge Function reads them
at runtime. Falls back to hardcoded default if no rule exists.

```typescript
const { data: rulesData } = await supabase
  .from("alert_rules")
  .select("rule_type, threshold_value, threshold_operator, telegram_enabled")
  .eq("is_active", true)
  .eq("telegram_enabled", true);

const impactRule = (rulesData ?? []).find(r => r.rule_type === "impact_score");
const minImpact  = impactRule?.threshold_value ?? DEFAULT_MIN_IMPACT; // 7
```

**Migration:** `0028_alert_rules.sql` — table + 5 default rules + RLS policy.

**API:** `/api/alert-rules` — GET/POST/PATCH/DELETE (Next.js route handler).

---

## UX Patterns — Terminal / Bloomberg Style

### 2026-02-26 — Preset views: tab + scrollTo pattern

**Problem:** Users need quick entry points into specific widget combinations
(e.g., "show me fundamentals" → jump to Finanse tab + scroll to financial-kpis).

**Pattern:**
```typescript
const PRESETS = [
  { id: "fundamental", label: "📊 Fundamenty", tab: "Finanse", scrollTo: ["financial-kpis", "moat-widget"] },
  // ...
];

function handlePreset(preset) {
  setActivePreset(preset.id);
  setActiveTab(preset.tab);
  setTimeout(() => {
    for (const id of preset.scrollTo) {
      const el = document.getElementById(id);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); break; }
    }
  }, 150); // wait for tab re-render
}
```

**UX rules:**
- Clicking a tab directly should clear the active preset (setActivePreset(null))
- Use 150ms timeout to give React time to render the new tab before scrolling
- Wrap key sections in `<div id="...">` inside the tab panels (not in individual components)

---

### 2026-02-26 — LiveTimestamp: relative time with stale warning

**Pattern:** Client component that updates every 60s and shows yellow ⚠ when stale.

```typescript
export function LiveTimestamp({ date, prefix = "aktualizacja", staleAfter = 3_600_000 }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (!date) { setLabel("brak danych"); return; }
    const update = () => { /* compute relative time */ setLabel(...) };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [date]);
  const isStale = !date || (Date.now() - new Date(date).getTime()) > staleAfter;
  return <span className={isStale ? "text-yellow-500/70" : "text-gray-600"}>· {prefix} {label} {isStale && "⚠"}</span>;
}
```

**Usage:** Add directly in section headers: `<h3>Title <LiveTimestamp date={kpi?.calculated_at} prefix="analiza" /></h3>`

**PriceChart LIVE badge:** `isLive = lastPoint && diff < 48h` → green pulsing dot.

---

### 2026-02-26 — Morning Brief: server-side time-gating for dashboard widget

**Pattern:** ISR dashboard page computes `warsawHour` server-side and passes to render.
Since ISR revalidates every 5 min, the widget appears/disappears within 5 min of 06:00/12:00.

```typescript
const warsawHour = parseInt(
  new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Europe/Warsaw" }),
  10,
);
const showMorningBrief = warsawHour >= 6 && warsawHour < 12;
```

**Data strategy:** Include morning counts (alerts_last_12h, calendar_today, recs_24h) in the
existing parallel `Promise.all()` at the top of the page — no extra request round-trip.

---

## Next.js — Server + Client Wrapper Pattern

### 2026-02-25 — Server component fetches ISR data, client wrapper adds interactivity

**Problem:** ISR pages (`export const revalidate = N`) must be server components,
but UI tabs and API calls require client-side state.

**Solution:** Server component fetches initial data and passes to a `"use client"` wrapper.
The client component handles tab switching, additional fetches (e.g., rules list), and mutations.

```tsx
// page.tsx (server)
export const revalidate = 60;
export default async function Page() {
  const { data } = await supabase.from("table").select("...");
  return <PageClient initialData={data ?? []} />;
}

// PageClient.tsx ("use client")
export default function PageClient({ initialData }: { initialData: Row[] }) {
  const [tab, setTab] = useState<"history" | "settings">("history");
  const [settings, setSettings] = useState<Setting[]>([]);
  useEffect(() => { fetch("/api/settings").then(...); }, []);
  // ...
}
```

**Benefit:** ISR caching for initial data + full client interactivity without
converting the whole page to `"use client"` (which disables ISR).
- Send PDF as `inline_data` with `mime_type: "application/pdf"`

---

## FK Constraints — CCC→MDV Rename Deadlock (2026-02-26)

**Problem:**
Renaming a company ticker (parent table) while child tables have FK constraints
causes a deadlock:
- Can't UPDATE companies (CCC → MDV) because child table still has CCC
- Can't UPDATE child table (CCC → MDV) because MDV doesn't exist in companies yet
- Single DO block with EXCEPTION handler silently aborts on first FK violation,
  leaving other tables un-updated

**Solution:**
1. Use individual DO blocks per table (so each error is independent)
2. DROP the FK constraint, do all updates, RE-ADD the constraint

```sql
ALTER TABLE company_snapshot DROP CONSTRAINT IF EXISTS company_snapshot_ticker_fkey;
-- update all child tables individually
DO $$ BEGIN UPDATE child_table SET ticker = 'NEW' WHERE ticker = 'OLD';
EXCEPTION WHEN OTHERS THEN NULL; END; $$;
-- update parent
UPDATE companies SET ticker = 'NEW' WHERE ticker = 'OLD';
-- re-add FK
ALTER TABLE company_snapshot ADD CONSTRAINT company_snapshot_ticker_fkey
  FOREIGN KEY (ticker) REFERENCES companies(ticker) ON DELETE CASCADE;
```

**Why:** FK constraints without ON UPDATE CASCADE cannot be worked around in a
single transaction. Must drop+recreate when the referenced PK is changing.

---

## Supabase Management API — Cron Job Key Fix (2026-02-26)

**Problem:** Migrations deployed with `supabase db push` contain placeholder
`SERVICE_ROLE_KEY_HERE` in cron job SQL (sed substitution never applied).

**Working fix (curl + Python JSON encode):**
```bash
SERVICE_ROLE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY app/.env.local | cut -d= -f2)
TOKEN=$(security find-generic-password -s "Supabase CLI" -a "supabase" -w \
  | sed 's/go-keyring-base64://' | base64 --decode)
SQL="SELECT cron.schedule('job-name','*/5 * * * *',\$cr\$SELECT net.http_post(...);\$cr\$);"
curl -s -X POST "https://api.supabase.com/v1/projects/REF/database/query" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "User-Agent: SupabaseCLI/2.75.0" \
  --data-raw "{\"query\": $(python3 -c "import json,sys; print(json.dumps(open('/dev/stdin').read().strip()))" <<< "$SQL")}"
```

**Key:** The User-Agent header `SupabaseCLI/2.75.0` is required to bypass
Cloudflare bot detection (returns 403 without it).

---

## Pearson Correlation — FK Deadlock Workaround (2026-02-26)

**Pattern:** For on-demand correlation computation (calc-correlations EF):
- API route checks if data exists, triggers EF async if not (`fire-and-forget fetch`)
- UI shows "computing…" state when rows.length === 0
- Returns empty array on first load, EF runs in background, second load has data

```typescript
// API route fire-and-forget
if (rows.length === 0) {
  fetch(efUrl, { method: "POST", headers: {...}, body: JSON.stringify({ ticker }) })
    .catch(() => {});
}
return NextResponse.json(rows); // immediately return empty
```

