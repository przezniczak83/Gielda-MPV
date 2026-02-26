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

// Scrape Strefa Inwestorów articles (no RSS — Drupal CMS)
// GET /scrape/strefa
app.get("/scrape/strefa", requireApiKey, async (_req, res) => {
  try {
    const response = await fetch("https://strefainwestorow.pl/artykuly", {
      headers: {
        "User-Agent": "GieldaMonitor/3.1 (+https://gielda-mpv.vercel.app)",
        "Accept":     "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout ? AbortSignal.timeout(15_000) : undefined,
    });

    if (!response.ok) {
      return res.status(502).json({ ok: false, error: `HTTP ${response.status}` });
    }

    const html = await response.text();
    const articles = [];

    // Drupal: articles in <article> tags or <div class="views-row">
    // Primary: <article> elements with h2/h3 links + time[datetime]
    const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/g;
    let match;

    while ((match = articleRegex.exec(html)) !== null) {
      const articleHtml = match[1];

      // Title + URL: find the first <a href="..."> inside heading tags
      const linkMatch = articleHtml.match(/<(?:h[23]|a)[^>]*>\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
        ?? articleHtml.match(/<a\s+href="(\/[^"]+)"[^>]*>([^<]{10,})<\/a>/i);

      if (!linkMatch) continue;

      const rawHref = linkMatch[1];
      const rawTitle = linkMatch[2].replace(/<[^>]+>/g, "").trim();
      if (!rawTitle || rawTitle.length < 5) continue;

      const articleUrl = rawHref.startsWith("http")
        ? rawHref
        : "https://strefainwestorow.pl" + rawHref;

      // Date
      const dateMatch = articleHtml.match(/datetime="([^"]+)"/);

      // Lead / excerpt
      const leadMatch = articleHtml.match(/<p[^>]*>([^<]{30,})<\/p>/);

      articles.push({
        url:          articleUrl,
        title:        rawTitle.slice(0, 500),
        published_at: dateMatch?.[1] ?? null,
        summary:      leadMatch?.[1]?.trim().slice(0, 1000) ?? null,
        source:       "strefa",
      });
    }

    // Fallback: plain link extraction if no <article> tags found
    if (articles.length === 0) {
      const linkRegex = /<a\s+href="(\/artykuly\/[^"]+)"[^>]*>([^<]{15,})<\/a>/g;
      let lm;
      while ((lm = linkRegex.exec(html)) !== null && articles.length < 30) {
        articles.push({
          url:          "https://strefainwestorow.pl" + lm[1],
          title:        lm[2].trim().slice(0, 500),
          published_at: null,
          summary:      null,
          source:       "strefa",
        });
      }
    }

    // Deduplicate by URL
    const seen  = new Set();
    const unique = articles.filter(a => {
      if (seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });

    return res.json({ ok: true, count: unique.length, articles: unique });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[scrape/strefa]", msg);
    return res.status(500).json({ ok: false, error: msg });
  }
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
