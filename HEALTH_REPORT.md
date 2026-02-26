# HEALTH REPORT — Giełda Monitor
**Data**: 2026-02-26 | **Commit**: c624e03 | **Tryb**: Tylko diagnoza

---

## OBSZAR 1 — TypeScript / Build

### ✅ Build i TypeScript: CZYSTE
**Plik**: `app/`
**Typ**: INFO
**Opis**: `tsc --noEmit` zwraca 0 błędów. `npm run build` kończy się sukcesem (57 stron, 0 błędów).

---

## OBSZAR 2 — Edge Functions: spójność schematów

### [EDGE] `process-news`: podwójne ładowanie danych
**Plik**: `supabase/functions/process-news/index.ts:342–352`
**Typ**: WARNING
**Opis**: Funkcja wykonuje 2 osobne zapytania do bazy — `ticker_aliases` i `companies` — podczas gdy `allTickers` można wyderywować z aliasMap zamiast osobnego SELECT.
**Przykład**:
```typescript
const { data: aliasRows } = await supabase.from("ticker_aliases").select("ticker, alias").limit(3000);
const { data: companiesData } = await supabase.from("companies").select("ticker"); // ← redundant
const allTickers = [...validTickers]; // ← validTickers z companiesData
```
**Ryzyko**: 2 zapytania per wywołanie zamiast 1; przy trigger mode (co INSERT) generuje dodatkowe obciążenie DB.

---

### [EDGE] `fetch-espi`: kolumna `source_url` zależna od 0050
**Plik**: `supabase/functions/fetch-espi/index.ts:253`
**Typ**: INFO
**Opis**: Upsert do `news_items` używa kolumny `source_url`, która została dodana dopiero w migracji 0050. Jeśli ta migracja nie zostałaby wykonana, INSERT by się wysypał z błędem "column not found".
**Przykład**:
```typescript
source_url: record.url ?? null,  // dodana w 0050_news_enhancements.sql
```
**Ryzyko**: Środowiska bez migracji 0050 (local dev po `db reset`) będą miały błędne insercie z fetch-espi.

---

### [EDGE] Hardcoded anon key w triggerze
**Plik**: `supabase/migrations/0056_fix_news_trigger.sql:29–30`
**Typ**: WARNING
**Opis**: Publiczny anon key jest zakodowany na stałe w funkcji triggerowej. To klucz publiczny (safe), ale rotacja klucza wymagałaby nowej migracji zamiast zmiany env var.
**Przykład**:
```sql
'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```
**Ryzyko**: Przy rotacji anon key trigger przestanie działać aż do wdrożenia nowej migracji.

---

### [EDGE] `fetch-news`: hardcoded URL bota
**Plik**: `supabase/functions/fetch-news/index.ts:19`
**Typ**: INFO
**Opis**: User-Agent zawiera hardcoded URL produkcyjny.
**Przykład**:
```typescript
const BOT_UA = "GieldaMonitor/3.1 (+https://gielda-mpv.vercel.app)";
```
**Ryzyko**: Brak — tylko kosmetyczny.

---

### [EDGE] `aggregate-sentiment`: kolumny `avg_sentiment_30d`, `news_count_30d`, `last_news_at` na `companies`
**Plik**: `supabase/functions/aggregate-sentiment/index.ts`
**Typ**: WARNING
**Opis**: Funkcja aktualizuje `companies.avg_sentiment_30d`, `companies.news_count_30d`. Kolumna `last_news_at` jest aktualizowana przez `process-news`. Żadna z tych kolumn nie pojawia się w bazowej definicji tabeli `companies` z migracji 0002. Muszą istnieć — funkcje działają — ale nie ma ich w jawnej liście pól z migracji.
**Ryzyko**: Jeśli lokalne `db reset` nie doda tych kolumn (brak ich w oddzielnej migracji), lokalne testy będą failować.

---

### [EDGE] Wczesne cron migracje z placeholderem `SERVICE_ROLE_KEY_HERE`
**Plik**: `supabase/migrations/0003_*.sql` – `0006_*.sql`
**Typ**: WARNING
**Opis**: Wczesne migracje tworzą cron joby z literalnym ciągiem `SERVICE_ROLE_KEY_HERE` jako Authorization header. Joby działają na produkcji bo zostały poprawnie skonfigurowane ręcznie lub przez późniejsze re-schedulowanie. Jednak `supabase db reset` + `db push` przywróci złe joby.
**Przykład**:
```sql
'Authorization', 'Bearer SERVICE_ROLE_KEY_HERE'  -- placeholder, nigdy zastąpiony
```
**Ryzyko**: Nowy developer uruchamiający `db reset` dostanie niedziałające cron joby dla fetch-prices, send-alerts, compute-snapshot, fetch-macro.

