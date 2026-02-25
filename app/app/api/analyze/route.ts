import { NextResponse } from "next/server";

export const runtime = "nodejs";

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

  const supabaseRef = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(/https:\/\/([^.]+)/)?.[1] ?? "";
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseRef || !serviceKey) {
    return NextResponse.json({ ok: false, error: "Missing Supabase env vars" }, { status: 500 });
  }

  const efBase = `https://${supabaseRef}.supabase.co/functions/v1`;
  const headers = {
    "Content-Type":  "application/json",
    "Authorization": `Bearer ${serviceKey}`,
  };

  // Call all analyzers in parallel
  const [healthRes, flagsRes, dividendRes, earningsRes] = await Promise.allSettled([
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
  ]);

  const health   = healthRes.status   === "fulfilled" ? healthRes.value   : { ok: false };
  const flags    = flagsRes.status    === "fulfilled" ? flagsRes.value    : { ok: false };
  const dividend = dividendRes.status === "fulfilled" ? dividendRes.value : { ok: false };
  const earnings = earningsRes.status === "fulfilled" ? earningsRes.value : { ok: false };

  return NextResponse.json({
    ok:               true,
    ticker,
    health_score:     health,
    red_flags:        flags,
    dividend:         dividend,
    earnings_quality: earnings,
    ts:               new Date().toISOString(),
  });
}
