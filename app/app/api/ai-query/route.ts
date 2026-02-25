import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { ticker, question } = await req.json() as { ticker: string; question: string };

  if (!ticker || !question) {
    return NextResponse.json({ ok: false, error: "ticker and question required" }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const res = await fetch(`${supabaseUrl}/functions/v1/ai-query`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ ticker, question }),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.ok ? 200 : res.status });
}
