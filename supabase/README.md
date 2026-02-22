# Supabase — MVP Ingest Runbook

## Architektura MVP

```
pg_cron (co 15 min)
  └── net.http_post(fetch-espi URL)
        └── Edge Function: fetch-espi
              └── INSERT INTO raw_ingest
                    └── (future) processor → company_events
                          └── Next.js frontend (RLS anon read)
```

`/api/news` (Next.js) = **manual/external gateway** — wyłączony w MVP (`ENABLE_PUBLIC_INGEST=false`).

---

## Wymagania

- Supabase CLI: `brew install supabase/tap/supabase`
- Projekt Supabase: znaj swój `<project-ref>` (z URL: `https://supabase.com/dashboard/project/<ref>`)
- Zmienne środowiskowe: patrz `.env.example` w root repo

---

## Krok 1 — Migracja DB

Otwórz **Supabase Dashboard → SQL Editor → New query**, wklej zawartość:

```
supabase/migrations/0001_init.sql
```

Następnie uruchom i sprawdź:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('raw_ingest', 'company_events', 'news', 'tickers', 'news_audit');
```

Oczekiwany output: 5 wierszy (lub mniej jeśli część tabel już istnieje).

**Dodatkowe migracje (uruchom jeśli nie wykonano wcześniej):**

```sql
-- Etap 5: audit trail
CREATE TABLE IF NOT EXISTS news_audit (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action      text        NOT NULL,
  news_id     uuid        REFERENCES news(id) ON DELETE SET NULL,
  request_id  text        NOT NULL,
  ip          text        NOT NULL DEFAULT '',
  user_agent  text,
  ticker      text,
  status_code integer     NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS news_audit_ticker_idx     ON news_audit (ticker);
CREATE INDEX IF NOT EXISTS news_audit_created_at_idx ON news_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS news_audit_request_id_idx ON news_audit (request_id);

-- Etap 6: soft delete
ALTER TABLE news ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS news_not_deleted_idx
  ON news (created_at DESC) WHERE deleted_at IS NULL;
```

---

## Krok 2 — Deploy Edge Function

```bash
# Zaloguj się do Supabase CLI
supabase login

# Link projektu (raz)
supabase link --project-ref <project-ref>

# Deploy funkcji
supabase functions deploy fetch-espi --project-ref <project-ref>
```

### Zmienne środowiskowe funkcji

W Dashboard → Edge Functions → fetch-espi → Secrets **lub** przez CLI:

```bash
supabase secrets set CRON_SECRET=<losowy-sekret-min-32-znaki> --project-ref <project-ref>
```

`SUPABASE_URL` i `SUPABASE_SERVICE_ROLE_KEY` są automatycznie dostępne wewnątrz funkcji.

### Weryfikacja ręczna

```bash
supabase functions invoke fetch-espi \
  --project-ref <project-ref> \
  --headers '{"Authorization":"Bearer <CRON_SECRET>"}'
```

Oczekiwany output:
```json
{"ok":true,"inserted":2,"source":"espi","ts":"2026-..."}
```

Sprawdź w DB:
```sql
SELECT id, source, fetched_at FROM raw_ingest ORDER BY fetched_at DESC LIMIT 5;
```

---

## Krok 3 — Cron Job (pg_cron)

Otwórz **Supabase Dashboard → SQL Editor** i uruchom:

```sql
-- Włącz pg_cron (raz, jeśli nie ma)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Włącz pg_net (raz, jeśli nie ma)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Utwórz cron job: co 15 minut wywołuje fetch-espi
SELECT cron.schedule(
  'fetch-espi-every-15min',                          -- nazwa (unikalna)
  '*/15 * * * *',                                    -- co 15 min
  $$
  SELECT net.http_post(
    url     := 'https://<project-ref>.supabase.co/functions/v1/fetch-espi',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <CRON_SECRET>'
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

Zastąp `<project-ref>` i `<CRON_SECRET>` właściwymi wartościami.

### Weryfikacja crona

```sql
-- Lista zaplanowanych jobów
SELECT jobid, jobname, schedule, active FROM cron.job;

-- Logi wykonań (ostatnie 10)
SELECT jobid, status, return_message, start_time
FROM cron.job_run_details
ORDER BY start_time DESC
LIMIT 10;
```

### Zatrzymanie / usunięcie crona

```sql
-- Dezaktywuj (nie usuwa)
UPDATE cron.job SET active = false WHERE jobname = 'fetch-espi-every-15min';

-- Usuń całkowicie
SELECT cron.unschedule('fetch-espi-every-15min');
```

---

## Krok 4 — Weryfikacja end-to-end

Po pierwszym wykonaniu crona (lub ręcznym invoke):

```sql
-- raw_ingest ma nowe rekordy?
SELECT source, payload->>'ticker' AS ticker, fetched_at
FROM raw_ingest
ORDER BY fetched_at DESC
LIMIT 10;

-- audit trail działa?
SELECT action, ticker, status_code, created_at
FROM news_audit
ORDER BY created_at DESC
LIMIT 10;
```

---

## Logi Edge Functions

Dashboard → Edge Functions → fetch-espi → Logs

Lub przez CLI:
```bash
supabase functions logs fetch-espi --project-ref <project-ref>
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
