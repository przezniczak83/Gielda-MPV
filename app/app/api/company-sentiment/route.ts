// app/api/company-sentiment/route.ts
// GET  ?ticker=PKN  — returns latest sentiment record
// POST { ticker }   — triggers analyze-sentiment EF and returns result

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

  const { data, error } = await supabase()
    .from("company_sentiment")
    .select("ticker, score, label, summary, analyzed_at")
    .eq("ticker", ticker)
    .maybeSingle();

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true, sentiment: data });
}

export async function POST(req: NextRequest) {
  const { ticker: raw } = await req.json() as { ticker: string };
  const ticker = (raw ?? "").toUpperCase().trim();
  if (!ticker) {
    return Response.json({ ok: false, error: "ticker required" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  const res = await fetch(`${supabaseUrl}/functions/v1/analyze-sentiment`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ ticker }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown");
    return Response.json({ ok: false, error: `EF error ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });
  }

  const data = await res.json();
  return Response.json(data);
}
