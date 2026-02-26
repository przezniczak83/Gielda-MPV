// supabase/functions/fetch-dividends/index.ts
// Fetches historical dividend data from EODHD API for all GPW companies.
// Stores results in the dividends table.
//
// POST {} — fetch dividends for all GPW companies
// POST { tickers: ["PKN", "PKO"] } — fetch for specific tickers only
//
// Requires: EODHD_KEY secret
// Deploy: supabase functions deploy fetch-dividends --project-ref pftgmorsthoezhmojjpg

import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { createLogger }      from "../_shared/logger.ts";
import { okResponse, errorResponse } from "../_shared/response.ts";

const log = createLogger("fetch-dividends");

// EODHD dividend response item
interface EODHDDividend {
  date:             string;   // ex-dividend date
  paymentDate?:     string;
  declarationDate?: string;
  amount:           number;
  currency?:        string;
  unadjustedValue?: number;
}

async function fetchDividends(
  ticker: string,
  apiKey: string,
): Promise<EODHDDividend[]> {
  // EODHD: GPW tickers use .WAR suffix
  const symbol = `${ticker}.WAR`;
  const url    = `https://eodhd.com/api/div/${symbol}?api_token=${apiKey}&fmt=json&from=2018-01-01`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) {
      log.warn(`${ticker}: 404 — no dividend data in EODHD`);
      return [];
    }
    if (!res.ok) {
      log.warn(`${ticker}: EODHD HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      log.warn(`${ticker}: unexpected response format`);
      return [];
    }
    return data as EODHDDividend[];
  } catch (err) {
    log.warn(`${ticker}: fetch error —`, err instanceof Error ? err.message : String(err));
    return [];
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  let body: { tickers?: string[] } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const apiKey = Deno.env.get("EODHD_KEY") ?? "";
  if (!apiKey) {
    return errorResponse("EODHD_KEY not set — set with: supabase secrets set EODHD_KEY=your_key");
  }

  let supabase;
  try { supabase = getSupabaseClient(); }
  catch (err) { return errorResponse(err instanceof Error ? err.message : String(err)); }

  // ── Determine which tickers to process ──────────────────────────────────────
  let tickers: string[];

  if (body.tickers && body.tickers.length > 0) {
    tickers = body.tickers;
  } else {
    // Fetch all GPW companies
    const { data: companies, error: compErr } = await supabase
      .from("companies")
      .select("ticker")
      .eq("market", "GPW");

    if (compErr) return errorResponse(compErr.message);
    tickers = (companies ?? []).map((c: { ticker: string }) => c.ticker);
  }

  log.info(`Processing ${tickers.length} tickers for dividends`);

  let inserted = 0;
  let failed   = 0;
  let noData   = 0;

  // Process in batches of 5 to avoid rate limits
  const BATCH_SIZE = 5;
  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(ticker => fetchDividends(ticker, apiKey))
    );

    for (let j = 0; j < batch.length; j++) {
      const ticker   = batch[j];
      const divItems = results[j];

      if (divItems.length === 0) {
        noData++;
        continue;
      }

      // Prepare rows for upsert
      const rows = divItems
        .filter(d => d.amount > 0 && d.date)
        .map(d => ({
          ticker,
          ex_date:          d.date,
          payment_date:     d.paymentDate     || null,
          declaration_date: d.declarationDate || null,
          amount:           d.amount,
          currency:         d.currency ?? "PLN",
          type:             "Cash",
          source:           "EODHD",
        }));

      if (rows.length === 0) { noData++; continue; }

      const { error: upsertErr } = await supabase
        .from("dividends")
        .upsert(rows, { onConflict: "ticker,ex_date" });

      if (upsertErr) {
        log.warn(`${ticker}: upsert error —`, upsertErr.message);
        failed++;
      } else {
        log.info(`${ticker}: upserted ${rows.length} dividend records`);
        inserted += rows.length;
      }
    }

    // Small delay between batches to respect rate limits
    if (i + BATCH_SIZE < tickers.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  log.info(`Done. inserted=${inserted} noData=${noData} failed=${failed}`);
  return okResponse({ inserted, noData, failed, tickers_processed: tickers.length });
});
