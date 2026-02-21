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
