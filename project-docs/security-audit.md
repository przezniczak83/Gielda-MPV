# Security Audit — 2026-02-25

## Summary
**Tabele z RLS: 26/26** (po hardening 0024)
**Tabele bez RLS przed audytem: 3** (news, news_audit, tickers — legacy, pre-migration)
**Naprawione w 0024_rls_hardening.sql: 3**

---

## Metodologia

Sprawdzono każdą tabelę w schemacie `public` przez:
1. Przegląd migracji 0001–0024 pod kątem `ENABLE ROW LEVEL SECURITY`
2. Test HTTP anon access (`GET /rest/v1/{table}?limit=1` z anon key)
3. Weryfikacja istniejących policies w migracjach

---

## Tabele — status RLS

### Tabele z RLS (zdefiniowane w migracjach 0001–0021)

| Tabela | Migracja | Anon access | Service role |
|---|---|---|---|
| `raw_ingest` | 0001 | ❌ brak (staging) | ✅ bypass |
| `company_events` | 0001 | ✅ SELECT | ✅ bypass |
| `companies` | 0002 | ✅ SELECT | ✅ bypass |
| `price_history` | 0006 | ✅ SELECT | ✅ bypass |
| `company_financials` | 0008 | ✅ SELECT | ✅ bypass |
| `early_recommendations` | 0011 | ✅ SELECT | ✅ bypass |
| `insider_transactions` | 0012 | ✅ SELECT | ✅ bypass |
| `company_kpis` | 0014 | ✅ SELECT | ✅ bypass |
| `watchlists` | 0015 | ✅ SELECT | ✅ bypass |
| `watchlist_items` | 0015 | ✅ SELECT | ✅ bypass |
| `analyst_forecasts` | 0016 | ✅ SELECT | ✅ bypass |
| `dm_reports` | 0016 | ✅ SELECT | ✅ bypass |
| `our_forecasts` | 0017 | ✅ SELECT | ✅ bypass |
| `valuation_multiples` | 0017 | ✅ SELECT | ✅ bypass |
| `portfolio_positions` | 0018 | ❌ brak (prywatne) | ✅ explicit policy |
| `portfolio_transactions` | 0018 | ❌ brak (prywatne) | ✅ explicit policy |
| `peer_groups` | 0019 | ✅ SELECT | ✅ bypass |
| `peer_group_members` | 0019 | ✅ SELECT | ✅ bypass |
| `institutional_ownership` | 0020 | ✅ SELECT | ✅ explicit policy |
| `calendar_events` | 0021 | ✅ SELECT | ✅ explicit policy |

### ⚠️ Tabele BEZ RLS przed audytem (legacy, pre-migration)

| Tabela | Problem | Akcja |
|---|---|---|
| `news` | Brak RLS — anon mógł czytać bez polityki | ✅ Dodano anon_read + service_role_all (0024) |
| `news_audit` | Brak RLS — anon mógł czytać audit trail | ✅ Dodano service_role_all, anon blocked (0024) |
| `tickers` | Brak RLS — anon mógł czytać bez polityki | ✅ Dodano anon_read + service_role_all (0024) |

---

## Policies po hardening

### news
- `anon_read_news`: SELECT TO anon USING (true) — publiczny odczyt ✅
- `service_role_all_news`: ALL TO service_role — pełny dostęp Edge Functions ✅

### news_audit
- `service_role_all_news_audit`: ALL TO service_role ✅
- anon: brak dostępu (audit trail = wewnętrzny) ✅

### tickers
- `anon_read_tickers`: SELECT TO anon USING (true) ✅
- `service_role_all_tickers`: ALL TO service_role ✅

---

## Uwagi architekturalne

1. **service_role bypass**: Supabase service_role posiada `BYPASSRLS` privilege z definicji.
   Nie wymaga explicit policies — wystarczy `ENABLE ROW LEVEL SECURITY` na tabeli.

2. **portfolio_positions / portfolio_transactions**: Intentionally brak anon access.
   Dane prywatne — dostępne tylko przez service_role (przez Next.js API routes z auth).

3. **raw_ingest**: Intentionally brak anon access. Staging table z surowymi danymi —
   dostępna tylko dla Edge Functions (service_role).

4. **Nowe tabele**: Każda nowa tabela MUSI zawierać `ENABLE ROW LEVEL SECURITY`
   oraz odpowiednie policies już w migracji tworzenia.

---

## Naprawione w 0024_rls_hardening.sql

- `news` — ENABLE ROW LEVEL SECURITY + anon_read + service_role_all
- `news_audit` — ENABLE ROW LEVEL SECURITY + service_role_all (anon blocked)
- `tickers` — ENABLE ROW LEVEL SECURITY + anon_read + service_role_all

Migracja: `supabase/migrations/0024_rls_hardening.sql`
Status: ✅ Applied 2026-02-25
