// supabase/functions/process-dm-pdf/index.ts
// Multi-company DM recommendation PDF processor.
//
// POST body: { url: string, institution?: string, report_date?: string }
//
// Flow:
//   1. Download PDF from signed URL
//   2. Gemini 2.0 Flash — detect type + extract all company recommendations
//   3. For each company: compute upside_pct, insert dm_reports + analyst_forecasts
//   4. Claude Haiku — generate Telegram summary
//   5. Send Telegram alert
//
// Secrets required: GOOGLE_AI_KEY, ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RequestBody {
  url:          string;
  institution?: string;
  report_date?: string;
}

interface CompanyForecast {
  ticker:         string;
  recommendation: string;   // BUY | HOLD | SELL | NEUTRAL | OVERWEIGHT | UNDERWEIGHT
  price_target:   number | null;
  currency:       string;
  horizon_months: number | null;
  analyst_name:   string | null;
}

interface GeminiExtraction {
  type:         string;   // "dm_report" | "financial_report" | "unknown"
  institution:  string | null;
  report_date:  string | null;
  companies:    CompanyForecast[];
  summary:      string | null;
}

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const JSON_HEADERS = { "Content-Type": "application/json", ...CORS };

// ─── Gemini: detect type + extract all companies ──────────────────────────────

const GEMINI_PROMPT = `Przeanalizuj ten dokument PDF. Określ jego typ i wyekstrahuj dane.

Zwróć WYŁĄCZNIE JSON (bez markdown, bez komentarzy):
{
  "type": "dm_report" lub "financial_report" lub "unknown",
  "institution": "nazwa domu maklerskiego lub null",
  "report_date": "YYYY-MM-DD lub null",
  "companies": [
    {
      "ticker": "kod giełdowy (2-6 liter, np. PKN, CDR)",
      "recommendation": "BUY lub HOLD lub SELL lub NEUTRAL lub OVERWEIGHT lub UNDERWEIGHT",
      "price_target": <liczba lub null>,
      "currency": "PLN lub EUR lub USD",
      "horizon_months": <liczba miesięcy lub null>,
      "analyst_name": "imię nazwisko analityka lub null"
    }
  ],
  "summary": "1-3 zdania po polsku o głównych wnioskach raportu lub null"
}

dm_report = rekomendacja domu maklerskiego / biura maklerskiego z rekomendacjami inwestycyjnymi.
financial_report = raport finansowy spółki (roczny/kwartalny).
Jeśli dm_report, wylistuj WSZYSTKIE spółki z rekomendacjami z dokumentu.`;

async function callGeminiExtract(
  apiKey:    string,
  pdfBase64: string,
  mimeType:  string,
): Promise<GeminiExtraction> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: pdfBase64 } },
          { text: GEMINI_PROMPT },
        ],
      }],
      generationConfig: {
        temperature:        0.05,
        response_mime_type: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json() as { candidates?: Array<{ content: { parts: Array<{ text: string }> } }>; error?: { message: string } };

  if (data.error) throw new Error(`Gemini API error: ${data.error.message}`);

  const text  = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  try {
    return JSON.parse(clean) as GeminiExtraction;
  } catch {
    throw new Error(`Gemini JSON parse failed: ${clean.slice(0, 200)}`);
  }
}

// ─── Claude Haiku: polish Telegram summary ───────────────────────────────────