---

## OBSZAR 3 — Database triggers i cron

### ✅ Trigger `news_items_process_trigger`: NAPRAWIONY (0056)
**Plik**: `supabase/migrations/0056_fix_news_trigger.sql`
**Typ**: INFO
**Opis**: Trzy błędy z 0053 naprawione: vault.secrets (→ hardcode), RETURN NEW (→ RETURN NULL), extensions.http_post (→ net.http_post). EXCEPTION handler chroni INSERT. Zweryfikowane działaniem.

---

### [CRON] Potencjalne nakładanie wywołań: trigger + cron co 2 min
**Plik**: Migracje 0052 + 0056
**Typ**: WARNING
**Opis**: Po każdym batch INSERT z `fetch-news` trigger wywołuje `process-news` (limit=10), A cron co 2 minuty wywołuje `process-news` (limit=100). Oba wywołania działają równolegle jeśli INSERT trafi blisko granicy minuty. Oba biorą artykuły z tej samej kolejki `ai_processed=false`.
**Ryzyko**: Race condition — oba mogą pobrać te same 10 artykułów przed oznaczeniem ich jako przetworzonych, co spowoduje podwójne wywołanie OpenAI dla tych artykułów. W praktyce szansa jest niska (okno <200ms), ale możliwa.

---

### [CRON] `process-news` co 2 min + czas wykonania 7–95 sekund
**Plik**: Migracja 0052, ingestion_log
**Typ**: WARNING
**Opis**: Ingestion log pokazuje czasy wykonania: 7s (10 items), 21s (23 items), 94s (100 items). Przy batch=100 każde wywołanie może trwać ~94s, co przy cronie co 2 minuty (120s) daje bardzo małe okno. Jeśli batch się opóźni, kolejne wywołanie zaczyna przed zakończeniem poprzedniego.
**Ryzyko**: Dwa równoległe uruchomienia process-news z batch=100 to 200 równoległych zapytań do OpenAI — przekroczy limit 500 RPM.

---

### [CRON] Duplikat schedulingu: `send-alerts-5min` vs `send-news-alerts-3m`
**Plik**: Migracje 0038 + 0052
**Typ**: INFO
**Opis**: Są DWA różne cron joby: `send-alerts-5min` (wywołuje `send-alerts` — alerty cenowe/zdrowotne) i `send-news-alerts-3m` (wywołuje `send-news-alerts` — alerty newsowe). Są to RÓŻNE edge functions z różnym przeznaczeniem. Nie ma konfliktu, ale można je pomylić.
**Ryzyko**: Brak — to celowe rozdzielenie.

---

## OBSZAR 4 — API Routes (Next.js)

### [API] Non-null assertions `!` na env vars — potencjalny crash
**Plik**: `app/app/api/news/route.ts:20–21`, `news/stats/route.ts:17–18`, `news/sentiment/route.ts:15–16`, `status/route.ts:11–12`
**Typ**: BUG
**Opis**: Cztery route'y używają `process.env.X!` (non-null assertion) zamiast `?? ""` lub early-return. Jeśli zmienna nie jest ustawiona, Next.js rzuca wyjątek na poziomie modułu (nie w handler).
**Przykład**:
```typescript
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,        // ← crash jeśli brak
  process.env.SUPABASE_SERVICE_ROLE_KEY!,        // ← crash jeśli brak
);
```
**Ryzyko**: W środowisku CI/CD bez `.env.local` wszystkie 4 route'y crashują z nieczytelnym błędem przy starcie.

---

### [API] Fire-and-forget bez logowania błędów
**Plik**: `app/app/api/ai-query/route.ts:146`, `correlations/route.ts:37–45`, `gen-summary/route.ts:53–60`
**Typ**: BUG
**Opis**: Trzy miejsca wykonują async operacje z `.then(() => {})` lub `.catch(() => {})` bez żadnego logowania błędów.
**Przykład**:
```typescript
// ai-query/route.ts:146
db.from("chat_history").insert({ ticker, role: "user", content: question }).then(() => {});
// ↑ błąd jest cicho połknięty — wiadomość może nie zostać zapisana
```
**Ryzyko**: Historia czatu może mieć luki bez żadnej widocznej informacji o błędzie.

