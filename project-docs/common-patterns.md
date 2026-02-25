# Common Patterns

## Documentation Pattern

Every major implementation must follow:

1. PLAN – Research before coding
2. WORK – Implement according to plan
3. ASSESS – Self-review and test
4. COMPOUND – Document lessons learned

---

## Git Commit Pattern

- Small commits
- Descriptive commit messages
- One logical change per commit
- No massive "fix everything" commits

---

## Architecture Pattern

- Clear separation of concerns:
  - ingestion layer
  - processing layer
  - storage layer
  - analysis layer
  - UI layer

- No business logic inside UI components.
- Database queries abstracted into services.

---

## AI API Call with Fallback Pattern

Used in ai-query Edge Function. Primary → Fallback → Error.

```typescript
const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const openaiKey    = Deno.env.get("OPENAI_API_KEY")    ?? "";

let answer: string;
let modelUsed: string;

if (anthropicKey) {
  try {
    answer    = await callAnthropic(anthropicKey, userMsg);
    modelUsed = "claude-sonnet-4-20250514";
  } catch (err) {
    console.warn("Anthropic failed, trying OpenAI fallback:", err.message);
    if (!openaiKey) throw err;
    answer    = await callOpenAI(openaiKey, userMsg);
    modelUsed = "gpt-4o-mini (fallback)";
  }
} else if (openaiKey) {
  answer    = await callOpenAI(openaiKey, userMsg);
  modelUsed = "gpt-4o-mini";
} else {
  throw new Error("No AI key configured");
}
```

**Rule:** Always return `model_used` in the response so clients can display it.

---

## Yahoo Finance URL Pattern (GPW + USA)

```typescript
function toYahooSymbol(ticker: string, market: string): string {
  return market === "GPW" ? `${ticker}.WA` : ticker;
}

const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=30d`;
```

**Parse response:**
```typescript
const result     = data.chart.result[0];
const timestamps = result.timestamp;                       // Unix seconds[]
const quote      = result.indicators.quote[0];             // {open, high, low, close, volume}
const date       = new Date(ts * 1000).toISOString().slice(0, 10); // YYYY-MM-DD
```

**Note:** Skip rows where `quote.close[i] === null` (trading halts, holidays).

---

## Supabase RPC Pattern for Custom PG Functions

Use for queries that need PostgreSQL functions not available via JS client
(e.g., similarity(), custom aggregations).

```typescript
const { data, error } = await supabase.rpc("function_name", {
  param1: value1,
  param2: value2,
});
```

Always handle `error` gracefully — if the function doesn't exist yet (e.g.,
migration pending), log a warning and continue:

```typescript
if (error) {
  console.warn(`[module] rpc error (skipping): ${error.message}`);
} else if (data) {
  // use result
}
```

---

## Gemini PDF Extraction Pattern

```typescript
const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

const body = {
  contents: [{
    parts: [
      { inline_data: { mime_type: "application/pdf", data: pdfBase64 } },
      { text: "Extract... Return JSON: {...}" },
    ],
  }],
  generationConfig: {
    temperature: 0.1,
    response_mime_type: "application/json",
  },
};
```

Always strip markdown fences from response text before JSON.parse():
```typescript
const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
```

---

## Cron Job Migration Pattern (pg_cron + pg_net)

From migrations 0003, 0005, 0006 — idempotent cron setup:

```sql
-- Unschedule if exists (idempotent re-run)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-name') THEN
    PERFORM cron.unschedule('job-name');
  END IF;
END;
$$;

-- Schedule
SELECT cron.schedule(
  'job-name',
  '*/30 * * * *',
  $cron_body$
  SELECT net.http_post(
    url     := 'https://{ref}.supabase.co/functions/v1/{function}',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer SERVICE_ROLE_KEY_HERE'
    ),
    body := '{}'::jsonb
  );
  $cron_body$
);
```

Deploy: `sed "s/SERVICE_ROLE_KEY_HERE/$SERVICE_ROLE_KEY/" file.sql | supabase db push --linked`

---

## Telegram Alert Pattern

Used in send-alerts and fetch-insider Edge Functions.

```typescript
async function sendTelegram(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      chat_id:    chatId,
      text,
      parse_mode: "Markdown",   // v1 — more lenient than MarkdownV2
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body}`);
  }
}
```

**Message format example:**
```
🚨 *ALERT GIEŁDOWY*
📊 *PKN* (earnings)
📝 Wyniki Q4 2025
⚡ Impact: *8/10*
📅 2026-02-25
```

**Rate limiting:** Add `sleep(300)` between consecutive sends.

