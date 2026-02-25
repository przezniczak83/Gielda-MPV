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
