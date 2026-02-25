# Architecture Decisions

## 2026-02-XX – Project Structure Foundation

### Decision:
Use structured documentation system with:
- lessons-learned.md
- architecture-decisions.md
- common-patterns.md

### Rationale:
Compound Engineering methodology requires:
- explicit architectural tracking
- decision memory
- repeatable system patterns

### Consequence:
All major technical decisions must be documented here.

---

## Tech Stack (Planned)

- Frontend: Next.js (App Router)
- Backend: Supabase
- Database: PostgreSQL (via Supabase)
- AI Layer: OpenAI + Anthropic (cached)
- Caching: Redis (Upstash planned)
- Hosting: Vercel

---

## Database Philosophy

- Structured relational schema
- Clear separation:
  - raw_ingest
  - processed_events
  - financial_data
- All critical tables indexed
- RLS enabled for production

---

## 2026-02-25 — AI Model Selection

### Claude Sonnet for Chat (primary)

**Decision:** Use Claude claude-sonnet-4-20250514 as primary AI for /ai-query.

**Rationale:**
- Superior Polish language quality vs GPT-4o Mini
- Better financial reasoning and nuanced analysis
- Higher token limit (useful for long context with events + prices)

**Trade-off:** Higher cost per query vs GPT-4o Mini. Acceptable for MVP.

### GPT-4o Mini as Fallback

**Decision:** If Anthropic API fails (5xx, rate limit), fall through to GPT-4o Mini.

**Rationale:** Ensures availability even during Anthropic outages.

### Gemini 2.0 Flash for PDF Extraction

**Decision:** Use Gemini 2.0 Flash for extracting financial data from PDF reports.

**Rationale:**
- Native multimodal support — handles PDFs as inline_data without external parser
- Cost-effective for bulk processing (lower price per token than Sonnet)
- Good structured output via `response_mime_type: application/json`
- GOOGLE_AI_KEY separately managed from Anthropic key

**Trade-off:** Gemini response quality for Polish PDFs may vary; fallback to
manual re-trigger if extraction fails.

---

## 2026-02-25 — Yahoo Finance as Price Data Source

**Decision:** Use Yahoo Finance instead of Stooq.pl for price history.

**Rationale:**
Stooq.pl blocks all server-side requests from Edge Function IPs (requires
browser session cookies). Yahoo Finance API works from server environments.

**Details:**
- GPW: `{ticker}.WA` suffix (e.g., PKN.WA, KGHM.WA)
- USA: ticker used directly (e.g., AAPL, AMZN)
- Endpoint: `query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=30d`
- Returns JSON; parse timestamps + OHLCV arrays

**Risk:** Yahoo Finance is an unofficial API (no SLA). Monitor for breaking changes.

---

## 2026-02-25 — Financial Health Score & Red Flags as Computed KPIs

**Decision:** Store computed analysis (health score, red flags) in `company_kpis`
table rather than calculating on every page load.

**Rationale:**
- Claude Haiku calls take 1-2s each — too slow for page load
- Historical tracking: can see how scores change over time
- Decoupled computation: recalculate independently from rendering
- Single row per (ticker, kpi_type) via UNIQUE constraint + UPSERT

**Schema:**
```sql
company_kpis (ticker, kpi_type, value, metadata JSONB, calculated_at)
UNIQUE(ticker, kpi_type)
```

**Recalculation:** User clicks "Przelicz" → Next.js `/api/analyze` → calls
`analyze-health` and `detect-flags` Edge Functions in parallel → upserts results.

**Display:** Scores are read on page load from `company_kpis` (fast DB read).
Stale data is acceptable — badge shows `calculated_at` timestamp.

---

## 2026-02-25 — Railway Scraper as IP-Bypass Proxy Layer

**Decision:** Deploy a lightweight Express.js scraper to Railway for data sources
that block Supabase Edge Function IPs.

**Rationale:**
- Stooq.pl, GPW.pl, and some corporate sites block requests from Supabase's
  server IP ranges (cloud provider ranges detected as bots/scrapers)
- Railway's IP range is not blocked (residential/standard cloud)
- Edge Functions call Railway HTTP endpoints instead of scraping directly

**Architecture:**
```
Browser → Next.js API Route → Supabase Edge Function → Railway Scraper → stooq.pl
                                                                        → gpw.pl
```

**Security:** `X-API-Key` header auth. Key stored in Supabase Secrets + Vercel env vars.

**Files:** `scraper/` directory in repo root (separate from `app/`).

**Trade-off:** Extra hop + Railway service cost. Acceptable for MVP. Alternative would
be headless browser (Playwright) but that is more complex and expensive.

---

## 2026-02-25 — Supabase Storage for PDF Report Archival

**Decision:** Store uploaded PDF reports in Supabase Storage (`reports` bucket)
before passing to Gemini for extraction.

**Rationale:**
- Edge Functions have a 6MB request size limit — cannot send large PDFs directly
- Signed URLs let Edge Functions download PDFs from Storage without auth complexity
- PDF archive enables re-processing with different AI models later
- Private bucket (not public) with service_role-only access

**File naming:** `{TICKER}/{timestamp}_{sanitized_filename}` for organized browsing.

**Signed URL TTL:** 1 hour (sufficient for synchronous extraction pipeline).

---

## 2026-02-25 — recharts for Client-Side Price Charts

**Decision:** Use recharts for price history visualization on company detail pages.

**Rationale:**
- React-native chart library, integrates cleanly with Next.js App Router
- Responsive via `ResponsiveContainer` wrapper
- No canvas/WebGL dependencies — works in all browsers
- Dark theme customization via `stroke`, `fill`, `contentStyle` props

**Alternative considered:** Chart.js — more complex React integration, requires
additional react-chartjs-2 wrapper.

**Constraint:** Must be Client Component (`"use client"`) — recharts uses browser APIs.

---

## 2026-02-25 — pg_trgm for Fuzzy Deduplication

**Decision:** Use PostgreSQL pg_trgm extension for Level 2 event deduplication.

**Rationale:**
Simple SHA-256 hash dedup (Level 1) misses near-duplicate titles from
different ESPI/email sources. pg_trgm similarity() catches paraphrased
or slightly different titles of the same event.

**Implementation:**
- `find_fuzzy_duplicate(ticker, date, title, threshold=0.8)` PG function
- Called via `supabase.rpc()` from process-raw Edge Function
- GIN index on `company_events.title` for performance

**Threshold:** 0.8 chosen to catch same-day same-ticker near-duplicates
without false positives.