**Config:** `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` in Supabase Secrets.

---

## Idempotent Alert Pattern (alerted_at IS NULL)

Used in send-alerts, fetch-insider, early_recommendations.

```typescript
// 1. Query only unalerted records
const { data: events } = await supabase
  .from("company_events")
  .select("id, ...")
  .gte("impact_score", 7)
  .is("alerted_at", null)           // NOT YET SENT
  .gte("created_at", windowStart);  // time window

// 2. Send alert
await sendTelegram(token, chatId, message);

// 3. Mark as alerted immediately after
await supabase
  .from("company_events")
  .update({ alerted_at: new Date().toISOString() })
  .eq("id", event.id);
```

**Schema:** `alerted_at timestamptz` column with partial index:
```sql
CREATE INDEX IF NOT EXISTS idx_company_events_alerted_at
  ON company_events(alerted_at)
  WHERE alerted_at IS NOT NULL;
```

---

## RSS Parsing Pattern (Deno / no DOM)

Used in fetch-espi Edge Function. Regex-based RSS 2.0 parser (no DOMParser
available in Deno server context).

```typescript
/** Split RSS XML into individual <item> strings. */
function splitItems(xml: string): string[] {
  const items: string[] = [];
  let pos = 0;
  while (true) {
    const start = xml.indexOf("<item>", pos);
    if (start === -1) break;
    const end   = xml.indexOf("</item>", start);
    if (end === -1) break;
    items.push(xml.slice(start, end + 7));
    pos = end + 7;
  }
  return items;
}

/** Extract text from tag, handles CDATA. */
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, "s"
  );
  return re.exec(xml)?.[1].trim() ?? "";
}
```

**Parse pubDate to ISO:**
```typescript
const iso = new Date(raw).toISOString(); // works for RFC 822 dates
```

**Note:** Bankier ESPI RSS title format: `"COMPANY NAME S.A.: announcement"`.
Extract ticker by matching all-caps 2-6 char words against watchlist.

---

## recharts Price Chart Pattern (Next.js App Router)

For client-side price charts with dark theme:

```typescript
"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// Dynamic Y-axis domain to avoid flat chart on small price ranges:
const prices = data.map(d => d.close).filter(Boolean);
const minP = Math.min(...prices);
const maxP = Math.max(...prices);
const domain: [number, number] = [minP * 0.995, maxP * 1.005];

<ResponsiveContainer width="100%" height={220}>
  <LineChart data={data}>
    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
    <XAxis dataKey="date" tickFormatter={d => d.slice(5)} tick={{ fill: "#6b7280", fontSize: 11 }} />
    <YAxis domain={domain} tick={{ fill: "#6b7280", fontSize: 11 }} tickFormatter={v => v.toFixed(2)} width={60} />
    <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8 }} />
    <Line type="monotone" dataKey="close" stroke="#22c55e" strokeWidth={2} dot={false} />
  </LineChart>
</ResponsiveContainer>
```

**Date trimming:** `d.slice(5)` converts `"2026-02-25"` → `"02-25"` for compact X-axis.

**Y-axis domain:** `[min * 0.995, max * 1.005]` gives 0.5% padding — prevents flat line for narrow ranges.

---

## Supabase Storage Upload Pattern (Next.js Route Handler)

For multipart PDF upload from browser → Supabase Storage → Edge Function:

```typescript
// 1. Accept multipart form
const formData = await request.formData();
const file     = formData.get("file") as File | null;
const ticker   = (formData.get("ticker") as string)?.toUpperCase();

// 2. Upload to Storage
const fileName = `${ticker}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
const { error } = await supabase.storage
  .from("reports")
  .upload(fileName, file, { contentType: "application/pdf", upsert: false });

// 3. Create signed URL for downstream Edge Function (avoids 6MB EF request limit)
const { data: signed } = await supabase.storage
  .from("reports")
  .createSignedUrl(fileName, 3600);  // 1 hour TTL

