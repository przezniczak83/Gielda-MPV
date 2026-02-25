// supabase/functions/fetch-ownership/index.ts
// Parses company_events for ESPI ownership notifications (Art. 69),
// uses Claude Haiku to extract structured data, inserts to institutional_ownership.
//
// POST body: {} (scans recent events) | { ticker: string } (single ticker)
//
// ESPI ownership keywords:
//   - "znaczn% akcjonariu%", "przekrocz% próg%"
//   - "nabycie%akcji%", "zbycie%akcji%"
//   - "zawiadomienie%art%69%"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const JSON_HEADERS = { "Content-Type": "application/json", ...CORS };

interface OwnershipExtraction {
  institution_name: string | null;
  ownership_pct:    number | null;
  change_pct:       number | null;
  transaction_type: "buy" | "sell" | null;
}

const OWNERSHIP_KEYWORDS = [
  "znaczn",
  "akcjonariu",
  "przekrocz",
  "próg",
  "nabycie akcji",
  "zbycie akcji",
  "zawiadomienie",
  "art. 69",
  "art.69",
  "art 69",
];

function isOwnershipEvent(title: string): boolean {
  const lower = title.toLowerCase();
  return OWNERSHIP_KEYWORDS.some(k => lower.includes(k));
}

async function extractWithHaiku(
  title:   string,
  apiKey:  string,
): Promise<OwnershipExtraction | null> {
  const prompt = `Przeanalizuj tytuł komunikatu ESPI dotyczącego akcjonariatu i wyciągnij dane.
Zwróć TYLKO JSON (bez markdown):
{
  "institution_name": "nazwa instytucji/funduszu lub null",
  "ownership_pct": udziały po zmianie w % jako liczba lub null,
  "change_pct": zmiana udziałów w punktach procentowych (+ nabycie, - zbycie) lub null,
  "transaction_type": "buy" lub "sell" lub null
}

Tytuł: ${title}`;

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
    if (!res.ok) return null;
    const data = await res.json() as { content?: Array<{ text: string }> };
    const text = data.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as OwnershipExtraction;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  console.log("[fetch-ownership] Invoked at:", new Date().toISOString());

  const supabaseUrl  = Deno.env.get("SUPABASE_URL")              ?? "";
  const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")         ?? "";

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let body: { ticker?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  // Fetch relevant company_events (last 90 days)
  const since = new Date();
  since.setDate(since.getDate() - 90);

  let query = db
    .from("company_events")
    .select("id, ticker, title, published_at")
    .gte("published_at", since.toISOString())
    .order("published_at", { ascending: false })
    .limit(200);

  if (body.ticker) query = query.eq("ticker", body.ticker.toUpperCase().trim());

  const { data: events, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: JSON_HEADERS });
  }

  const ownershipEvents = (events ?? []).filter(e => isOwnershipEvent(e.title));
  console.log(`[fetch-ownership] Found ${ownershipEvents.length} ownership events from ${events?.length ?? 0} total`);

  let inserted = 0;
  const errors: string[] = [];

  for (const ev of ownershipEvents) {
    try {
      let extraction: OwnershipExtraction | null = null;
      if (anthropicKey) {
        extraction = await extractWithHaiku(ev.title, anthropicKey);
      }

      if (!extraction?.institution_name) {
        console.warn(`[fetch-ownership] No institution extracted from: "${ev.title}"`);
        continue;
      }

      const reportDate = ev.published_at
        ? new Date(ev.published_at).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const { error: upsertErr } = await db
        .from("institutional_ownership")
        .upsert({
          ticker:           ev.ticker,
          institution_name: extraction.institution_name,
          ownership_pct:    extraction.ownership_pct,
          change_pct:       extraction.change_pct,
          report_date:      reportDate,
          source:           "espi",
        }, { onConflict: "ticker,institution_name,report_date" });

      if (upsertErr) {
        errors.push(`${ev.ticker}: ${upsertErr.message}`);
      } else {
        inserted++;
        console.log(`[fetch-ownership] ${ev.ticker}: ${extraction.institution_name} ${extraction.ownership_pct}%`);
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return new Response(JSON.stringify({
    ok:       true,
    scanned:  events?.length ?? 0,
    matched:  ownershipEvents.length,
    inserted,
    errors:   errors.length > 0 ? errors : undefined,
  }), { status: 200, headers: JSON_HEADERS });
});
