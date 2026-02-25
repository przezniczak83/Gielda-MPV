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
