# Giełda Monitor — Architecture

## Overview

Polish stock market monitoring app. Next.js 14 (App Router) frontend + Supabase
(Postgres + Edge Functions + pg_cron) backend.

## Stack

| Layer           | Technology                              |
|-----------------|-----------------------------------------|
| Frontend        | Next.js 14, App Router, Tailwind CSS    |
| Database        | Supabase Postgres (RLS enabled)         |
| Edge Functions  | Deno (Supabase EF), deployed via CLI    |
| Scheduler       | pg_cron + net.http_post to EFs          |
| AI              | Anthropic Claude (Haiku/Sonnet via API) |
| Alerts          | Telegram Bot API                        |
| Deployment      | Vercel (Next.js) + Supabase cloud       |

## Directory Structure

```
/
├── app/                        # Next.js application
│   ├── app/                    # App Router pages + API routes
│   │   ├── api/                # API routes (server-side)
│   │   ├── components/         # Shared UI components
│   │   ├── companies/[ticker]/ # Company detail page
│   │   ├── paper-trading/      # Paper trading page
│   │   ├── screener/           # Company screener
│   │   ├── watchlists/         # Watchlist management
│   │   ├── alerts/             # Alert history + rules
│   │   └── ...
│   └── lib/                    # Supabase client, storage utils
├── supabase/
│   ├── functions/              # Deno Edge Functions
│   │   ├── _shared/            # Shared modules (supabase-client, anthropic, telegram, etc.)
│   │   ├── fetch-espi/         # Fetch ESPI announcements
│   │   ├── fetch-prices/       # Fetch stock prices
│   │   ├── process-raw/        # Process raw_ingest → company_events
│   │   ├── send-alerts/        # Send Telegram alerts
│   │   ├── analyze-health/     # Financial health score
│   │   ├── analyze-impact/     # Event impact statistics
│   │   ├── calc-correlations/  # Pearson price correlations
│   │   ├── weekly-report/      # Friday weekly AI digest
│   │   └── ...
│   └── migrations/             # SQL migrations (0001–0035+)
├── companies.csv               # 200 companies for import
├── scripts/
│   └── import-companies.ts     # upsert companies.csv to DB
└── project-docs/               # Architecture, lessons, patterns
```

## Database Schema (key tables)

| Table                   | Purpose                                    | Since  |
|-------------------------|--------------------------------------------|--------|
| companies               | Master list (200 GPW+USA)                  | 0001   |
| company_events          | Events with impact_score, alerted_at       | 0002   |
| price_history           | Daily OHLCV per ticker                     | 0006   |
| company_financials      | Revenue/EBITDA/EPS by period               | 0010   |
| analyst_forecasts       | Buy/Hold/Sell recommendations              | 0011   |
| company_kpis            | Computed KPIs (health_score, moat, etc.)   | 0012   |
| raw_ingest              | Raw email/ESPI content for processing      | 0015   |
| watchlists              | Named lists of tickers                     | 0016   |
| calendar_events         | IPOs, ex-dividend dates, earnings dates    | 0020   |
| company_snapshot        | Pre-computed cache per ticker (30min)      | 0025   |
| macro_indicators        | NBP exchange rates, macroeconomic data     | 0026   |
| company_sentiment       | Claude Haiku sentiment per ticker          | 0027   |
| alert_rules             | Configurable alert thresholds + cooldown   | 0028   |
| event_impact_analysis   | Per-event-type impact stats                | 0031   |
| price_correlations      | Pearson r between tickers (90d)            | 0032   |
| paper_portfolios        | Virtual trading portfolios                 | 0034   |
| paper_trades            | BUY/SELL trade records                     | 0034   |
| paper_positions         | Current holdings with avg_cost             | 0034   |
| weekly_reports          | AI-generated weekly market summaries       | 0035   |

## Edge Functions & Cron Schedule

| Function           | Schedule           | Purpose                            |
|--------------------|--------------------|-------------------------------------|
| fetch-espi         | */15 * * * *       | Scrape ESPI announcements           |
| fetch-email        | */15 * * * *       | Gmail IMAP → raw_ingest             |
| fetch-prices       | 0 18 * * 1-5       | Daily price update                  |
| process-raw        | */30 * * * *       | raw_ingest → company_events (AI)    |
| send-alerts        | */5 * * * *        | Check rules → Telegram alerts       |
| compute-snapshot   | */30 * * * *       | Pre-compute company_snapshot        |
| analyze-impact     | 0 */6 * * *        | Aggregate event impact stats        |
| fetch-macro        | 0 */6 * * *        | NBP exchange rates                  |
| morning-brief      | 0 7 * * *          | Daily Telegram morning digest       |
| weekly-report      | 0 16 * * 5         | Friday AI weekly market summary     |

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

### Paper Trading
`paper_portfolios` tracks virtual cash. BUY increases quantity and reduces cash
(computes weighted avg_cost). SELL does the reverse. PnL computed on-the-fly
by joining with latest `price_history` price.

### Correlation Finder
On-demand: first request triggers async EF calc, returns empty. Subsequent
requests use cached `price_correlations` (TTL: 1 hour). Pearson r on 90-day
log-returns of daily closes.

## Deployment

```bash
# Deploy EF
supabase functions deploy <function-name> --project-ref pftgmorsthoezhmojjpg

# Push migrations
supabase db push --linked --yes

# Import companies
npx tsx scripts/import-companies.ts

# Fix cron key after migration
# (see lessons-learned.md — Management API pattern)
```
