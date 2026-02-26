// supabase/functions/extract-sector-kpis/index.ts
// Extracts sector-specific KPIs from company financials + recent ESPI events
// using Claude Haiku to parse narrative reports.
//
// POST {} — process all companies
// POST { tickers: ["PKO"] } — specific tickers
// POST { sector: "Banking" } — all companies in a sector
//
// Deploy: supabase functions deploy extract-sector-kpis --project-ref pftgmorsthoezhmojjpg

import { getSupabaseClient } from "../_shared/supabase-client.ts";
import { createLogger }      from "../_shared/logger.ts";
import { callAnthropic }     from "../_shared/anthropic.ts";
import { okResponse, errorResponse } from "../_shared/response.ts";

const log = createLogger("extract-sector-kpis");

interface Company {
  ticker: string;
  sector: string;
  name:   string;
}

interface KpiDefinition {
  kpi_code: string;
  kpi_name: string;
  unit:     string;
  description: string;
}

interface CompanyEvent {
  title: string;
  summary: string | null;
  published_at: string;
}

interface CompanyFinancials {
  revenue:  number | null;
  ebitda:   number | null;
  net_income: number | null;
  period:   string | null;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  let body: { tickers?: string[]; sector?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  let supabase;
  try { supabase = getSupabaseClient(); }
  catch (err) { return errorResponse(err instanceof Error ? err.message : String(err)); }

  // ── Fetch target companies ──────────────────────────────────────────────────
  let query = supabase.from("companies").select("ticker, sector, name");
  if (body.tickers && body.tickers.length > 0) {
    query = query.in("ticker", body.tickers);
  } else if (body.sector) {
    query = query.eq("sector", body.sector);
  } else {
    query = query.eq("market", "GPW");
  }

  const { data: companies, error: compErr } = await query;
  if (compErr) return errorResponse(compErr.message);

  const companiesList = (companies ?? []) as Company[];
  log.info(`Processing ${companiesList.length} companies for sector KPIs`);

  // ── Load KPI definitions ────────────────────────────────────────────────────
  const { data: allDefs } = await supabase
    .from("sector_kpi_definitions")
    .select("sector, kpi_code, kpi_name, unit, description");

  const defsBySector = new Map<string, KpiDefinition[]>();
  for (const def of (allDefs ?? []) as Array<KpiDefinition & { sector: string }>) {
    if (!defsBySector.has(def.sector)) defsBySector.set(def.sector, []);
    defsBySector.get(def.sector)!.push(def);
  }

  let extracted = 0;
  let skipped   = 0;

  // ── Process each company ────────────────────────────────────────────────────
  for (const company of companiesList) {
    const defs = defsBySector.get(company.sector);
    if (!defs || defs.length === 0) {
      skipped++;
      continue;
    }

    // Fetch recent events for this ticker
    const { data: events } = await supabase
      .from("company_events")
      .select("title, summary, published_at")
      .eq("ticker", company.ticker)
      .order("published_at", { ascending: false })
      .limit(5);

    // Fetch latest financials
    const { data: finRows } = await supabase
      .from("company_financials")
      .select("revenue, ebitda, net_income, period")
      .eq("ticker", company.ticker)
      .order("period", { ascending: false })
      .limit(2);

    const evList   = (events ?? []) as CompanyEvent[];
    const finList  = (finRows ?? []) as CompanyFinancials[];

    if (evList.length === 0 && finList.length === 0) {
      skipped++;
      continue;
    }

    // Build context for Claude
    const kpiList = defs.map(d => `- ${d.kpi_code} (${d.kpi_name}, unit: ${d.unit}): ${d.description}`).join("\n");
    const evText  = evList.slice(0, 3).map(e =>
      `[${e.published_at?.slice(0, 10) ?? "?"}] ${e.title}: ${(e.summary ?? "").slice(0, 200)}`
    ).join("\n");
    const finText = finList.map(f =>
      `Period: ${f.period ?? "?"} | Revenue: ${f.revenue ?? "N/A"} | EBITDA: ${f.ebitda ?? "N/A"} | NetIncome: ${f.net_income ?? "N/A"}`
    ).join("\n");

    const prompt = [
      `Firma: ${company.name} (${company.ticker}), sektor: ${company.sector}`,
      ``,
      `Dostępne KPI do ekstrakcji:`,
      kpiList,
      ``,
      finList.length > 0 ? `Dane finansowe:\n${finText}` : "",
      evList.length > 0  ? `Ostatnie eventy:\n${evText}` : "",
      ``,
      `Zwróć TYLKO JSON (bez markdown) z ekstrahenowanymi wartościami:`,
      `{"kpis": [{"kpi_code": "...", "value": 1.23, "period": "2025-Q3"}]}`,
      `Jeśli nie można ekstrahenować wartości, pomiń dany KPI. Wartości liczbowe tylko.`,
    ].filter(Boolean).join("\n");

    let kpiResults: Array<{ kpi_code: string; value: number; period?: string }> = [];

    try {
      const raw = await callAnthropic(
        "health_score",
        "Jesteś analitykiem finansowym. Ekstrahuj sektorowe KPI z podanych danych finansowych. Zwróć JSON.",
        [{ role: "user", content: prompt }],
        400,
      );

      // Strip markdown fences if present
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed  = JSON.parse(cleaned) as { kpis?: typeof kpiResults };
      kpiResults    = parsed.kpis ?? [];
    } catch (err) {
      log.warn(`${company.ticker}: Claude extraction failed —`, err instanceof Error ? err.message : String(err));
      skipped++;
      continue;
    }

    if (kpiResults.length === 0) { skipped++; continue; }

    // Build upsert rows
    const currentPeriod = `${new Date().getUTCFullYear()}-Q${Math.ceil((new Date().getUTCMonth() + 1) / 3)}`;
    const rows = kpiResults.map(k => {
      const def = defs.find(d => d.kpi_code === k.kpi_code);
      return {
        ticker:       company.ticker,
        sector:       company.sector,
        kpi_code:     k.kpi_code,
        kpi_name:     def?.kpi_name ?? k.kpi_code,
        value:        k.value,
        unit:         def?.unit ?? "%",
        period:       k.period ?? currentPeriod,
        source:       "claude_haiku",
        extracted_at: new Date().toISOString(),
      };
    });

    const { error: upsertErr } = await supabase
      .from("sector_kpis")
      .upsert(rows, { onConflict: "ticker,kpi_code,period" });

    if (upsertErr) {
      log.warn(`${company.ticker}: upsert error —`, upsertErr.message);
    } else {
      log.info(`${company.ticker}: extracted ${rows.length} KPIs`);
      extracted += rows.length;
    }

    // Small delay to avoid Claude rate limits
    await new Promise(r => setTimeout(r, 200));
  }

  log.info(`Done. extracted=${extracted} skipped=${skipped}`);
  return okResponse({ extracted, skipped, companies_processed: companiesList.length });
});