---

### [API] `company/[ticker]/route.ts`: spread bez walidacji struktury
**Plik**: `app/app/api/company/[ticker]/route.ts:45`
**Typ**: BUG
**Opis**: `snapRow.snapshot` jest spreadowane do odpowiedzi bez sprawdzenia, że to obiekt (może być `null` lub skalarem z bazy).
**Przykład**:
```typescript
const snap = snapRow?.snapshot;
return NextResponse.json({ ticker, ...snap }); // ← crash jeśli snap to null/string
```
**Ryzyko**: Błąd runtime jeśli company_snapshot zawiera niepoprawne dane.

---

### [API] 13 route'ów bez `export const revalidate`
**Plik**: `api/consensus`, `api/company-sentiment`, `api/peers`, `api/ownership`, `api/calendar`, `api/search`, `api/analyze`, `api/company-kpis`, `api/company/[ticker]`, `api/macro-interpretation`, `api/screener`, `api/whatif`, `api/correlations`
**Typ**: WARNING
**Opis**: Route'y bez `revalidate` są domyślnie dynamiczne (każde żądanie = nowe zapytanie do DB). Dane finansowe mogą być cachowane 5–30 min bez utraty świeżości.
**Ryzyko**: Wyższe obciążenie bazy przy ruchliwych stronach; brak IS (Incremental Static Regeneration).

---

### [API] `parseInt` bez sprawdzenia `isNaN`
**Plik**: `app/app/api/calendar/route.ts:7`, `price-history/route.ts:23–25`
**Typ**: WARNING
**Opis**: `parseInt` może zwrócić `NaN`, który propaguje przez `Math.min`/`Math.max` jako `NaN`.
**Przykład**:
```typescript
const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "50");
// parseInt("abc") === NaN → limit=NaN → .limit(NaN) w Supabase
```
**Ryzyko**: Zapytanie do Supabase z `limit(NaN)` zwróci nieprzewidywalny wynik.

---

### [API] `screener/route.ts`: brak try-catch przy `req.json()`
**Plik**: `app/app/api/screener/route.ts:70`
**Typ**: WARNING
**Opis**: `req.json()` rzuca SyntaxError dla niepoprawnego JSON bez ochrony.
**Przykład**:
```typescript
const body = await req.json() as ScreenerRequest; // ← brak try/catch
```
**Ryzyko**: Niepoprawne żądanie od klienta powoduje 500 zamiast 400.

---

### [API] `as unknown as X` — obejście systemu typów
**Plik**: `app/app/api/news/sentiment/route.ts:47`, `status/route.ts:50–58`, `watchlists/smart/route.ts:68,83,113`
**Typ**: WARNING
**Opis**: Agresywne casty `as unknown as SomeType` ukrywają potencjalne rozbieżności między typem TS a rzeczywistą strukturą z bazy.
**Ryzyko**: Runtime crash jeśli schema DB się zmieni, a typy TS nie zostaną zaktualizowane.

---

## OBSZAR 5 — Frontend komponenty

### ✅ Komponenty: GENERALNIE CZYSTE
Build i TSC przechodzą czysto. Większość problemów z poprzednich sesji (key_facts crash, brakujące key props, obiekty jako JSX children) jest naprawiona.

---

### [FRONTEND] `SectorKPIsWidget`: typ inferowany jako `unknown`
**Plik**: `app/app/components/SectorKPIsWidget.tsx:62`
**Typ**: WARNING
**Opis**: `.then((d: SectorKPI[]) => ...)` z runtime `Array.isArray(d)` sugeruje, że API może zwrócić nie-tablicę w edge casach (np. błąd Supabase zwraca obiekt `{code, message}`).
**Przykład**:
```typescript
.then((d: SectorKPI[]) => { setKpis(Array.isArray(d) ? d : []); })
```
**Ryzyko**: Niskie — defensywna walidacja chroni przed crashem, ale brak informacji o błędzie dla użytkownika.

---

### [FRONTEND] `TickerTape`: brak typowania odpowiedzi
**Plik**: `app/app/components/TickerTape.tsx:19,26`
**Typ**: INFO
**Opis**: `fetch().then((d) => ...)` bez typowania `d` — TypeScript inferencja to `any`.
**Ryzyko**: Brak zabezpieczenia na poziomie typów; runtime sprawdzenie `Array.isArray(d)` ratuje sytuację.

