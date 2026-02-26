import express from "express";
import { fetchStooqPrice, fetchStooqHistory } from "./scrapers/stooq.js";
import { fetchInsiderTransactions } from "./scrapers/insider.js";

const app  = express();
const PORT = process.env.PORT ?? 3001;
const API_KEY = process.env.SCRAPER_API_KEY ?? "";

// ── Auth middleware ─────────────────────────────────────────────────────────

function requireApiKey(req, res, next) {
  if (!API_KEY) {
    // No key configured — allow all (dev mode)
    return next();
  }
  const provided = req.headers["x-api-key"];
  if (provided !== API_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

// ── Routes ──────────────────────────────────────────────────────────────────

// Health check (no auth required)
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "gielda-scraper", ts: new Date().toISOString() });
});

// Latest price for a single ticker
// GET /prices/gpw?ticker=PKN
app.get("/prices/gpw", requireApiKey, async (req, res) => {
  const ticker = req.query.ticker?.toString().toUpperCase();
  if (!ticker) {
    return res.status(400).json({ ok: false, error: "ticker query param required" });
  }

  try {
    const data = await fetchStooqPrice(ticker);
    return res.json({ ok: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[prices/gpw] ${ticker}: ${msg}`);
    return res.status(502).json({ ok: false, error: msg });
  }
});

// Price history for a single ticker
// GET /prices/gpw/history?ticker=PKN&days=30
app.get("/prices/gpw/history", requireApiKey, async (req, res) => {
  const ticker = req.query.ticker?.toString().toUpperCase();
  const days   = Math.min(parseInt(req.query.days ?? "30", 10) || 30, 365);

  if (!ticker) {
    return res.status(400).json({ ok: false, error: "ticker query param required" });
  }

  try {
    const data = await fetchStooqHistory(ticker, days);
    return res.json({ ok: true, ticker, days, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[prices/gpw/history] ${ticker}: ${msg}`);
    return res.status(502).json({ ok: false, error: msg });
  }
});

// Batch price history for multiple GPW tickers in one call
// GET /prices/gpw/batch?tickers=PKN,PKO,PZU&days=30
app.get("/prices/gpw/batch", requireApiKey, async (req, res) => {
  const raw  = req.query.tickers?.toString() ?? "";
  const days = Math.min(parseInt(req.query.days ?? "30", 10) || 30, 365);

  if (!raw) {
    return res.status(400).json({ ok: false, error: "tickers query param required" });
  }

  const tickers = raw.toUpperCase().split(",").map(t => t.trim()).filter(Boolean).slice(0, 60);

  const results = [];
  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    if (i > 0) await new Promise(r => setTimeout(r, 120));

    try {
      const data = await fetchStooqHistory(ticker, days);
      results.push({ ticker, ok: true, data });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[prices/gpw/batch] ${ticker}: ${msg}`);
      results.push({ ticker, ok: false, error: msg, data: [] });
    }
  }

  return res.json({ ok: true, count: results.length, results });
});

// Insider transactions from GPW
// GET /insider
app.get("/insider", requireApiKey, async (_req, res) => {
  try {
    const data = await fetchInsiderTransactions();
    return res.json({ ok: true, count: data.length, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[insider]: ${msg}`);
    return res.status(502).json({ ok: false, error: msg });
  }
});

// ── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[gielda-scraper] listening on port ${PORT}`);
  if (!API_KEY) {
    console.warn("[gielda-scraper] WARNING: SCRAPER_API_KEY not set — all requests allowed");
  }
});