// 4. Call Edge Function with signed URL instead of raw file bytes
await fetch(`https://${ref}.supabase.co/functions/v1/extract-pdf`, {
  method:  "POST",
  headers: { "Authorization": `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
  body:    JSON.stringify({ ticker, pdf_url: signed.signedUrl }),
});
```

**Signed URL strategy:** Never send large files directly to Edge Functions (6MB limit).
Upload first, then pass the signed URL to the function.

---

## Railway Scraper Pattern (Express + Node.js)

For scraping sites that block Supabase Edge Function IPs:

```
scraper/
  index.js            Express server (PORT from env)
  scrapers/stooq.js   Stooq CSV price fetcher
  scrapers/insider.js Cheerio HTML scraper
  Procfile            web: node index.js
  package.json        type: "module", express, node-fetch, cheerio
```

**Auth middleware:**
```javascript
function requireApiKey(req, res, next) {
  if (req.headers["x-api-key"] !== process.env.SCRAPER_API_KEY)
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  next();
}
```

**Deploy:** `railway up` from `scraper/` directory. Set `SCRAPER_API_KEY` env var in Railway dashboard.

**Calling from Supabase Edge Function:**
```typescript
const res = await fetch(`${Deno.env.get("SCRAPER_BASE_URL")}/prices/gpw?ticker=${ticker}`, {
  headers: { "X-API-Key": Deno.env.get("SCRAPER_API_KEY") },
});
```

---

## Financial Health Score Pattern (weighted average, 5 components)

```typescript
// Score components with weights (must sum to 1.0 when normalized)
const components = [
  { name: "debt_ebitda",    score: scoreDebtEbitda(ratio),  weight: 0.25 },
  { name: "fcf_revenue",    score: scoreMarginPct(pct),     weight: 0.25 },
  { name: "roe",            score: scoreROE(pct),           weight: 0.20 },
  { name: "revenue_growth", score: scoreGrowth(pct),        weight: 0.15 },
  { name: "net_margin",     score: scoreMarginPct(pct),     weight: 0.15 },
].filter(c => c.score > 0);  // skip if data unavailable

// Normalize weights so partial data still gives valid score
const totalWeight = components.reduce((s, c) => s + c.weight, 0);
const score = components.reduce((s, c) => s + c.score * (c.weight / totalWeight), 0);
```

**Scoring functions (higher = better):**
- `scoreDebtEbitda(x)`: <2x=10, 2-3x=7, 3-5x=4, >5x=1
- `scoreMarginPct(pct)`: >15%=10, 5-15%=7, 0-5%=4, <0=1
- `scoreROE(pct)`: >20%=10, 10-20%=7, 5-10%=4, <5%=1
- `scoreGrowth(pct)`: >20%=10, 5-20%=7, 0-5%=4, <0=1

---

## Red Flags Detection Pattern (10 signals)

```typescript
// Financial flags from company_financials (last 4 periods)
const flags: RedFlag[] = [];

// RF01: Revenue decline >10% YoY
const growthPct = ((latest.revenue - prev.revenue) / Math.abs(prev.revenue)) * 100;
if (growthPct < -10) flags.push({ code: "RF01", severity: "MEDIUM", ... });

// RF02: Consecutive negative quarters
const negMargin = rows.filter(r => r.net_income < 0);
if (negMargin.length >= 2 && rows[0].net_income < 0 && rows[1].net_income < 0)
  flags.push({ code: "RF02", severity: "HIGH", ... });

// Event keyword flags (last 30 days of company_events)
const restructureKw = ["restrukturyzacja", "zwolnienia", "odpis"];
const legalKw       = ["postępowanie", "pozew", "knf", "uokik"];
const hit = events.find(e => kws.some(k => e.title.toLowerCase().includes(k)));
```

**Severity mapping:**
- HIGH: RF01 decline >20%, RF02 persistent losses, RF04 debt>8x, RF06, RF07, RF08 sell>5M
- MEDIUM: RF03, RF04 debt 5-8x, RF05, RF08 sell>500k, RF10 no data
- LOW: RF09 low-impact cluster, RF10 stale data

---

## Stooq CSV Parsing Pattern (Node.js)

Stooq returns Polish-header CSV; use fixed column indices:

```javascript
// Columns: Data(0), Otwarcie(1), Najwyzszy(2), Najnizszy(3), Zamkniecie(4), Wolumen(5)
const url = `https://stooq.pl/q/d/l/?s=${ticker.toLowerCase()}&i=d`;
const csv = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 ..." } })).text();
if (csv.trim() === "Brak danych") throw new Error("No data");
const lines = csv.trim().split("\n").filter(Boolean);
const last  = lines[lines.length - 1].split(",");
return { date: last[0], open: +last[1], high: +last[2], low: +last[3], close: +last[4], volume: +last[5] };
```

**Note:** No `.pl` suffix for GPW tickers. `pkn` not `pkn.pl`.

---

## NBP Exchange Rate Pattern

```typescript
async function fetchNBPRate(code: string): Promise<{ current: NBPRate; previous: NBPRate } | null> {
  const url = `https://api.nbp.pl/api/exchangerates/rates/A/${code}/last/2/?format=json`;
  const res  = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!res.ok) return null;
  const data = await res.json();
  const rates = data.rates.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  return { current: rates[rates.length - 1], previous: rates[rates.length - 2] };
}

// Change % calculation
const changePct = ((current.mid - previous.mid) / previous.mid) * 100;
```

**Confirmed working currencies:** EUR, USD, GBP, CHF, JPY (table A rates only).
**Confirmed NOT working:** `/api/cenycen/`, `/api/stopy/` — these endpoints don't exist.

---

## Sentiment Analysis Pattern (Claude Haiku JSON)

```typescript
const SYSTEM_PROMPT = [
  "Odpowiadaj WYŁĄCZNIE w formacie JSON (bez komentarzy).",
  "Format: { overall_score: -1.0..+1.0, overall_label: BULLISH|NEUTRAL|BEARISH,",
  "  news_analysis: [{title, sentiment: positive|neutral|negative}], summary: string }",
].join(" ");

const raw = await callAnthropic("health_score", SYSTEM_PROMPT, [{ role: "user", content: eventList }], 600);
const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
const result = JSON.parse(cleaned);

// Clamp score to valid range
const score = Math.max(-1, Math.min(1, Number(result.overall_score) || 0));
const label = ["BULLISH", "NEUTRAL", "BEARISH"].includes(result.overall_label) ? result.overall_label : "NEUTRAL";
```

**Storage:** Upsert to `company_sentiment` table with `onConflict: "ticker"`.

---

## CSV Export Pattern

```typescript
function escape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n"))
    return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map(r => headers.map(h => escape(r[h])).join(","))].join("\r\n");
}