---

### [FRONTEND] `companies/[ticker]/page.tsx`: mieszanie server/client
**Plik**: `app/app/companies/[ticker]/page.tsx:1`
**Typ**: INFO
**Opis**: Strona jest server component (brak `"use client"`), importuje client components (`CompanyTabs`, `TrackVisit`, `FavoriteButton`). To poprawny wzorzec Next.js 14 — server component może renderować client components. Jednak `TrackVisit` i `FavoriteButton` używają `localStorage` co wymaga `"use client"` (co mają).
**Ryzyko**: Brak — wzorzec jest poprawny, ale może być mylący przy review.

---

## OBSZAR 6 — Konfiguracja i sekrety

### ✅ `config.toml`: brak schedulów (poprawnie)
**Typ**: INFO
**Opis**: `config.toml` nie zawiera żadnych `[functions.X] schedule =` — to prawidłowe, bo wszystkie cron joby są zarządzane przez migracje pg_cron. Wcześniej (problem z 0053) `schedule` w config.toml nie było obsługiwane przez CLI dla remote deploy.

---

### [CONFIG] `.env.local`: wszystkie wymagane zmienne obecne
**Plik**: `app/.env.local`
**Typ**: INFO
**Opis**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` są zdefiniowane. Edge Functions mają osobne env vars w Supabase Dashboard (nie w `.env.local`).

---

### [CONFIG] Brak `OPENAI_API_KEY` w `.env.local`
**Plik**: `app/.env.local`
**Typ**: WARNING
**Opis**: `OPENAI_API_KEY` jest wymagany przez `process-news` (Edge Function), ale nie ma go w `.env.local`. Jest ustawiony w Supabase Dashboard (Secrets). API route `api/analyze` może korzystać z innej zmiennej.
**Ryzyko**: Lokalny development process-news bez env var w Dashboard → `OPENAI_API_KEY not set` error.

---

## OBSZAR 7 — Duplikaty i dead code

### ✅ `bankier/espi.xml`: poprawnie obsługiwany
**Plik**: `supabase/functions/fetch-news/index.ts:66–67`
**Typ**: INFO
**Opis**: Komentarz w kodzie jawnie wyklucza `bankier/espi.xml` z `fetch-news` z wyjaśnieniem, że `fetch-espi` jest właścicielem tego źródła. Brak duplikatu.

---

### [DUPLIKAT] Seed script re-generuje aliasy już istniejące w bazie
**Plik**: `scripts/seed-ticker-aliases.ts`
**Typ**: INFO
**Opis**: Skrypt jest idempotentny (`on_conflict=alias` + `ignore-duplicates`), ale generuje 1215 wierszy i próbuje wstawić je wszystkie przy każdym uruchomieniu. Bazy danych ignorują duplikaty, ale operacja jest zbędna.
**Ryzyko**: Brak funkcjonalny — tylko dodatkowe obciążenie przy re-seeda.

---

### [DUPLIKAT] Logika `SOURCE_COLORS` zduplikowana w 3 komponentach
**Plik**: `app/app/components/NewsWidget.tsx:35–51`, `CompanyTimeline.tsx:32–48`, `news/page.tsx`
**Typ**: WARNING
**Opis**: Mapa kolorów źródeł (`pap: "bg-blue-900..."` itd.) jest kopiowana w trzech plikach. Zmiana koloru dla nowego źródła wymaga edycji 3 miejsc.
**Ryzyko**: Rozsynchronizowanie kolorów — nowe źródła wstawione do jednego komponentu mogą nie pojawić się w innych.

---

### [DEAD CODE] `news_items.relevance_score` nigdzie nieużywane
**Plik**: `supabase/migrations/0050_news_enhancements.sql`
**Typ**: INFO
**Opis**: Kolumna `relevance_score NUMERIC(3,2) DEFAULT 1.0` jest dodana do `news_items` w migracji 0050, ale żadna edge function ani API route nie zapisuje ani nie odczytuje tej kolumny.
**Ryzyko**: Brak — dead column zajmuje miejsce.

---

### [DEAD CODE] `ticker_aliases.language` zawsze `'pl'`
**Plik**: `scripts/seed-ticker-aliases.ts`, `supabase/migrations/0054_clean_ticker_aliases.sql`
**Typ**: INFO
**Opis**: Pole `language` w `ticker_aliases` zawsze przyjmuje wartość `'pl'`. Żadna funkcja nie filtruje po `language`. Kolumna istnieje ale nie jest używana.
**Ryzyko**: Brak.

---

### [DEAD CODE] Legacy tabele `news`, `news_audit`, `tickers`
**Plik**: `supabase/migrations/0024_*.sql`
**Typ**: INFO
**Opis**: Migracja 0024 dodaje RLS dla tabel `news`, `news_audit`, `tickers` — są to wcześniejsze struktury sprzed `news_items`. `news_items` jest obecnym rozwiązaniem. Stare tabele mogą wciąż istnieć w bazie.
**Ryzyko**: Brak funkcjonalny, ale zajmują miejsce i mogą mylić nowych developerów.

---

## PODSUMOWANIE

### CRASH (🔴): 0 problemów
Brak krytycznych błędów powodujących crash aplikacji lub utratę danych.

---

### BUG (🟡): 3 problemy — niepoprawne działanie

| # | Problem | Plik |
|---|---------|------|
| 1 | Non-null assertions `!` na env vars w 4 API routes | `api/news/route.ts`, `news/stats`, `news/sentiment`, `status` |
| 2 | Fire-and-forget bez logowania błędów (chat history, correlations trigger, gen-summary) | `api/ai-query/route.ts:146`, `correlations/route.ts:37`, `gen-summary/route.ts:53` |
| 3 | `company/[ticker]/route.ts`: spread snapRow.snapshot bez null-check | `api/company/[ticker]/route.ts:45` |

---

### WARNING (🟠): 10 problemów — potencjalne problemy

| # | Problem | Plik |
|---|---------|------|
| 1 | Hardcoded anon key w triggerze (rotacja klucza = nowa migracja) | `0056_fix_news_trigger.sql:29` |
| 2 | Race condition: trigger + cron co 2 min mogą pobrać te same artykuły | `0052 + 0056` |
| 3 | process-news co 2 min; jeśli run trwa >2 min, dwa równoległe = >500 RPM w OpenAI | `0052_news_cron_faster.sql` |
| 4 | Wczesne migracje z `SERVICE_ROLE_KEY_HERE` (stare cron joby złamane po `db reset`) | `0003–0006_*.sql` |
| 5 | `companies.avg_sentiment_30d`, `last_news_at`, `news_count_30d` — kolumny niezdefiniowane jawnie w migracji | `supabase/migrations/` |
| 6 | 13 API routes bez `export const revalidate` | `api/consensus`, `api/peers`, itp. |
| 7 | `parseInt` bez `isNaN` check w 2 routes | `api/calendar/route.ts:7`, `api/price-history/route.ts:23` |
| 8 | `req.json()` bez try-catch w screener | `api/screener/route.ts:70` |
| 9 | `as unknown as X` w 3 API routes ukrywa type mismatches | `api/news/sentiment`, `status`, `watchlists/smart` |
| 10 | `SOURCE_COLORS` zduplikowane w 3 komponentach | `NewsWidget`, `CompanyTimeline`, `news/page.tsx` |

---

### INFO (🔵): 8 obserwacji — do rozważenia

| # | Obserwacja | Plik |
|---|-----------|------|
| 1 | process-news: 2 osobne DB queries zamiast 1 (aliases + companies) | `process-news/index.ts:342–352` |
| 2 | fetch-espi: `source_url` zależy od migracji 0050 (lokalne `db reset` może failować) | `fetch-espi/index.ts:253` |
| 3 | Hardcoded BOT_UA z prod URL w fetch-news | `fetch-news/index.ts:19` |
| 4 | `SectorKPIsWidget`: defensywny `Array.isArray` bez widocznej informacji o błędzie | `SectorKPIsWidget.tsx:62` |
| 5 | `TickerTape`: brak typowania fetch response (implicit `any`) | `TickerTape.tsx:19` |
| 6 | `news_items.relevance_score` nigdzie nieużywane | `0050_news_enhancements.sql` |
| 7 | Legacy tabele `news`, `news_audit`, `tickers` mogą wciąż istnieć | `0024_*.sql` |
| 8 | seed-ticker-aliases: idempotentny ale próbuje insertować 1215 wierszy za każdym razem | `scripts/seed-ticker-aliases.ts` |

---

*Wygenerowano: 2026-02-26 | Commit: c624e03 | Tryb: DIAGNOZA ONLY — brak zmian w kodzie*
