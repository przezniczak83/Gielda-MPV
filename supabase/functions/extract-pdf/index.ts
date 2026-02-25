// supabase/functions/extract-pdf/index.ts
// Ekstrakcja danych finansowych z raportów PDF przy użyciu Gemini 2.0 Flash.
//
// POST body: { url: string, ticker: string }
//
// Logika:
//   1. Pobierz PDF z URL
//   2. Wyślij jako base64 do Gemini 2.0 Flash z promptem ekstrakcji
//   3. Parsuj JSON z odpowiedzi Gemini
//   4. Upsert do company_financials
//
// Wymagania: GOOGLE_AI_KEY w Supabase Secrets
// Deploy: supabase functions deploy extract-pdf --project-ref pftgmorsthoezhmojjpg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RequestBody {
  url:    string;
  ticker: string;
}

interface ExtractedFinancials {
  revenue:    number | null;
  net_income: number | null;
  ebitda:     number | null;
  eps:        number | null;
  net_debt:   number | null;
  period:     string;
  currency:   string;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
    };
  }>;
  error?: { code: number; message: string };
}

// ─── Gemini caller ────────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `Wyekstrahuj z tego raportu finansowego następujące dane:
1. Przychody (revenue) - ostatni kwartał i rok temu
2. Zysk netto (net income)
3. EBITDA
4. EPS (zysk na akcję)
5. Dług netto

Zwróć WYŁĄCZNIE JSON w formacie (bez markdown, bez komentarzy):
{
  "revenue": <liczba lub null>,
  "net_income": <liczba lub null>,
  "ebitda": <liczba lub null>,
  "eps": <liczba lub null>,
  "net_debt": <liczba lub null>,
  "period": "<np. Q4 2025 lub FY 2025>",
  "currency": "<waluta, np. PLN lub USD>"
}`;

async function callGemini(
  apiKey:     string,
  pdfBase64:  string,
  mimeType:   string,
): Promise<ExtractedFinancials> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data:      pdfBase64,
            },
          },
          { text: EXTRACTION_PROMPT },
        ],
      }],
      generationConfig: {
        temperature:        0.1,
        response_mime_type: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json() as GeminiResponse;

  if (data.error) {
    throw new Error(`Gemini API error: ${data.error.message}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) {
    throw new Error("Gemini returned empty response");
  }

  // Strip markdown code fences if present
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  try {
    return JSON.parse(clean) as ExtractedFinancials;
  } catch {
    throw new Error(`Failed to parse Gemini JSON: ${clean.slice(0, 200)}`);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  console.log("[extract-pdf] Invoked at:", new Date().toISOString());

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  const headers = {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid JSON body" }),
      { status: 400, headers },
    );
  }

  const { url, ticker: rawTicker } = body;
  const ticker = (rawTicker ?? "").toUpperCase().trim();

  if (!url || !ticker) {
    return new Response(
      JSON.stringify({ ok: false, error: "url and ticker are required" }),
      { status: 400, headers },
    );
  }

  const googleAiKey = Deno.env.get("GOOGLE_AI_KEY") ?? "";
  if (!googleAiKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "GOOGLE_AI_KEY not configured" }),
      { status: 500, headers },
    );
  }

  console.log(`[extract-pdf] ticker=${ticker} url=${url}`);

  // ── 1. Download PDF ────────────────────────────────────────────────────────
  let pdfBuffer: ArrayBuffer;
  let mimeType: string;

  try {
    const pdfRes = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GieldaMonitor/1.0)",
        "Accept":     "application/pdf,*/*",
      },
    });

    if (!pdfRes.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: `PDF fetch failed: HTTP ${pdfRes.status}` }),
        { status: 400, headers },
      );
    }

    const ct = pdfRes.headers.get("content-type") ?? "application/pdf";
    mimeType = ct.includes("pdf") ? "application/pdf" : ct.split(";")[0].trim();

    pdfBuffer = await pdfRes.arrayBuffer();
    console.log(`[extract-pdf] Downloaded ${pdfBuffer.byteLength} bytes (${mimeType})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ ok: false, error: `PDF download error: ${msg}` }),
      { status: 502, headers },
    );
  }

  // ── 2. Convert to base64 ───────────────────────────────────────────────────
  const uint8   = new Uint8Array(pdfBuffer);
  let binary    = "";
  const CHUNK   = 8192;
  for (let i = 0; i < uint8.length; i += CHUNK) {
    binary += String.fromCharCode(...uint8.slice(i, i + CHUNK));
  }
  const pdfBase64 = btoa(binary);
  console.log(`[extract-pdf] Base64 length: ${pdfBase64.length}`);

  // ── 3. Call Gemini ─────────────────────────────────────────────────────────
  let financials: ExtractedFinancials;
  try {
    financials = await callGemini(googleAiKey, pdfBase64, mimeType);
    console.log(`[extract-pdf] Gemini extracted: period="${financials.period}" currency="${financials.currency}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[extract-pdf] Gemini error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 502, headers },
    );
  }

  // ── 4. Upsert to company_financials ───────────────────────────────────────
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")              ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const row = {
    ticker,
    period:     financials.period     || "unknown",
    revenue:    financials.revenue    ?? null,
    net_income: financials.net_income ?? null,
    ebitda:     financials.ebitda     ?? null,
    eps:        financials.eps        ?? null,
    net_debt:   financials.net_debt   ?? null,
    currency:   financials.currency   || "PLN",
    source_url: url,
  };

  const { error: upsertErr } = await supabase
    .from("company_financials")
    .upsert(row, { onConflict: "ticker,period" });

  if (upsertErr) {
    console.error("[extract-pdf] Upsert error:", upsertErr.message);
    return new Response(
      JSON.stringify({ ok: false, error: upsertErr.message }),
      { status: 500, headers },
    );
  }

  console.log(`[extract-pdf] Saved to company_financials: ${ticker} / ${row.period}`);

  return new Response(
    JSON.stringify({
      ok:     true,
      ticker,
      period: row.period,
      data:   {
        revenue:    row.revenue,
        net_income: row.net_income,
        ebitda:     row.ebitda,
        eps:        row.eps,
        net_debt:   row.net_debt,
        currency:   row.currency,
      },
      ts: new Date().toISOString(),
    }),
    { status: 200, headers },
  );
});
