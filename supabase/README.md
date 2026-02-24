# Supabase — MVP Ingest Runbook

## Architektura MVP

```
pg_cron (co 15 min)
  ├── net.http_post(fetch-espi URL)   → INSERT INTO raw_ingest (source='espi')
  └── net.http_post(fetch-email URL)  → INSERT INTO raw_ingest (source='email')
                                            └── (future) processor → company_events
                                                  └── Next.js frontend (RLS anon read)
```

`/api/news` (Next.js) = **manual/external gateway** — wyłączony w MVP (`ENABLE_PUBLIC_INGEST=false`).

---

## Wymagania

- Supabase CLI: `brew install supabase/tap/supabase`
- Projekt ref: `pftgmorsthoezhmojjpg`
- Logowanie: `supabase login` (raz)
- Link: `supabase link --project-ref pftgmorsthoezhmojjpg` (raz)

---

## Deploy workflow (3 komendy)

### 1. Ustaw sekrety (raz)

```bash
# Gmail IMAP — fetch-email
supabase secrets set \
  GMAIL_EMAIL=gielda.monitor.inbox@gmail.com \
  GMAIL_APP_PASSWORD=<app-password-z-SECRETS.txt> \
  --project-ref pftgmorsthoezhmojjpg
```

`SUPABASE_URL` i `SUPABASE_SERVICE_ROLE_KEY` są wstrzykiwane przez Supabase automatycznie.

### 2. Deploy Edge Functions

```bash
supabase functions deploy fetch-espi  --project-ref pftgmorsthoezhmojjpg
supabase functions deploy fetch-email --project-ref pftgmorsthoezhmojjpg
```

### 3. Migracja z cron jobem

```bash
# Podstaw service_role key → wykonaj migration SQL
export SERVICE_ROLE_KEY="eyJ..."   # Settings → API → service_role key

sed "s/SERVICE_ROLE_KEY_HERE/$SERVICE_ROLE_KEY/" \
    supabase/migrations/0003_email_automation.sql \
  | supabase db execute --project-ref pftgmorsthoezhmojjpg
```

> Plik `0003_email_automation.sql` jest commitowany z placeholderem `SERVICE_ROLE_KEY_HERE`.
> `sed` podstawia prawdziwy klucz lokalnie — **klucz nie trafia do git**.

---

## Migracje DB

| Plik | Zawartość | Status |
|---|---|---|
| `0001_init.sql` | raw_ingest, company_events, news, tickers, news_audit, soft-delete | ✅ wykonano |
| `0003_email_automation.sql` | pg_cron job dla fetch-email | deploy → krok 3 powyżej |

Jeśli `0001_init.sql` nie był jeszcze wykonany, wklej go ręcznie w **Dashboard → SQL Editor → New query**.

---

## Weryfikacja po deploy

```bash
# Test fetch-espi (stub)
supabase functions invoke fetch-espi \
  --project-ref pftgmorsthoezhmojjpg
# → {"ok":true,"inserted":2,"source":"espi","ts":"2026-..."}

# Test fetch-email
supabase functions invoke fetch-email \
  --project-ref pftgmorsthoezhmojjpg
# → {"ok":true,"inserted":<n>,"source":"email","ts":"2026-..."}
# (inserted:0 gdy brak nowych maili — to OK)
```

Sprawdź rekordy w DB:

```sql
SELECT source, payload->>'ticker' AS ticker, fetched_at
FROM raw_ingest
ORDER BY fetched_at DESC
LIMIT 10;
```

Sprawdź cron job:

```sql
SELECT jobid, jobname, schedule, active FROM cron.job;

-- Logi wykonań (ostatnie 10)
SELECT jobid, status, return_message, start_time
FROM cron.job_run_details
ORDER BY start_time DESC
LIMIT 10;
```

---

## Logi Edge Functions

```bash
supabase functions logs fetch-email --project-ref pftgmorsthoezhmojjpg
supabase functions logs fetch-espi  --project-ref pftgmorsthoezhmojjpg
```

---

## Zatrzymanie / usunięcie cron jobów

```sql
-- Dezaktywuj (nie usuwa)
UPDATE cron.job SET active = false WHERE jobname IN ('fetch-espi-every-15min', 'fetch-email-every-15min');

-- Usuń całkowicie
SELECT cron.unschedule('fetch-espi-every-15min');
SELECT cron.unschedule('fetch-email-every-15min');
```

---

## Roadmap (po MVP)

| Faza | Zadanie |
|---|---|
| Month 2 | Zastąp STUB_RECORDS prawdziwym fetchem z espi.gov.pl |
| Month 2 | Dodaj processor: `raw_ingest` → `company_events` |
| Month 2 | Włącz `ENABLE_PUBLIC_INGEST=true` dla testów IFTTT/Pipedream |
| Month 3 | LLM enrichment: `impact_score`, `category` w `company_events` |
| Month 3 | Alert engine: `company_events` → powiadomienia |
