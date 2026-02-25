# Giełda Monitor — Architecture v3.1

## Stack
- **Frontend**: Next.js 16 (App Router) on Vercel
- **Backend**: Supabase (PostgreSQL + Edge Functions + pg_cron + RLS)
- **Scraper**: Railway (Node.js/Express — bypasses Edge Function IP blocks)
- **AI**: Claude Sonnet (complex), Claude Haiku (analytics), Gemini Flash (PDF/bulk)

---

## Data Flow Diagram

```
GPW ESPI (co 15min)     Email IMAP (co 15min)
        ↓                        ↓
   fetch-espi              fetch-email
        ↓                        ↓
        └──────────────► raw_ingest (staging)
                                 ↓
                         process-raw (co 30min)
                                 ↓
                         company_events
                          ↓         ↓          ↓
          send-alerts (co 5min)  ai-query   analyze-*
               ↓             (on-demand)   (on-demand)
           Telegram                ↓             ↓
                               AI Chat UI   company_kpis

Yahoo Finance / Stooq (Railway, co 18:00)
        ↓
   fetch-prices
        ↓
  price_history
        ↓
calc-multiples (co 19:05)
        ↓
valuation_multiples

SEC EDGAR (co 20:00, USA only)
        ↓
   fetch-sec
        ↓
company_financials

ESPI Art.69 → fetch-ownership → institutional_ownership
PDF reports → extract-pdf / process-dm-pdf → company_financials + analyst_forecasts
```

---

## Edge Functions Contracts

### fetch-espi
- **Trigger**: cron `*/15 * * * *`
- **Input**: none
- **Output**: `{ok, inserted, source, ts}`
- **Reads**: companies
- **Writes**: raw_ingest

### fetch-email
- **Trigger**: cron `*/15 * * * *`
- **Input**: none
- **Output**: `{ok, processed, inserted, ts}`
- **Reads**: — (Gmail IMAP via env)
- **Writes**: raw_ingest

### process-raw
- **Trigger**: cron `*/30 * * * *`
- **Input**: none
- **Output**: `{ok, processed, skipped, ts}`
- **Reads**: raw_ingest, companies
- **Writes**: company_events, raw_ingest (processed_at)

### send-alerts
- **Trigger**: cron `*/5 * * * *`
- **Input**: none
- **Output**: `{ok, sent, failed, ts}`
- **Reads**: company_events (alerted_at IS NULL, impact_score >= 7)
- **Writes**: company_events (alerted_at)

### fetch-prices
- **Trigger**: cron `0 18 * * 1-5` (weekdays 18:00 UTC)
- **Input**: none
- **Output**: `{ok, processed, ts}`
- **Reads**: companies
- **Writes**: price_history

### calc-multiples
- **Trigger**: cron `5 19 * * 1-5` (weekdays 19:05 UTC)
- **Input**: none
- **Output**: `{ok, calculated, ts}`
- **Reads**: price_history, company_financials
- **Writes**: valuation_multiples

### fetch-sec
- **Trigger**: cron `0 20 * * 1-5` (weekdays 20:00 UTC)
- **Input**: `{}` or `{ticker: string}`
- **Output**: `{ok, processed, results[]}`
- **Reads**: companies (market='USA'), SEC EDGAR API
- **Writes**: company_financials (max 3 tickers/call, 1s sleep)

### analyze-health
- **Trigger**: on-demand (POST from /api/analyze)
- **Input**: `{ticker: string}`
- **Output**: `{ok, ticker, score, components[], comment, ts}`
- **Reads**: company_financials
- **Writes**: company_kpis (kpi_type='health_score')

### detect-flags
- **Trigger**: on-demand (POST from /api/analyze)
- **Input**: `{ticker: string}`
- **Output**: `{ok, ticker, flags_count, flags[], ts}`
- **Reads**: company_financials, company_events
- **Writes**: company_kpis (kpi_type='red_flags')

### analyze-dividend
- **Trigger**: on-demand (POST from /api/analyze)
- **Input**: `{ticker: string}`
- **Output**: `{ok, ticker, cut_risk, score, ts}`
- **Reads**: company_financials, company_events
- **Writes**: company_kpis (kpi_type='dividend_score')

### analyze-earnings
- **Trigger**: on-demand (POST from /api/analyze)
- **Input**: `{ticker: string}`
- **Output**: `{ok, ticker, score, components[], ts}`
- **Reads**: company_financials, company_events
- **Writes**: company_kpis (kpi_type='earnings_quality')

### analyze-moat
- **Trigger**: on-demand (POST from /api/analyze, tech sector only)
- **Input**: `{ticker: string}`
- **Output**: `{ok, ticker, overall_moat, moat_strength, dimensions, ts}`
- **Reads**: companies, company_events, company_financials
- **Writes**: company_kpis (kpi_type='moat_score')

### gen-forecast
- **Trigger**: on-demand (POST from /api/gen-forecast)
- **Input**: `{ticker: string}`
- **Output**: `{ok, ticker, forecast, ts}`
- **Reads**: company_financials, company_events, analyst_forecasts
- **Writes**: our_forecasts

### ai-query
- **Trigger**: on-demand (POST from /api/news — AiChat component)
- **Input**: `{ticker: string, question: string}`
- **Output**: `{ok, ticker, answer, model_used, ts}`
- **Reads**: companies, company_events, price_history
- **Writes**: — (read-only)

