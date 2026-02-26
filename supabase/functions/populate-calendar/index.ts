// supabase/functions/populate-calendar/index.ts
// Auto-populates calendar_events with predicted earnings dates.
//
// Strategy:
//   1. Query company_events for past earnings events per ticker
//   2. Identify typical reporting months (mode per quarter: Q1, Q2, Q3, Q4/Annual)
//   3. Predict the next 4 upcoming dates based on historical cadence
//   4. Upsert into calendar_events (source='auto')
//
// Fallback: if no historical data, use GPW standard reporting schedule:
//   Q4/Annual → March, Q1 → May, H1/Q2 → September, Q3 → November
//
// POST {} — populate for all GPW companies
// POST { tickers: ["PKN"] } — specific tickers only
//
// Deploy: supabase functions deploy populate-calendar --project-ref pftgmorsthoezhmojjpg

import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { createLogger }      from "../_shared/logger.ts";
import { okResponse, errorResponse } from "../_shared/response.ts";

const log = createLogger("populate-calendar");

// GPW default earnings months per quarter (day of month = 15 as placeholder)
const DEFAULT_EARNINGS_MONTHS: Record<string, number> = {
  Q4: 3,  // Annual/Q4 results → March
  Q1: 5,  // Q1 results → May
  Q2: 9,  // H1/Q2 results → September
  Q3: 11, // Q3 results → November
};

const QUARTER_LABELS = ["Q4", "Q1", "Q2", "Q3"];

function getQuarterForMonth(month: number): string {
  if (month >= 2 && month <= 4)  return "Q4"; // Annual/Q4 results (Feb–Apr)
  if (month >= 5 && month <= 7)  return "Q1"; // Q1 results (May–Jul)
  if (month >= 8 && month <= 10) return "Q2"; // H1/Q2 results (Aug–Oct)
  return "Q3"; // Q3 results (Nov–Jan)
}

function getQuarterLabel(month: number): string {
  return getQuarterForMonth(month);
}

interface EarningsEvent {
  ticker:       string;
  published_at: string;
  title:        string;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  let body: { tickers?: string[] } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  let supabase;
  try { supabase = getSupabaseClient(); }
  catch (err) { return errorResponse(err instanceof Error ? err.message : String(err)); }

  // ── Get target tickers ──────────────────────────────────────────────────────
  let tickers: string[];
  if (body.tickers && body.tickers.length > 0) {
    tickers = body.tickers;
  } else {
    const { data: companies, error: compErr } = await supabase
      .from("companies")
      .select("ticker")
      .eq("market", "GPW");
    if (compErr) return errorResponse(compErr.message);
    tickers = (companies ?? []).map((c: { ticker: string }) => c.ticker);
  }

  log.info(`Populating calendar for ${tickers.length} tickers`);

  // ── Fetch historical earnings events from company_events ────────────────────
  const { data: pastEvents, error: evErr } = await supabase
    .from("company_events")
    .select("ticker, published_at, title")
    .in("ticker", tickers)
    .or("event_type.eq.earnings_quarterly,event_type.eq.earnings_annual,event_type.ilike.earnings%,title.ilike.%wyniki%,title.ilike.%raport%,title.ilike.%przychod%")
    .order("published_at", { ascending: true });

  if (evErr) {
    log.warn("Error fetching past events:", evErr.message);
  }

  // ── Build per-ticker month distribution ─────────────────────────────────────
  const tickerMonths: Map<string, Map<string, number[]>> = new Map(); // ticker → quarter → [months]

  for (const ev of (pastEvents ?? []) as EarningsEvent[]) {
    if (!ev.published_at) continue;
    const month  = new Date(ev.published_at).getUTCMonth() + 1; // 1-12
    const quarter = getQuarterLabel(month);

    if (!tickerMonths.has(ev.ticker)) tickerMonths.set(ev.ticker, new Map());
    const qMap = tickerMonths.get(ev.ticker)!;
    if (!qMap.has(quarter)) qMap.set(quarter, []);
    qMap.get(quarter)!.push(month);
  }

  // ── Generate predictions ─────────────────────────────────────────────────────
  const now        = new Date();
  const thisYear   = now.getUTCFullYear();
  const nextYear   = thisYear + 1;
  const insertRows: Array<{
    ticker: string; event_type: string; event_date: string;
    title: string; source: string;
  }> = [];

  for (const ticker of tickers) {
    const qMap = tickerMonths.get(ticker); // may be undefined if no past data

    for (const quarter of QUARTER_LABELS) {
      // Determine predicted month: mode of historical months, or default
      let predictedMonth: number;
      if (qMap && qMap.has(quarter) && qMap.get(quarter)!.length > 0) {
        const months = qMap.get(quarter)!;
        // Simple mode: most frequent month
        const freq = new Map<number, number>();
        for (const m of months) freq.set(m, (freq.get(m) ?? 0) + 1);
        predictedMonth = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
      } else {
        predictedMonth = DEFAULT_EARNINGS_MONTHS[quarter];
      }

      // Generate dates for this year and next year
      for (const year of [thisYear, nextYear]) {
        // Q4 results typically reported in the NEXT year (e.g., Q4 2025 → March 2026)
        const eventYear = quarter === "Q4" ? year : year;
        const d = new Date(Date.UTC(eventYear, predictedMonth - 1, 15, 10, 0, 0));

        // Skip dates in the past
        if (d <= now) continue;
        // Skip dates more than 18 months away
        if (d.getTime() - now.getTime() > 18 * 30 * 24 * 3600 * 1000) continue;

        const yearLabel = quarter === "Q4"
          ? `${year - 1}`   // Q4 of last year
          : `${year}`;

        insertRows.push({
          ticker,
          event_type: "earnings",
          event_date: d.toISOString(),
          title:      `Wyniki ${quarter} ${yearLabel} — ${ticker}`,
          source:     "auto",
        });
      }
    }

    // Add dividend ex-dates from dividends table if available
    const { data: divs } = await supabase
      .from("dividends")
      .select("ex_date, amount, currency")
      .eq("ticker", ticker)
      .gt("ex_date", now.toISOString().slice(0, 10))
      .order("ex_date", { ascending: true })
      .limit(3);

    for (const div of (divs ?? []) as Array<{ ex_date: string; amount: number; currency: string }>) {
      insertRows.push({
        ticker,
        event_type: "dividend_exdate",
        event_date: `${div.ex_date}T09:00:00Z`,
        title:      `Dywidenda ${ticker} — ${div.amount} ${div.currency}`,
        source:     "auto",
      });
    }
  }

  log.info(`Generated ${insertRows.length} calendar event predictions`);

  if (insertRows.length === 0) {
    return okResponse({ inserted: 0, message: "No future events to insert" });
  }

  // ── Delete existing auto-generated future events ─────────────────────────────
  await supabase
    .from("calendar_events")
    .delete()
    .eq("source", "auto")
    .in("ticker", tickers)
    .gt("event_date", now.toISOString());

  // ── Insert new predictions ───────────────────────────────────────────────────
  const { error: insertErr } = await supabase
    .from("calendar_events")
    .insert(insertRows);

  if (insertErr) {
    log.error("Insert error:", insertErr.message);
    return errorResponse(insertErr.message);
  }

  log.info(`Inserted ${insertRows.length} calendar events`);
  return okResponse({ inserted: insertRows.length, tickers_processed: tickers.length });
});
