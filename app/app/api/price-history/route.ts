import { NextResponse }  from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker")?.toUpperCase();

  if (!ticker) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL    ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY   ?? "",
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase
    .from("price_history")
    .select("date, close, volume")
    .eq("ticker", ticker)
    .order("date", { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Return sorted ascending (oldest first) for chart rendering
  const sorted = (data ?? []).reverse();
  return NextResponse.json(sorted, { headers: { "Cache-Control": "no-store" } });
}
