import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL    ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY   ?? "";
  const supabaseRef    = supabaseUrl.match(/https:\/\/([^.]+)/)?.[1] ?? "";

  if (!supabaseUrl || !serviceRoleKey || !supabaseRef) {
    return NextResponse.json({ ok: false, error: "Missing env vars" }, { status: 500 });
  }

  let body: { ticker?: string };
  try { body = await request.json(); } catch { body = {}; }

  const ticker = body.ticker?.toUpperCase().trim();
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "ticker required" }, { status: 400 });
  }

  const efUrl = `https://${supabaseRef}.supabase.co/functions/v1/gen-forecast`;

  try {
    const efRes = await fetch(efUrl, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ ticker }),
    });

    const result = await efRes.json() as Record<string, unknown>;
    if (!efRes.ok || !result.ok) {
      return NextResponse.json({ ok: false, error: result.error ?? `EF returned ${efRes.status}` }, { status: efRes.status });
    }

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
