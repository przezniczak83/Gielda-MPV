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
    companyRes, eventsRes, finRes, kpiRes, priceRes, newsRes
  ] = await Promise.all([
    db.from("companies").select("ticker, name, sector, market, has_subsidiaries").eq("ticker", ticker).maybeSingle(),
    db.from("company_events").select("title, event_type, impact_score, published_at, summary").eq("ticker", ticker).order("published_at", { ascending: false }).limit(15),
    db.from("company_financials").select("revenue, ebitda, net_income, eps, period").eq("ticker", ticker).order("period", { ascending: false }).limit(4),
    db.from("company_kpis").select("kpi_type, value, metadata").eq("ticker", ticker).in("kpi_type", ["health_score", "moat_score", "dividend_score"]),
    db.from("price_history").select("date, close, volume, open, high, low").eq("ticker", ticker).order("date", { ascending: false }).limit(30),
    db.from("news_items").select("title, published_at, source_name, impact_assessment, is_breaking").contains("tickers", [ticker]).order("published_at", { ascending: false }).limit(10),
  ]);

  const company  = companyRes.data;
  if (!company) {
    return NextResponse.json({ ok: false, error: `Ticker ${ticker} not found` }, { status: 404 });
  }

  const events = eventsRes.data ?? [];
  const fins   = finRes.data   ?? [];
  const kpis   = kpiRes.data   ?? [];
  const prices = priceRes.data ?? [];
  const news   = newsRes.data  ?? [];

  // ── Build context ──────────────────────────────────────────────────────────
  const latestPrice = prices[0];
  const priceChange = prices.length >= 2
    ? ((prices[0].close - prices[1].close) / prices[1].close * 100).toFixed(2)
    : null;

  // 30-day price stats
  const closePrices  = prices.map(p => p.close);
  const price30dHigh = closePrices.length ? Math.max(...closePrices).toFixed(2) : "N/A";
  const price30dLow  = closePrices.length ? Math.min(...closePrices).toFixed(2) : "N/A";
  const price30dRet  = closePrices.length >= 2
    ? (((closePrices[0] - closePrices[closePrices.length - 1]) / closePrices[closePrices.length - 1]) * 100).toFixed(2)
    : null;

  const healthKpi = kpis.find(k => k.kpi_type === "health_score");
  const moatKpi   = kpis.find(k => k.kpi_type === "moat_score");
  const divKpi    = kpis.find(k => k.kpi_type === "dividend_score");

  const finText = fins.map(f =>
    `[${f.period ?? "?"}] Przychody: ${f.revenue ? (f.revenue / 1e6).toFixed(1) + "M PLN" : "N/A"} | EBITDA: ${f.ebitda ? (f.ebitda / 1e6).toFixed(1) + "M PLN" : "N/A"} | Zysk netto: ${f.net_income ? (f.net_income / 1e6).toFixed(1) + "M PLN" : "N/A"} | EPS: ${f.eps ?? "N/A"}`
  ).join("\n");

  const evText = events.slice(0, 10).map(e =>
    `[${e.published_at?.slice(0, 10) ?? "?"}][${e.event_type ?? "?"}][wpływ:${e.impact_score ?? "?"}] ${e.title}${e.summary ? ": " + (e.summary as string).slice(0, 120) : ""}`
  ).join("\n");

  const newsText = news.map(n =>
    `[${n.published_at?.slice(0, 10) ?? "?"}][${n.source_name ?? "?"}]${n.is_breaking ? "[BREAKING]" : ""} ${n.title}${n.impact_assessment ? " — " + (n.impact_assessment as string).slice(0, 80) : ""}`
  ).join("\n");

  const prompt = `
## Spółka: ${ticker} — ${company.name}
Sektor: ${company.sector ?? "N/A"} | Rynek: ${company.market}

## Dane cenowe (30 dni)
Ostatnia cena: ${latestPrice ? `${latestPrice.close} PLN` : "brak"}
Zmiana 1d: ${priceChange !== null ? `${Number(priceChange) >= 0 ? "+" : ""}${priceChange}%` : "—"}
Zmiana 30d: ${price30dRet !== null ? `${Number(price30dRet) >= 0 ? "+" : ""}${price30dRet}%` : "—"}
Max 30d: ${price30dHigh} PLN | Min 30d: ${price30dLow} PLN

## Oceny analityczne
Health Score: ${healthKpi?.value ?? "N/A"}/10
Moat Score: ${moatKpi?.value ?? "N/A"}/10
Ryzyko dywidendy: ${(divKpi?.metadata as { cut_risk?: string } | null)?.cut_risk ?? "N/A"}

## Wyniki finansowe (ostatnie okresy)
${finText || "Brak danych finansowych"}

## Najnowsze wiadomości (RSS/prasa)
${newsText || "Brak wiadomości"}

## Eventy korporacyjne (ESPI/EBI)
${evText || "Brak eventów"}
`.trim();

  // ── Generate with Claude Sonnet ────────────────────────────────────────────
  const systemPrompt = [
    "Jesteś doświadczonym analitykiem giełdowym specjalizującym się w GPW i rynkach USA.",
    "Napisz profesjonalny raport analizy spółki po polsku, oparty WYŁĄCZNIE na dostarczonych danych.",
    "Użyj formatowania Markdown. Obowiązkowa struktura raportu:",
    "## Podsumowanie wykonawcze",
    "## Sytuacja rynkowa i wycena",
    "## Analiza fundamentalna",
    "## Wyniki finansowe",
    "## Kluczowe ryzyka i szanse",
    "## Ocena i rekomendacja",
    "Raport powinien mieć 700-1000 słów. Bądź konkretny, oparty na danych, unikaj ogólników.",
    "Uwzględnij najnowsze wiadomości i eventy przy ocenie ryzyk i rekomendacji.",
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
