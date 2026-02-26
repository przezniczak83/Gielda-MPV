// app/app/api/generate-report/route.ts
// Generates an AI-powered company report using Claude Sonnet.
// Fetches company data, events, financials, KPIs and produces Markdown.
//
// POST /api/generate-report { ticker: string, force?: boolean }
// Returns: { ok, report_md, ticker, generated_at }

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

export async function POST(req: NextRequest) {
  const { ticker: rawTicker, force } = await req.json() as { ticker: string; force?: boolean };
  if (!rawTicker) {
    return NextResponse.json({ ok: false, error: "ticker required" }, { status: 400 });
  }

  const ticker  = rawTicker.toUpperCase().trim();
  const apiKey  = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const db = supabase();

  // ── Check cache (company_kpis.metadata.report_md, max 24h) ──────────────
  if (!force) {
    const { data: cached } = await db
      .from("company_kpis")
      .select("metadata, updated_at")
      .eq("ticker", ticker)
      .eq("kpi_type", "report")
      .maybeSingle();

    if (cached?.metadata?.report_md) {
      const ageHours = (Date.now() - new Date(cached.updated_at).getTime()) / 3_600_000;
      if (ageHours < 24) {
        return NextResponse.json({
          ok:           true,
          report_md:    cached.metadata.report_md,
          ticker,
          generated_at: cached.updated_at,
          cached:       true,
        });
      }
    }
  }

  // ── Fetch data in parallel ────────────────────────────────────────────────
  const [
    companyRes, eventsRes, finRes, kpiRes, priceRes
  ] = await Promise.all([
    db.from("companies").select("ticker, name, sector, market, has_subsidiaries").eq("ticker", ticker).maybeSingle(),
    db.from("company_events").select("title, event_type, impact_score, published_at, summary").eq("ticker", ticker).order("published_at", { ascending: false }).limit(15),
    db.from("company_financials").select("revenue, ebitda, net_income, eps, period").eq("ticker", ticker).order("period", { ascending: false }).limit(4),
    db.from("company_kpis").select("kpi_type, value, metadata").eq("ticker", ticker).in("kpi_type", ["health_score", "moat_score", "dividend_score"]),
    db.from("price_history").select("date, close, volume, open, high, low").eq("ticker", ticker).order("date", { ascending: false }).limit(30),
  ]);

  const company  = companyRes.data;
  if (!company) {
    return NextResponse.json({ ok: false, error: `Ticker ${ticker} not found` }, { status: 404 });
  }

  const events = eventsRes.data ?? [];
  const fins   = finRes.data   ?? [];
  const kpis   = kpiRes.data   ?? [];
  const prices = priceRes.data ?? [];

  // ── Build context ──────────────────────────────────────────────────────────
  const latestPrice = prices[0];
  const priceChange = prices.length >= 2
    ? ((prices[0].close - prices[1].close) / prices[1].close * 100).toFixed(2)
    : null;

  const healthKpi = kpis.find(k => k.kpi_type === "health_score");
  const moatKpi   = kpis.find(k => k.kpi_type === "moat_score");

  const finText = fins.map(f =>
    `Period: ${f.period ?? "?"} | Revenue: ${f.revenue ? (f.revenue / 1e6).toFixed(1) + "M" : "N/A"} | EBITDA: ${f.ebitda ? (f.ebitda / 1e6).toFixed(1) + "M" : "N/A"} | Net income: ${f.net_income ? (f.net_income / 1e6).toFixed(1) + "M" : "N/A"}`
  ).join("\n");

  const evText = events.slice(0, 10).map(e =>
    `[${e.published_at?.slice(0, 10) ?? "?"}][${e.event_type ?? "?"}][impact:${e.impact_score ?? "?"}] ${e.title}${e.summary ? ": " + (e.summary as string).slice(0, 100) : ""}`
  ).join("\n");

  const prompt = `
Dane spółki ${ticker} (${company.name}):
Sektor: ${company.sector ?? "N/A"} | Rynek: ${company.market}

Ostatnia cena: ${latestPrice ? `${latestPrice.close} PLN (${priceChange !== null ? `${Number(priceChange) >= 0 ? "+" : ""}${priceChange}%` : "—"})` : "N/A"}
Health Score: ${healthKpi?.value ?? "N/A"}/10
Moat Score: ${moatKpi?.value ?? "N/A"}/10

Wyniki finansowe (ostatnie okresy):
${finText || "Brak danych"}

Najnowsze eventy korporacyjne:
${evText || "Brak danych"}
`.trim();

  // ── Generate with Claude Sonnet ────────────────────────────────────────────
  const systemPrompt = [
    "Jesteś analitykiem GPW i USA. Napisz profesjonalny raport analizy spółki po polsku.",
    "Użyj formatowania Markdown. Struktura:",
    "## Podsumowanie wykonawcze",
    "## Profil spółki",
    "## Analiza fundamentalna",
    "## Wyniki finansowe",
    "## Kluczowe ryzyka i szanse",
    "## Ocena i rekomendacja",
    "Raport powinien mieć 600-900 słów. Bądź konkretny i oparty na dostarczonych danych.",
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system:     systemPrompt,
      messages:   [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "unknown");
    return NextResponse.json({ ok: false, error: `Claude error: ${res.status} ${err.slice(0, 200)}` }, { status: 502 });
  }

  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  const reportMd = data.content.find(b => b.type === "text")?.text ?? "";

  // ── Cache in company_kpis table ───────────────────────────────────────────
  await db.from("company_kpis").upsert(
    {
      ticker,
      kpi_type: "report",
      value:    null,
      metadata: { report_md: reportMd },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "ticker,kpi_type" },
  );

  return NextResponse.json({
    ok:           true,
    report_md:    reportMd,
    ticker,
    generated_at: new Date().toISOString(),
    cached:       false,
  });
}