// Return as download
return new Response(csv, {
  headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  },
});
```

---

## Screener Pattern (JSONB client-side filter)

For filtering on JSONB snapshot data — fetch all rows, filter in JS (up to ~200 companies):

```typescript
// Fetch all snapshots
const { data } = await db.from("company_snapshot").select("ticker, snapshot, computed_at").limit(200);

// Filter client-side
let rows = data ?? [];
if (market !== "ALL") rows = rows.filter(r => r.snapshot.company?.market === market);
if (health_min !== undefined) rows = rows.filter(r => (r.snapshot.kpis?.health_score ?? null) >= health_min);
if (price_max !== undefined) rows = rows.filter(r => (r.snapshot.price?.close ?? null) <= price_max);

// Sort + limit
rows.sort((a, b) => sort_dir * (getValue(a) - getValue(b)));
rows = rows.slice(0, limit);
```

**When to switch to SQL:** If companies exceed ~1000, switch to PostgreSQL JSONB operators:
`WHERE (snapshot->>'kpis')::jsonb->>'health_score')::numeric >= $1`

---

## Anthropic Streaming SSE Proxy Pattern (Next.js → Client)

```typescript
// Route handler (app/api/ai-query/route.ts)
const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
  body: JSON.stringify({ model, max_tokens: 500, stream: true, system, messages }),
  headers: { "anthropic-version": "2023-06-01", "x-api-key": apiKey }
});

// Forward SSE stream directly to client
return new Response(anthropicRes.body, {
  headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
});

// Client-side consumer (AiChat.tsx)
const reader = res.body!.getReader();
let buffer = "";
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const parsed = JSON.parse(line.slice(6).trim());
    if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta")
      answer += parsed.delta.text;
  }
}
```

---

## localStorage Favorites/Recently Visited Pattern

```typescript
// app/lib/storage.ts
const FAVORITES_KEY = "gm_favorites";
const RECENT_KEY    = "gm_recent";

export function isFavorite(ticker: string): boolean {
  if (typeof window === "undefined") return false;
  return JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]").includes(ticker);
}

export function toggleFavorite(ticker: string): boolean {
  const favs = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]");
  const idx  = favs.indexOf(ticker);
  if (idx === -1) { favs.push(ticker); } else { favs.splice(idx, 1); }
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs));
  window.dispatchEvent(new CustomEvent("favorites-changed")); // notify other components
  return idx === -1;
}

