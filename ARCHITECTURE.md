# Gielda-MPV — Architecture

## Diagram (MVP)

```
┌─────────────────────────────────────────────────────────┐
│                     SUPABASE                            │
│                                                         │
│  pg_cron ──(co 15 min)──► Edge Function: fetch-espi    │
│                                │                        │
│                                ▼                        │
│                         raw_ingest (staging)            │
│                                │                        │
│                         (future processor)              │
│                                │                        │
│                                ▼                        │
│                         company_events                  │
│                         news (manual)                   │
│                         news_audit                      │
│                         tickers                         │
└────────────────────────┬────────────────────────────────┘
                         │ RLS (anon read)
                         ▼
              ┌──────────────────────┐
              │    Next.js (Vercel)  │
              │                     │
              │  GET /api/news       │  ◄── public read
              │  GET /api/health     │  ◄── monitoring
              │  GET /api/metrics    │  ◄── operator only
              │  POST /api/news      │  ◄── manual (ENABLE_PUBLIC_INGEST=true)
              │  DELETE /api/news    │  ◄── manual
              └──────────────────────┘
                         │
                         ▼
                    Browser / App
```

## Komponenty

### Supabase (backend)

| Komponent | Rola |
|---|---|
| `pg_cron` | Scheduler — uruchamia Edge Functions co N minut |
| `fetch-espi` (Edge Function) | Pobiera dane ESPI; zapisuje do `raw_ingest` |
| `raw_ingest` | Staging table — surowe JSONy przed parsowaniem |
| `company_events` | Przetworzone zdarzenia korporacyjne (MVP: jeszcze puste) |
| `news` | Manualne newsy (przez `/api/news` lub UI) |
| `tickers` | Referencja dopuszczalnych tickerów |
| `news_audit` | Audit trail dla operacji POST/DELETE |
| RLS | Row Level Security: anon = read-only, service_role = zapis |

### Next.js / Vercel (frontend + manual gateway)

| Endpoint | Dostęp | Opis |
|---|---|---|
| `GET /api/news` | publiczny | Pobieranie newsów (cursor pagination) |
| `POST /api/news` | `x-api-key` + `ENABLE_PUBLIC_INGEST=true` | Manual ingest (Month 2+) |
| `DELETE /api/news?id=` | `x-api-key` | Soft delete |
| `GET /api/health` | publiczny | Status DB + env |
| `GET /api/metrics` | `x-api-key` | In-memory counters |

## Zasady bezpieczeństwa

- **Secrets, nie IP** — autoryzacja przez klucze API, nie adresy IP (serverless = dynamiczne IP)
- **Service Role Key** — nigdy nie eksponowany do przeglądarki; tylko serwer/Edge Functions
- **Anon Key** — tylko do odczytu publicznego (RLS)
- **ENABLE_PUBLIC_INGEST** — feature flag chroniący `/api/news POST` w MVP
- **INGEST_API_KEY** — klucz do manualnego ingestu (rotuj co kwartał)

## Środowiska

| Env | Jak uruchomić |
|---|---|
| **Local** | `cd app && npm run dev` — czyta `.env.local` |
| **Preview** | Vercel Preview Deployment — zmienne z Vercel Dashboard |
| **Production** | Vercel Production — zmienne z Vercel Dashboard |

## Roadmap techniczny

```
MVP (teraz)
  ├── /api/news (manual gateway, wyłączony)
  ├── Supabase Cron → fetch-espi stub → raw_ingest
  └── Frontend czyta news z Supabase przez anon key

Month 2
  ├── fetch-espi: prawdziwy fetch espi.gov.pl
  ├── Processor: raw_ingest → company_events
  ├── ENABLE_PUBLIC_INGEST=true (IFTTT/Pipedream)
  └── Alerty email/SMS

Month 3
  ├── LLM enrichment (impact_score, category)
  ├── Redis rate limiting (zamiast in-memory)
  └── Dashboard metryk (Grafana / własny)
```
