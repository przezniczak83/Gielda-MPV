// app/api/macro-interpretation/route.ts
// Streams Claude Haiku interpretation of macro indicators.

import { NextRequest } from "next/server";

export const runtime = "nodejs";

const SYSTEM_PROMPT =
  "Jesteś analitykiem makroekonomicznym specjalizującym się w polskiej giełdzie GPW. " +
  "Odpowiadaj po polsku. Bądź konkretny i zwięzły (max 3 zdania). " +
  "Opisz wpływ podanych kursów walut na spółki GPW — eksporterów, importerów, sektor bankowy.";

interface MacroRow {
  name:       string;
  value:      number;
  prev_value: number | null;
  change_pct: number | null;
  period:     string | null;
}

export async function POST(req: NextRequest) {
  const { indicators } = await req.json() as { indicators: MacroRow[] };

  if (!indicators || indicators.length === 0) {
    return Response.json({ ok: false, error: "No indicators provided" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ ok: false, error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const context = indicators
    .map(ind => {
      const change = ind.change_pct != null ? ` (zmiana: ${ind.change_pct > 0 ? "+" : ""}${ind.change_pct.toFixed(3)}%)` : "";
      return `${ind.name}: ${Number(ind.value).toFixed(4)}${change}`;
    })
    .join("\n");

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 300,
      stream:     true,
      system:     SYSTEM_PROMPT,
      messages: [
        {
          role:    "user",
          content: `Aktualne kursy walut (NBP):\n${context}\n\nJaki jest wpływ tych kursów na GPW?`,
        },
      ],
    }),
  });

  if (!anthropicRes.ok || !anthropicRes.body) {
    const errText = await anthropicRes.text().catch(() => "unknown");
    return Response.json(
      { ok: false, error: `Anthropic ${anthropicRes.status}: ${errText.slice(0, 200)}` },
      { status: 502 },
    );
  }

  return new Response(anthropicRes.body, {
    headers: {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
