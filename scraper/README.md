# gielda-scraper

Express.js scraper for GPW (Warsaw Stock Exchange) data. Runs on [Railway](https://railway.app) to bypass IP restrictions that Supabase Edge Functions may encounter.

## Endpoints

All endpoints (except `/health`) require `X-API-Key` header matching `SCRAPER_API_KEY` env var.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check, no auth required |
| GET | `/prices/gpw?ticker=PKN` | Latest price for a GPW ticker (from Stooq) |
| GET | `/prices/gpw/history?ticker=PKN&days=30` | Price history (max 365 days) |
| GET | `/insider` | Insider transactions from gpw.pl |

### Example responses

```json
// GET /prices/gpw?ticker=PKN
{
  "ok": true,
  "data": {
    "ticker": "PKN",
    "date": "2025-02-24",
    "open": 54.20,
    "high": 55.10,
    "low": 53.80,
    "close": 54.60,
    "volume": 1234567,
    "source": "stooq"
  }
}

// GET /prices/gpw/history?ticker=PKN&days=5
{
  "ok": true,
  "ticker": "PKN",
  "days": 5,
  "data": [
    { "date": "2025-02-18", "close": 53.20, "volume": 987654 },
    ...
  ]
}
```

## Deploy to Railway

### 1. Create a Railway project

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# From the scraper/ directory:
cd scraper
railway init
railway up
```

### 2. Set environment variables in Railway dashboard

| Variable | Value |
|----------|-------|
| `SCRAPER_API_KEY` | A strong random secret (e.g. `openssl rand -hex 32`) |
| `PORT` | Set automatically by Railway |

### 3. Note your Railway URL

Railway will assign a URL like `https://gielda-scraper-production.up.railway.app`.

Add this to your Supabase project secrets or `.env.local`:

```
SCRAPER_BASE_URL=https://gielda-scraper-production.up.railway.app
SCRAPER_API_KEY=your-secret-key
```

### 4. Wire into Supabase Edge Functions

From an Edge Function, fetch prices:

```typescript
const scraperUrl  = Deno.env.get("SCRAPER_BASE_URL");
const scraperKey  = Deno.env.get("SCRAPER_API_KEY");

const res = await fetch(`${scraperUrl}/prices/gpw?ticker=${ticker}`, {
  headers: { "X-API-Key": scraperKey },
});
const { data } = await res.json();
// data.close → latest closing price
```

## Local development

```bash
cd scraper
npm install
SCRAPER_API_KEY=dev node index.js
# Server on http://localhost:3001
curl http://localhost:3001/health
curl -H "X-API-Key: dev" "http://localhost:3001/prices/gpw?ticker=PKN"
```

## Data sources

- **Stooq** (`stooq.pl`) — free CSV price data for GPW equities, suffix `.pl` (e.g. `pkn.pl`)
- **GPW** (`gpw.pl/transakcje-insiderow`) — insider transaction HTML table parsed with Cheerio