### extract-pdf
- **Trigger**: on-demand (POST from /api/upload-pdf)
- **Input**: `{ticker: string, pdf_url: string}`
- **Output**: `{ok, ticker, extracted, ts}`
- **Reads**: Supabase Storage (signed URL)
- **Writes**: company_financials

### process-dm-pdf
- **Trigger**: on-demand (POST from /api/upload-dm-pdf)
- **Input**: `{ticker: string, pdf_url: string}`
- **Output**: `{ok, ticker, recommendations[], ts}`
- **Reads**: Supabase Storage (signed URL)
- **Writes**: analyst_forecasts, early_recommendations

### fetch-insider
- **Trigger**: on-demand (POST)
- **Input**: `{ticker?: string}`
- **Output**: `{ok, scanned, found, ts}`
- **Reads**: company_events (MAR Art.19 keywords)
- **Writes**: — (alerts only via Telegram)

### fetch-ownership
- **Trigger**: on-demand (POST)
- **Input**: `{ticker?: string}`
- **Output**: `{ok, processed, ts}`
- **Reads**: company_events (Art.69 ESPI keywords)
- **Writes**: institutional_ownership

---

## Shared Utils (`_shared/`)

Located at `supabase/functions/_shared/`. Auto-bundled by Supabase CLI on deploy.

| Module | Usage |
|---|---|
| `supabase-client.ts` | `getSupabaseClient()` — creates typed client from env. Use in every EF that touches DB. |
| `logger.ts` | `createLogger(name)` → `{info, warn, error, debug}`. Prefixes all logs with `[function-name]`. |
| `response.ts` | `okResponse(data)` / `errorResponse(msg, status)` — consistent JSON response shape with `ts` field. |
| `model-router.ts` | `MODELS` registry — maps task keys to model IDs. Single source of truth for AI model selection. |
| `anthropic.ts` | `callAnthropic(modelKey, system, messages, maxTokens)` — uses MODELS registry, handles auth. |
| `gemini.ts` | `callGemini(prompt, maxTokens)` — Gemini Flash for bulk/PDF tasks. |
| `telegram.ts` | `sendTelegram(message)` — reads TELEGRAM_BOT_TOKEN/CHAT_ID from env, returns boolean. |

---

## Model Router

| Task | Model | Reasoning |
|---|---|---|
| `bulk_classification` | `gemini-2.0-flash` | Free tier, high throughput, bulk RSS classification |
| `pdf_extraction` | `gemini-2.0-flash` | Multimodal, low cost for structured extraction |
| `simple_summary` | `claude-haiku-4-5-20251001` | Fast, cheap, good Polish quality |
| `email_extraction` | `claude-haiku-4-5-20251001` | Simple extraction, low latency |
| `health_score` | `claude-haiku-4-5-20251001` | 1-sentence comment, 100 tokens |
| `red_flags` | `claude-haiku-4-5-20251001` | Structured flag extraction |
| `dividend` | `claude-haiku-4-5-20251001` | Simple risk classification |
| `earnings_quality` | `claude-haiku-4-5-20251001` | Short summary |
| `ai_chat` | `claude-sonnet-4-20250514` | Complex Q&A, nuanced Polish reasoning |
| `moat_analysis` | `claude-sonnet-4-20250514` | 7-dim structured analysis requires deep reasoning |
| `forecast_gen` | `claude-sonnet-4-20250514` | Multi-period financial projection |
| `pdf_complex` | `claude-sonnet-4-20250514` | Complex analyst reports with tables |

---

## Database Schema (key tables)

| Table | Purpose | RLS |
|---|---|---|
| `companies` | Master list — 102 tickers (GPW + USA) | anon_read |
| `raw_ingest` | ESPI/email staging — before process-raw | service_role only |
| `company_events` | Parsed events with impact_score, alerted_at | anon_read |
| `price_history` | OHLCV per ticker per day | anon_read |
| `company_financials` | P&L/BS data from PDFs + SEC EDGAR | anon_read |
| `company_kpis` | Computed scores (health, flags, moat, EQ…) | anon_read |
| `analyst_forecasts` | Buy/Sell recommendations + target prices | anon_read |
| `valuation_multiples` | P/E, EV/EBITDA, P/B per ticker | anon_read |
| `watchlists` | User watchlists | anon_read |
| `portfolio_positions` | User portfolio (private) | service_role only |
| `calendar_events` | Upcoming earnings/dividends/AGM | anon_read |
| `institutional_ownership` | Art.69 ownership disclosures | anon_read |
| `peer_groups` | Tech/sector peer group definitions | anon_read |

---

## Next.js API Routes

| Route | Method | Description |
|---|---|---|
| `/api/health` | GET | Full system health check — stats + pipeline status |
| `/api/search` | GET `?q=` | Global search (companies + events) |
| `/api/analyze` | POST `{ticker}` | Triggers 4-5 Edge Functions in parallel |
| `/api/company-kpis` | GET `?ticker=` | Financials + all KPI scores |
| `/api/calendar` | GET | Upcoming calendar events |
| `/api/portfolio` | GET/POST/DELETE | Portfolio positions + PnL |
| `/api/watchlists/smart` | GET | 3 smart watchlists (dynamic queries) |
| `/api/peers` | GET `?ticker=` | Peer group comparison data |
| `/api/ownership` | GET `?ticker=` | Institutional ownership |
