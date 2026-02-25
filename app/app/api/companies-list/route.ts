import { NextResponse }  from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL  ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );

  const { data, error } = await supabase
    .from("companies")
    .select("ticker, name")
    .order("ticker");

  if (error) {
    return NextResponse.json([], { status: 500 });
  }

  return NextResponse.json(data ?? [], {
    headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate" },
  });
}
