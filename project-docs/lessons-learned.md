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

## AI & Prompt Engineering

### 2026-02-25 — Anthropic Claude Sonnet: primary for Polish text quality

**Lesson:**
Claude claude-sonnet-4-20250514 produces significantly better Polish financial
analysis than GPT-4o Mini. Use as primary, GPT-4o Mini as fallback.

Always implement try/catch → fallback pattern (see common-patterns.md).

### 2026-02-25 — Gemini PDF extraction: use `response_mime_type: application/json`

**Lesson:**
When using Gemini for structured data extraction, set
`generationConfig.response_mime_type: "application/json"` to get clean JSON.
Still strip markdown fences defensively in the parser.

Gemini 2.0 Flash is multimodal and cost-effective for PDF processing:
- Model: `gemini-2.0-flash`
- API: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GOOGLE_AI_KEY}`
- Send PDF as `inline_data` with `mime_type: "application/pdf"`
