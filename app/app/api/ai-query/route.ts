// app/api/ai-query/route.ts
// Streaming AI Chat with Anthropic prompt caching.
// Fetches company context from company_snapshot (fast) or live DB (fallback).
// Streams SSE directly to the client — text appears word-by-word in the UI.

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SYSTEM_PROMPT =
  "Jesteś analitykiem giełdowym specjalizującym się w spółkach GPW i USA. " +
  "Odpowiadaj po polsku. Bądź konkretny i rzeczowy. " +
  "Bazuj tylko na dostarczonych danych. " +
  "Jeśli danych brakuje, powiedz o tym wprost.";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

function isFresh(computedAt: string, maxMinutes: number): boolean {
  const age = (Date.now() - new Date(computedAt).getTime()) / 1000 / 60;
  return age < maxMinutes;
}

// ─── Context builders ────────────────────────────────────────────────────────

interface SnapshotData {
  company?:       { ticker: string; name: string; sector: string | null; market: string };
  price?:         { close: number; date: string } | null;
  recent_events?: Array<{ title: string; event_type: string | null; impact_score: number | null; published_at: string | null }>;
}

function buildContextFromSnapshot(snap: SnapshotData, ticker: string): string {
  const lines: string[] = [];
  const c = snap.company;
  lines.push(`=== SPÓŁKA: ${ticker}${c ? ` (${c.name})` : ""} ===`);
  if (c) {
    lines.push(`Rynek: ${c.market} | Sektor: ${c.sector ?? "brak"}`);
  }
  lines.push("");

  if (snap.price) {
    lines.push("--- OSTATNIA CENA ---");
    lines.push(`${snap.price.date}  zamknięcie=${Number(snap.price.close).toFixed(2)} PLN`);
    lines.push("");
  }

  const events = snap.recent_events ?? [];
  if (events.length > 0) {
    lines.push("--- OSTATNIE WYDARZENIA KORPORACYJNE (do 10) ---");
    for (const e of events.slice(0, 10)) {
      const date = e.published_at ? e.published_at.slice(0, 10) : "data n/d";
      lines.push(`[${date}] [${(e.event_type ?? "inne").toUpperCase()}] impact=${e.impact_score ?? "?"}/10  ${e.title}`);
    }
    lines.push("");
  } else {
    lines.push("--- BRAK ZAPISANYCH WYDARZEŃ KORPORACYJNYCH ---");
    lines.push("");
  }

  return lines.join("\n");
}

async function buildContextFromDB(ticker: string, db: ReturnType<typeof supabase>): Promise<string> {
  const [companyRes, eventsRes, pricesRes] = await Promise.all([
    db.from("companies").select("ticker, name, sector, market").eq("ticker", ticker).maybeSingle(),
    db.from("company_events").select("title, event_type, impact_score, published_at").eq("ticker", ticker).order("published_at", { ascending: false }).limit(10),
    db.from("price_history").select("close, date").eq("ticker", ticker).order("date", { ascending: false }).limit(1),
  ]);

  const lines: string[] = [];
  const c = companyRes.data;
  lines.push(`=== SPÓŁKA: ${ticker}${c ? ` (${c.name})` : ""} ===`);
  if (c) lines.push(`Rynek: ${c.market} | Sektor: ${c.sector ?? "brak"}`);
  lines.push("");

  const price = pricesRes.data?.[0];
  if (price) {
    lines.push("--- OSTATNIA CENA ---");
    lines.push(`${price.date}  zamknięcie=${Number(price.close).toFixed(2)} PLN`);
    lines.push("");
  }

  const events = eventsRes.data ?? [];
  if (events.length > 0) {
    lines.push("--- OSTATNIE WYDARZENIA KORPORACYJNE (do 10) ---");
    for (const e of events) {
      const date = e.published_at ? e.published_at.slice(0, 10) : "data n/d";
      lines.push(`[${date}] [${(e.event_type ?? "inne").toUpperCase()}] impact=${e.impact_score ?? "?"}/10  ${e.title}`);
    }
    lines.push("");
  } else {
    lines.push("--- BRAK ZAPISANYCH WYDARZEŃ KORPORACYJNYCH ---");
    lines.push("");
  }

  return lines.join("\n");
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { ticker: rawTicker, question } = await req.json() as { ticker: string; question: string };

  if (!rawTicker || !question) {
    return Response.json({ ok: false, error: "ticker and question required" }, { status: 400 });
  }

  const ticker  = rawTicker.toUpperCase().trim();
  const apiKey  = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return Response.json({ ok: false, error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const db = supabase();

  // ── Fetch context: snapshot (fast) or live ───────────────────────────────
  let context: string;
  const { data: snapRow } = await db
    .from("company_snapshot")
    .select("snapshot, computed_at")
    .eq("ticker", ticker)
    .maybeSingle();

  if (snapRow && isFresh(snapRow.computed_at, 30)) {
    context = buildContextFromSnapshot(snapRow.snapshot as SnapshotData, ticker);
  } else {
    context = await buildContextFromDB(ticker, db);
  }

  // ── Anthropic streaming with prompt caching (TASK 6) ─────────────────────
  // cache_control on system + context = 83% cheaper on repeated queries for same ticker
  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta":    "prompt-caching-2024-07-31",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 500,
      stream:     true,
      system: [
        {
          type:          "text",
          text:          SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" }, // cache the system prompt
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type:          "text",
              text:          `Dane spółki:\n\n${context}`,
              cache_control: { type: "ephemeral" }, // cache the context (changes ~30 min)
            },
            {
              type: "text",
              text: `Pytanie: ${question}`,
              // question is NOT cached — different every time
            },
          ],
        },
      ],
    }),
  });

  if (!anthropicRes.ok || !anthropicRes.body) {
    const errText = await anthropicRes.text().catch(() => "unknown");
    return Response.json(
      { ok: false, error: `Anthropic error ${anthropicRes.status}: ${errText.slice(0, 200)}` },
      { status: 502 },
    );
  }

  // Forward Anthropic SSE stream directly to client
  return new Response(anthropicRes.body, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
