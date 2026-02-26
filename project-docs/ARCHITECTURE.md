# Giełda Monitor — Architecture

## Overview

Polish stock market monitoring app. Next.js 14 (App Router) frontend + Supabase
(Postgres + Edge Functions + pg_cron) backend.

## Stack

| Layer           | Technology                                         |
|-----------------|----------------------------------------------------|
| Frontend        | Next.js 14, App Router, Tailwind CSS               |
| Database        | Supabase Postgres (RLS enabled)                    |
| Edge Functions  | Deno (Supabase EF), deployed via CLI               |
| Scheduler       | pg_cron + net.http_post to EFs                     |
| AI              | Anthropic Claude (Haiku/Sonnet via API)            |
| Alerts          | Telegram Bot API + Resend email (RESEND_API_KEY)   |
| Deployment      | Vercel (Next.js) + Supabase cloud                  |

## Directory Structure

```
/
├── app/                        # Next.js application
│   ├── app/                    # App Router pages + API routes
│   │   ├── api/                # API routes (server-side)
│   │   │   ├── ai-query/       # Streaming AI chat (Claude Sonnet + history)
│   │   │   ├── chat-history/   # GET/POST/DELETE chat history per ticker
│   │   │   ├── generate-report/# AI-generated company reports (Claude Sonnet)
│   │   │   ├── sector-kpis/    # Sector-specific KPIs per ticker
│   │   │   └── ...
│   │   ├── components/         # Shared UI components
│   │   │   ├── SectorKPIsWidget.tsx  # Sector KPIs on Finanse tab
│   │   │   └── ...
│   │   ├── companies/[ticker]/ # Company detail page (+ "Raport AI" button)
│   │   ├── reports/[ticker]/   # AI-generated PDF reports
│   │   ├── paper-trading/      # Paper trading page
│   │   ├── screener/           # Company screener
│   │   ├── settings/           # App settings (notifications, export, system info)
│   │   ├── watchlists/         # Watchlist management
│   │   ├── alerts/             # Alert history + rules
│   │   └── ...
│   └── lib/                    # Supabase client, storage utils
├── supabase/
│   ├── functions/              # Deno Edge Functions
│   │   ├── _shared/            # Shared modules
│   │   │   ├── email.ts        # Resend email (alerts + morning brief)
│   │   │   └── ...
│   │   ├── fetch-espi/         # Fetch ESPI announcements
│   │   ├── fetch-prices/       # Fetch stock prices
│   │   ├── fetch-dividends/    # Fetch dividend history (EODHD, weekly)
│   │   ├── fetch-macro/        # NBP + Stooq WIBOR + GUS BDL CPI + FRED
│   │   ├── process-raw/        # raw_ingest → company_events (15 event types)
│   │   ├── send-alerts/        # Telegram + email alerts
│   │   ├── populate-calendar/  # Auto-predict earnings dates from ESPI history
│   │   ├── extract-sector-kpis/# Extract sector KPIs via Claude Haiku
│   │   ├── analyze-health/     # Financial health score
│   │   ├── analyze-impact/     # Event impact statistics
│   │   ├── calc-correlations/  # Pearson price correlations
│   │   └── weekly-report/      # Friday weekly AI digest
│   └── migrations/             # SQL migrations (0001–0040)
├── companies.csv               # 200 companies for import
├── scripts/
│   ├── generate-icons.js       # Generate PWA icons (sharp, 8 sizes)
│   └── import-companies.ts     # upsert companies.csv to DB
└── project-docs/               # Architecture, lessons, patterns
```

## Database Schema (key tables)

| Table                    | Purpose                                      | Since  |
|--------------------------|----------------------------------------------|--------|
| companies                | Master list (200 GPW+USA)                    | 0001   |
| company_events           | Events with impact_score, alerted_at         | 0002   |
| price_history            | Daily OHLCV per ticker                       | 0006   |
| company_financials       | Revenue/EBITDA/EPS by period                 | 0010   |
| analyst_forecasts        | Buy/Hold/Sell recommendations                | 0011   |
| company_kpis             | Computed KPIs (health_score, moat, report)   | 0012   |
| raw_ingest               | Raw email/ESPI content for processing        | 0015   |
| watchlists               | Named lists of tickers                       | 0016   |
| calendar_events          | IPOs, ex-dividend dates, earnings dates      | 0020   |
| peer_groups              | Named peer groups for comparison             | 0019   |
| peer_group_members       | Ticker membership per peer group (all 200)   | 0019+0036 |
| company_snapshot         | Pre-computed cache per ticker (30min)        | 0025   |
| macro_indicators         | NBP FX + WIBOR (Stooq) + CPI (GUS BDL) + FRED | 0026 |
| company_sentiment        | Claude Haiku sentiment per ticker            | 0027   |
| alert_rules              | Configurable alert thresholds + cooldown     | 0028   |
| event_impact_analysis    | Per-event-type impact stats                  | 0031   |
| price_correlations       | Pearson r between tickers (90d)              | 0032   |
| paper_portfolios         | Virtual trading portfolios                   | 0034   |
| paper_trades             | BUY/SELL trade records                       | 0034   |
| paper_positions          | Current holdings with avg_cost               | 0034   |
| weekly_reports           | AI-generated weekly market summaries         | 0035   |
| dividends                | Historical dividend payments (EODHD)         | 0037   |
| sector_kpi_definitions   | KPI definitions per sector                   | 0039   |
| sector_kpis              | Extracted sector KPIs per ticker+period      | 0039   |
| chat_history             | AI chat messages per ticker (persistent)     | 0040   |

