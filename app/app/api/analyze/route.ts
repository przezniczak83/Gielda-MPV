import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const TECH_SECTORS = new Set([
  "Technology", "Gaming", "E-commerce", "Fintech",
  "SaaS", "Streaming", "Data/Cloud", "AI/Defense",
  "Semiconductors", "Enterprise", "Tech",
]);

export async function POST(request: Request) {
  let body: { ticker?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const ticker = body.ticker?.toUpperCase()?.trim();
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "ticker required" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "";
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const supabaseRef = supabaseUrl.match(/https:\/\/([^.]+)/)?.[1] ?? "";

  if (!supabaseRef || !serviceKey) {
    return NextResponse.json({ ok: false, error: "Missing Supabase env vars" }, { status: 500 });
  }

  // Check sector to decide if MOAT should run
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: company } = await db
    .from("companies")
    .select("sector")
    .eq("ticker", ticker)
    .maybeSingle();

  const isTech = TECH_SECTORS.has(company?.sector ?? "");

  const efBase = `https://${supabaseRef}.supabase.co/functions/v1`;
  const headers = {
    "Content-Type":  "application/json",
    "Authorization": `Bearer ${serviceKey}`,
  };

  // Call all analyzers in parallel (moat only for tech companies)
  const promises: Promise<unknown>[] = [
    fetch(`${efBase}/analyze-health`, {
      method: "POST", headers, body: JSON.stringify({ ticker }),
    }).then(r => r.json()),

    fetch(`${efBase}/detect-flags`, {
      method: "POST", headers, body: JSON.stringify({ ticker }),
    }).then(r => r.json()),

    fetch(`${efBase}/analyze-dividend`, {
      method: "POST", headers, body: JSON.stringify({ ticker }),
    }).then(r => r.json()),

    fetch(`${efBase}/analyze-earnings`, {
      method: "POST", headers, body: JSON.stringify({ ticker }),
    }).then(r => r.json()),
  ];

  if (isTech) {
    promises.push(
      fetch(`${efBase}/analyze-moat`, {
        method: "POST", headers, body: JSON.stringify({ ticker }),
      }).then(r => r.json()),
    );
  }

  const results = await Promise.allSettled(promises);

  const health   = results[0].status === "fulfilled" ? results[0].value : { ok: false };
  const flags    = results[1].status === "fulfilled" ? results[1].value : { ok: false };
  const dividend = results[2].status === "fulfilled" ? results[2].value : { ok: false };
  const earnings = results[3].status === "fulfilled" ? results[3].value : { ok: false };
  const moat     = isTech && results[4]?.status === "fulfilled" ? results[4].value : null;

  return NextResponse.json({
    ok:               true,
    ticker,
    health_score:     health,
    red_flags:        flags,
    dividend:         dividend,
    earnings_quality: earnings,
    moat:             moat,
    ts:               new Date().toISOString(),
  });
}
