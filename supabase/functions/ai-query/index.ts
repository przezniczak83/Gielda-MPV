// supabase/functions/ai-query/index.ts
// AI query interface dla spółki GPW/USA.
//
// POST body: { ticker: string, question: string }
//
// AI priority:
//   1. Claude claude-sonnet-4-20250514 (ANTHROPIC_API_KEY)
//   2. GPT-4o Mini fallback (OPENAI_API_KEY)
//
// Deploy: supabase functions deploy ai-query --project-ref pftgmorsthoezhmojjpg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RequestBody {
  ticker:   string;
  question: string;
}

interface Company {
  ticker:           string;
  name:             string;
  sector:           string | null;
  market:           string;
  has_subsidiaries: boolean;
}

interface CompanyEvent {
  title:        string;
  event_type:   string;
  impact_score: number;
  published_at: string | null;
  source:       string;
}

interface PriceRecord {
  date:   string;
  close:  number | null;
  volume: number | null;
}

// ─── Context builder ──────────────────────────────────────────────────────────

function buildContext(
  company: Company,
  events:  CompanyEvent[],
  prices:  PriceRecord[],
): string {
  const lines: string[] = [];

  lines.push(`=== SPÓŁKA: ${company.ticker} (${company.name}) ===`);
  lines.push(`Rynek: ${company.market} | Sektor: ${company.sector ?? "brak"} | Spółki zależne: ${company.has_subsidiaries ? "tak" : "nie"}`);
  lines.push("");

  if (prices.length > 0) {
    lines.push("--- OSTATNIA CENA ---");
    const p = prices[0];
    const close = p.close != null ? `${p.close.toFixed(2)} PLN` : "—";
    lines.push(`${p.date}  zamknięcie=${close}`);
    lines.push("");
  }

  if (events.length > 0) {
    lines.push("--- OSTATNIE WYDARZENIA KORPORACYJNE (do 10) ---");
    for (const e of events) {
      const date = e.published_at ? e.published_at.slice(0, 10) : "data n/d";
      lines.push(`[${date}] [${e.event_type.toUpperCase()}] impact=${e.impact_score}/10  ${e.title}`);
    }
    lines.push("");
  } else {
    lines.push("--- BRAK ZAPISANYCH WYDARZEŃ KORPORACYJNYCH ---");
    lines.push("");
  }

  return lines.join("\n");
}

// ─── AI callers ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "Jesteś analitykiem giełdowym specjalizującym się w spółkach GPW i USA.",
  "Odpowiadaj po polsku. Bądź konkretny i rzeczowy.",
  "Bazuj tylko na dostarczonych danych.",
  "Jeśli danych brakuje, powiedz o tym wprost.",
].join(" ");

async function callAnthropic(apiKey: string, userMsg: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: "user", content: userMsg }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json() as {
    content: Array<{ type: string; text: string }>;
  };
  return data.content.find(b => b.type === "text")?.text ?? "";
}

async function callOpenAI(apiKey: string, userMsg: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model:      "gpt-4o-mini",
      max_tokens: 1024,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userMsg       },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content ?? "";
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  console.log("[ai-query] Invoked at:", new Date().toISOString());

  // ── CORS preflight ─────────────────────────────────────────────────────────
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

  const corsHeaders = {
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
      { status: 400, headers: corsHeaders },
    );
  }

  const ticker   = (body.ticker   ?? "").toUpperCase().trim();
  const question = (body.question ?? "").trim();

  if (!ticker || !question) {
    return new Response(
      JSON.stringify({ ok: false, error: "ticker and question are required" }),
      { status: 400, headers: corsHeaders },
    );
  }

  console.log(`[ai-query] ticker=${ticker} q="${question.slice(0, 80)}"`);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")              ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // ── Fetch context data in parallel ────────────────────────────────────────
  const [
    { data: companyData, error: compErr },
    { data: eventsData  },
    { data: pricesData  },
  ] = await Promise.all([
    supabase
      .from("companies")
      .select("ticker, name, sector, market, has_subsidiaries")
      .eq("ticker", ticker)
      .maybeSingle(),
    supabase
      .from("company_events")
      .select("title, event_type, impact_score, published_at, source")
      .eq("ticker", ticker)
      .order("published_at", { ascending: false })
      .limit(10),
    supabase
      .from("price_history")
      .select("date, close, volume")
      .eq("ticker", ticker)
      .order("date", { ascending: false })
      .limit(1),
  ]);

  if (compErr) {
    return new Response(
      JSON.stringify({ ok: false, error: compErr.message }),
      { status: 500, headers: corsHeaders },
    );
  }
  if (!companyData) {
    return new Response(
      JSON.stringify({ ok: false, error: `Ticker ${ticker} not found` }),
      { status: 404, headers: corsHeaders },
    );
  }

  const events = (eventsData ?? []) as CompanyEvent[];
  const prices = (pricesData ?? []) as PriceRecord[];
  console.log(`[ai-query] context: events=${events.length} prices=${prices.length}`);

  // ── Build prompt ───────────────────────────────────────────────────────────
  const context   = buildContext(companyData as Company, events, prices);
  const userMsg   = `Dane spółki:\n\n${context}\n\nPytanie: ${question}`;

  // ── Call AI (Anthropic primary → OpenAI fallback) ─────────────────────────
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const openaiKey    = Deno.env.get("OPENAI_API_KEY")    ?? "";

  let answer:     string;
  let modelUsed:  string;

  if (anthropicKey) {
    try {
      console.log("[ai-query] Calling Claude claude-sonnet-4-20250514");
      answer    = await callAnthropic(anthropicKey, userMsg);
      modelUsed = "claude-sonnet-4-20250514";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[ai-query] Anthropic failed, trying OpenAI fallback:", msg);

      if (!openaiKey) {
        return new Response(
          JSON.stringify({ ok: false, error: `Anthropic failed and no OpenAI key: ${msg}` }),
          { status: 502, headers: corsHeaders },
        );
      }
      try {
        answer    = await callOpenAI(openaiKey, userMsg);
        modelUsed = "gpt-4o-mini (fallback)";
      } catch (fallbackErr) {
        const fb = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        return new Response(
          JSON.stringify({ ok: false, error: `Both AI providers failed. Last: ${fb}` }),
          { status: 502, headers: corsHeaders },
        );
      }
    }
  } else if (openaiKey) {
    console.log("[ai-query] No Anthropic key, using OpenAI");
    try {
      answer    = await callOpenAI(openaiKey, userMsg);
      modelUsed = "gpt-4o-mini";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(
        JSON.stringify({ ok: false, error: msg }),
        { status: 502, headers: corsHeaders },
      );
    }
  } else {
    return new Response(
      JSON.stringify({ ok: false, error: "No AI key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY." }),
      { status: 500, headers: corsHeaders },
    );
  }

  console.log(`[ai-query] Done model=${modelUsed} len=${answer.length}`);

  return new Response(
    JSON.stringify({
      ok:         true,
      ticker,
      answer,
      model_used: modelUsed,
      ts:         new Date().toISOString(),
    }),
    { status: 200, headers: corsHeaders },
  );
});