export function trackVisit(ticker: string, name: string): void {
  if (typeof window === "undefined") return;
  const recent = getRecentCompanies().filter(r => r.ticker !== ticker);
  localStorage.setItem(RECENT_KEY, JSON.stringify(
    [{ ticker, name, visitedAt: new Date().toISOString() }, ...recent].slice(0, 8)
  ));
}
```

**SSR guard:** Always check `typeof window === "undefined"` before localStorage access.
**Cross-component sync:** Use `CustomEvent("favorites-changed")` + `addEventListener`.

---

## Health Check Pattern

Parallel stats query with `Promise.allSettled` for resilience:

```typescript
const [companiesRes, eventsRes, lastIngestRes, lastPriceRes] =
  await Promise.allSettled([
    supabase.from("companies").select("*", { count: "exact", head: true }),
    supabase.from("company_events").select("*", { count: "exact", head: true }),
    supabase.from("raw_ingest").select("inserted_at").order("inserted_at", { ascending: false }).limit(1),
    supabase.from("price_history").select("date").order("date", { ascending: false }).limit(1),
  ]);

// Use status === "fulfilled" guard for each result
const companies = companiesRes.status === "fulfilled"
  ? (companiesRes.value.count ?? 0)
  : 0;
```

**Response shape:**
```json
{
  "ok": true,
  "ts": "2026-02-25T...",
  "stats": {
    "companies": 50,
    "events": 42,
    "last_ingest": "2026-02-25T08:52:12.853Z",
    "last_price": "2026-02-24"
  }
}

---

## Keyboard Navigation Pattern (Bloomberg Terminal UX)

Used in CompanyTabs, can be applied to any tabbed client component.

```typescript
useEffect(() => {
  function handler(e: KeyboardEvent) {
    // Never intercept when user is typing in a form field
    if (e.target instanceof HTMLInputElement)    return;
    if (e.target instanceof HTMLTextAreaElement) return;
    const tabMap: Record<string, Tab> = {
      "1": "Tab1", "2": "Tab2", "3": "Tab3", "4": "Tab4",
    };
    if (tabMap[e.key]) setActiveTab(tabMap[e.key]);
  }
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, []);
```

**UX conventions:**
- Prefix tab labels with `[n]` (e.g., `[1] Przegląd`)
- Show dim hint bar: `press 1–4 to switch · /m macro · /s screener`
- Slash commands (`/m`, `/w`, `/p`, `/s`) navigate to top-level routes

---

## FRED API Observation Fetch Pattern

```typescript
async function fetchFREDSeries(
  apiKey: string, seriesId: string,
): Promise<{ current: number; previous: number; date: string } | null> {
  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}&api_key=${apiKey}&file_type=json&limit=2&sort_order=desc`;
  const res  = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json() as { observations: { date: string; value: string }[] };
  const obs  = data.observations.filter(o => o.value !== ".");  // skip missing
  if (obs.length < 2) return null;
  return {
    current:  parseFloat(obs[0].value),
    previous: parseFloat(obs[1].value),
    date:     obs[0].date,
  };
}
```

**Available series for Polish investor context:**
| Series ID  | Name             | Notes              |
|------------|------------------|--------------------|
| FEDFUNDS   | Fed Funds Rate   | Monthly            |
| CPIAUCSL   | US CPI (YoY)     | Monthly            |
| DGS10      | US 10Y Treasury  | Daily              |
| UNRATE     | US Unemployment  | Monthly            |

**Free key:** https://fred.stlouisfed.org/docs/api/api_key.html
**Secret:** `supabase secrets set FRED_API_KEY=your_key`

---

## Configurable Alert Rules Pattern

Schema + API for DB-driven alert thresholds:

```sql
CREATE TABLE alert_rules (
  id                 bigserial    PRIMARY KEY,
  rule_name          text         NOT NULL,
  rule_type          text         NOT NULL CHECK (rule_type IN (
    'impact_score', 'price_change', 'health_score',
    'red_flags', 'insider_buy', 'new_recommendation'
  )),
  threshold_value    numeric(10,4) NULL,
  threshold_operator text          NULL CHECK (threshold_operator IN ('>', '<', '>=', '<=', '=')),
  ticker             text          NULL REFERENCES companies(ticker) ON DELETE CASCADE,
  is_active          boolean       NOT NULL DEFAULT true,
  telegram_enabled   boolean       NOT NULL DEFAULT true,
  created_at         timestamptz   NOT NULL DEFAULT now()
);
```

**Edge Function reads at runtime:**
```typescript
const { data: rulesData } = await supabase
  .from("alert_rules")
  .select("rule_type, threshold_value, threshold_operator, telegram_enabled")
  .eq("is_active", true)
  .eq("telegram_enabled", true);

const impactRule = (rulesData ?? []).find(r => r.rule_type === "impact_score");
const minImpact  = impactRule?.threshold_value ?? 7; // default fallback
```

**API route:** `/api/alert-rules` — GET/POST/PATCH/DELETE
**UI:** Inline toggle (is_active, telegram_enabled) + inline threshold edit + add form
```
