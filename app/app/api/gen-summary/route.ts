// GET /api/gen-summary?ticker=PKN
// Returns AI-generated company summary from company_sentiment.
// If missing or >6h old, triggers analyze-sentiment Edge Function.

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.toUpperCase().trim();
  if (!ticker) {
    return Response.json({ ok: false, error: "ticker required" }, { status: 400 });
  }

  const db = supabase();

  // Check cached sentiment
  const { data: cached } = await db
    .from("company_sentiment")
    .select("ticker, score, label, summary, analyzed_at")
    .eq("ticker", ticker)
    .maybeSingle();

  const ageHours = cached?.analyzed_at
    ? (Date.now() - new Date(cached.analyzed_at).getTime()) / 3600_000
    : Infinity;

  // Fresh if < 6h old
  if (cached?.summary && ageHours < 6) {
    return Response.json({
      ok:          true,
      source:      "cached",
      summary:     cached.summary,
      score:       cached.score,
      label:       cached.label,
      analyzed_at: cached.analyzed_at,
    });
  }

  // Trigger regeneration (non-blocking — just fire and forget, return stale if available)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  fetch(`${supabaseUrl}/functions/v1/analyze-sentiment`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ ticker }),
  }).catch(() => {});

  // Return stale data while revalidating
  if (cached?.summary) {
    return Response.json({
      ok:          true,
      source:      "stale",
      summary:     cached.summary,
      score:       cached.score,
      label:       cached.label,
      analyzed_at: cached.analyzed_at,
    });
  }

  return Response.json({
    ok:      false,
    source:  "none",
    summary: null,
  });
}