## Edge Functions & Cron Schedule

| Function            | Schedule           | Purpose                                    |
|---------------------|--------------------|--------------------------------------------|
| fetch-espi          | */15 * * * *       | Scrape ESPI announcements                  |
| fetch-email         | */15 * * * *       | Gmail IMAP → raw_ingest                    |
| fetch-prices        | 0 18 * * 1-5       | Daily price update                         |
| process-raw         | */30 * * * *       | raw_ingest → company_events (15 types)     |
| send-alerts         | */5 * * * *        | Check rules → Telegram + email alerts      |
| compute-snapshot    | */30 * * * *       | Pre-compute company_snapshot               |
| analyze-impact      | 0 */6 * * *        | Aggregate event impact stats               |
| fetch-macro         | 0 */6 * * *        | NBP FX + WIBOR + CPI + FRED               |
| morning-brief       | 0 7 * * 1-5        | Daily Telegram + email morning digest      |
| weekly-report       | 0 16 * * 5         | Friday AI weekly market summary            |
| fetch-dividends     | 0 21 * * 0         | EODHD dividend history (Sunday 21:00)      |
| populate-calendar   | 0 6 * * 1          | Auto-predict earnings dates (Monday 06:00) |
| extract-sector-kpis | 0 9 1 * *          | Sector KPI extraction (1st of month)       |

## Key Architectural Decisions

### ISR + Client Wrapper Pattern
Server components use `export const revalidate = N` for ISR caching. Interactive
features use a thin `"use client"` wrapper that receives server-fetched data as props
and handles dynamic updates via useEffect.

### Snapshot Cache
`company_snapshot` stores a JSONB snapshot (company + price + events) recomputed
every 30 minutes. Company detail pages hit this first, fall back to live queries.

### Alert Rules
`alert_rules` table drives all alerting logic. Supports: threshold comparison,
compound JSONB conditions (AND logic), per-ticker scoping, cooldown_hours.
High-impact alerts (score ≥ 8) also trigger email via Resend.

### Macro Data Sources
- **NBP API** — EUR/PLN, USD/PLN, GBP/PLN, CHF/PLN (always)
- **Stooq CSV** — WIBOR 1M, 3M, 6M (free, no API key)
- **GUS BDL** — PL CPI YoY (free, no API key)
- **FRED** — US macro (Fed Rate, CPI, 10Y Treasury) — requires `FRED_API_KEY`

### 15 ESPI Event Types
process-raw classifies events into 15 granular types:
`earnings_quarterly`, `earnings_annual`, `dividend_announcement`, `dividend_payment`,
`merger_acquisition`, `share_buyback`, `capital_increase`, `management_change`,
`regulatory`, `contract_major`, `contract_other`, `insider_transaction`, `agm`,
`guidance`, `other`

### AI Chat Memory
`chat_history` stores last N messages per ticker. `ai-query` API route loads
last 10 messages as context, inserts user message before call, client saves
assistant response after streaming completes.

### AI Report Generation
`/api/generate-report` uses Claude Sonnet to generate Markdown reports cached
in `company_kpis` table (kpi_type='report', 24h TTL). `/reports/[ticker]` renders
with print CSS for PDF export via browser print.

### Paper Trading
`paper_portfolios` tracks virtual cash. BUY increases quantity and reduces cash
(computes weighted avg_cost). SELL does the reverse. PnL computed on-the-fly
by joining with latest `price_history` price.

### Peer Groups
`peer_groups` + `peer_group_members` cover all 200 companies in 28 groups.
Migration 0036 populated all groups with sector-specific members.

### Sector KPIs
`sector_kpi_definitions` maps KPI codes to human-readable names per sector.
`extract-sector-kpis` EF uses Claude Haiku to extract values from financial data.
`SectorKPIsWidget` renders on the Finanse tab of company detail pages.

## Deployment

```bash
# Deploy EF
supabase functions deploy <function-name> --project-ref pftgmorsthoezhmojjpg

# Push migrations
supabase db push --linked --yes

# Import companies
npx tsx scripts/import-companies.ts

# Generate PWA icons
node scripts/generate-icons.js

# Set secrets
supabase secrets set RESEND_API_KEY=re_xxxx
supabase secrets set ALERT_EMAIL=your@email.com
supabase secrets set EODHD_KEY=your_key
supabase secrets set FRED_API_KEY=your_key

# Fix cron key after migration
# (see lessons-learned.md — Management API pattern)
```