async function generateTelegramSummary(
  apiKey:      string,
  institution: string,
  companies:   CompanyForecast[],
  geminiSummary: string | null,
): Promise<string> {
  const companiesList = companies
    .map(c => `${c.ticker}: ${c.recommendation}${c.price_target ? ` (cel: ${c.price_target} ${c.currency})` : ""}`)
    .join(", ");

  const prompt = `Napisz KRÓTKI (2-3 zdania) alert po polsku o raporcie rekomendacyjnym DM dla systemu monitoringu giełdowego GPW.

Dom maklerski: ${institution}
Spółki: ${companiesList}
Streszczenie Gemini: ${geminiSummary ?? "brak"}

Format: profesjonalny, bez emoji w treści zdań, zwięzły. Podaj kluczowe wnioski.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages:   [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return geminiSummary ?? "Nowy raport DM zaimportowany.";
    const data = await res.json() as { content?: Array<{ text: string }> };
    return data.content?.[0]?.text?.trim() ?? geminiSummary ?? "Nowy raport DM zaimportowany.";
  } catch {
    return geminiSummary ?? "Nowy raport DM zaimportowany.";
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  console.log("[process-dm-pdf] Invoked at:", new Date().toISOString());

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")              ?? "";
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const googleAiKey  = Deno.env.get("GOOGLE_AI_KEY")             ?? "";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")         ?? "";
  const tgToken      = Deno.env.get("TELEGRAM_BOT_TOKEN")        ?? "";
  const tgChatId     = Deno.env.get("TELEGRAM_CHAT_ID")          ?? "";

  if (!googleAiKey) {
    return new Response(JSON.stringify({ ok: false, error: "GOOGLE_AI_KEY not configured" }), { status: 500, headers: JSON_HEADERS });
  }

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON body" }), { status: 400, headers: JSON_HEADERS });
  }

  const { url, institution: bodyInstitution, report_date: bodyReportDate } = body;
  if (!url) {
    return new Response(JSON.stringify({ ok: false, error: "url required" }), { status: 400, headers: JSON_HEADERS });
  }

  // ── 1. Download PDF ────────────────────────────────────────────────────────
  let pdfBase64: string;
  let mimeType:  string;

  try {
    const pdfRes = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GieldaMonitor/1.0)" },
    });
    if (!pdfRes.ok) throw new Error(`HTTP ${pdfRes.status}`);
    const ct   = pdfRes.headers.get("content-type") ?? "application/pdf";
    mimeType   = ct.includes("pdf") ? "application/pdf" : ct.split(";")[0].trim();
    const buf  = await pdfRes.arrayBuffer();
    const u8   = new Uint8Array(buf);
    let binary = "";
    const CHUNK = 8192;
    for (let i = 0; i < u8.length; i += CHUNK) {
      binary += String.fromCharCode(...u8.slice(i, i + CHUNK));
    }
    pdfBase64 = btoa(binary);
    console.log(`[process-dm-pdf] Downloaded ${buf.byteLength} bytes`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: `PDF download: ${msg}` }), { status: 502, headers: JSON_HEADERS });
  }

  // ── 2. Gemini: detect type + extract ──────────────────────────────────────
  let extracted: GeminiExtraction;
  try {
    extracted = await callGeminiExtract(googleAiKey, pdfBase64, mimeType);
    console.log(`[process-dm-pdf] Gemini type=${extracted.type} companies=${extracted.companies?.length ?? 0}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: `Gemini: ${msg}` }), { status: 502, headers: JSON_HEADERS });
  }

  if (extracted.type !== "dm_report") {
    return new Response(JSON.stringify({
      ok:   false,
      type: extracted.type,
      error: `Dokument nie jest raportem DM (wykryto: ${extracted.type}). Skorzystaj z zakładki "Raport finansowy".`,
    }), { status: 422, headers: JSON_HEADERS });
  }

  const institution = bodyInstitution?.trim() || extracted.institution || "Nieznany DM";
  const reportDate  = bodyReportDate || extracted.report_date || new Date().toISOString().slice(0, 10);
  const companies   = (extracted.companies ?? []).filter(c => c.ticker && c.recommendation);

  if (companies.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: "Brak spółek z rekomendacjami w dokumencie" }), { status: 422, headers: JSON_HEADERS });
  }

  // ── 3. Insert to DB ────────────────────────────────────────────────────────
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const dmRows:       Record<string, unknown>[] = [];
  const forecastRows: Record<string, unknown>[] = [];

  for (const c of companies) {
    const ticker = c.ticker.toUpperCase().trim();
    const rec    = c.recommendation.toUpperCase();

    // Fetch current price for upside
    const { data: priceRow } = await supabase
      .from("price_history")
      .select("close")
      .eq("ticker", ticker)
      .order("date", { ascending: false })
      .limit(1)
      .single();

    const currentPrice = priceRow?.close ?? null;
    let upside_pct: number | null = null;
    if (currentPrice && c.price_target && currentPrice > 0) {
      upside_pct = parseFloat((((c.price_target - currentPrice) / currentPrice) * 100).toFixed(2));
    }

    dmRows.push({
      ticker,
      institution,
      report_date:  reportDate,
      report_url:   url,
      recommendation: rec,
      price_target: c.price_target,
      summary:      extracted.summary,
    });

    forecastRows.push({
      ticker,
      institution,
      analyst_name:   c.analyst_name,
      recommendation: rec,
      price_target:   c.price_target,
      currency:       c.currency ?? "PLN",
      horizon_months: c.horizon_months,
      upside_pct,
      source_type:    "dm_pdf",
      published_at:   new Date(reportDate).toISOString(),
    });

    console.log(`[process-dm-pdf] ${ticker}: ${rec} tp=${c.price_target} upside=${upside_pct}%`);
  }

  const [{ error: dmErr }, { error: fErr }] = await Promise.all([
    supabase.from("dm_reports").insert(dmRows),
    supabase.from("analyst_forecasts").insert(forecastRows),
  ]);

  if (dmErr)  console.error("[process-dm-pdf] dm_reports insert error:", dmErr.message);
  if (fErr)   console.error("[process-dm-pdf] analyst_forecasts insert error:", fErr.message);

  // ── 4. Telegram summary ────────────────────────────────────────────────────
  if (tgToken && tgChatId) {
    const summaryText = anthropicKey
      ? await generateTelegramSummary(anthropicKey, institution, companies, extracted.summary)
      : extracted.summary ?? "Nowy raport DM zaimportowany.";

    const recLines = companies
      .slice(0, 6)
      .map(c => {
        const emoji = c.recommendation.startsWith("BUY") || c.recommendation === "OVERWEIGHT"
          ? "🟢" : c.recommendation.startsWith("SELL") || c.recommendation === "UNDERWEIGHT"
          ? "🔴" : "🟡";
        const tp = c.price_target ? ` → ${c.price_target} ${c.currency ?? "PLN"}` : "";
        return `${emoji} *${c.ticker}*: ${c.recommendation}${tp}`;
      })
      .join("\n");

    const moreStr = companies.length > 6 ? `\n_(+${companies.length - 6} więcej)_` : "";

    const text = [
      `📋 *RAPORT DM: ${institution}*`,
      recLines + moreStr,
      `💬 ${summaryText}`,
    ].join("\n\n");

    try {
      await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ chat_id: tgChatId, text, parse_mode: "Markdown" }),
      });
    } catch (tgErr) {
      console.warn("[process-dm-pdf] Telegram failed:", tgErr instanceof Error ? tgErr.message : String(tgErr));
    }
  }

  return new Response(JSON.stringify({
    ok:          true,
    type:        "dm_report",
    institution,
    report_date: reportDate,
    companies:   companies.length,
    tickers:     companies.map(c => c.ticker.toUpperCase()),
  }), { status: 200, headers: JSON_HEADERS });
});
