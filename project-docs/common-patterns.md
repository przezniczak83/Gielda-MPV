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
```
