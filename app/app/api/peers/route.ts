import { NextRequest, NextResponse } from "next/server";
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
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }

  const db = supabase();

  // Find peer group for this ticker
  const { data: membership } = await db
    .from("peer_group_members")
    .select("peer_group_id, peer_groups(name, sector)")
    .eq("ticker", ticker)
    .limit(1)
    .single();

  if (!membership) {
    return NextResponse.json({ group: null, members: [] });
  }

  const groupId   = membership.peer_group_id;
  const groupName = (membership.peer_groups as { name?: string; sector?: string } | null)?.name ?? null;
  const groupSector = (membership.peer_groups as { name?: string; sector?: string } | null)?.sector ?? null;

  // Get all members
  const { data: memberRows, error } = await db
    .from("peer_group_members")
    .select("ticker, is_primary")
    .eq("peer_group_id", groupId);

  if (error || !memberRows) {
    return NextResponse.json({ error: error?.message ?? "No members" }, { status: 500 });
  }

  const tickers = memberRows.map(m => m.ticker);

  // Fetch all data in parallel
  const [compRes, priceRes, multiplesRes, kpisRes] = await Promise.all([
    db.from("companies").select("ticker, name, sector").in("ticker", tickers),
    db.from("price_history").select("ticker, close").in("ticker", tickers).order("date", { ascending: false }),
    db.from("valuation_multiples").select("ticker, pe_ratio, ev_ebitda, market_cap").in("ticker", tickers),
    db.from("company_kpis").select("ticker, value").in("ticker", tickers).eq("kpi_type", "health_score"),
  ]);

  // Build lookup maps — deduplicate price_history (take first = latest per ticker)
  const compMap      = new Map((compRes.data ?? []).map(c => [c.ticker, c]));
  const priceMap     = new Map<string, number>();
  for (const r of (priceRes.data ?? [])) {
    if (!priceMap.has(r.ticker)) priceMap.set(r.ticker, Number(r.close));
  }
  const multMap  = new Map((multiplesRes.data ?? []).map(m => [m.ticker, m]));
  const kpiMap   = new Map((kpisRes.data ?? []).map(k => [k.ticker, k.value]));

  const members = tickers.map(t => {
    const comp    = compMap.get(t);
    const mult    = multMap.get(t);
    return {
      ticker:       t,
      name:         comp?.name ?? null,
      sector:       comp?.sector ?? null,
      price:        priceMap.get(t) ?? null,
      pe_ratio:     mult?.pe_ratio != null ? Number(mult.pe_ratio) : null,
      ev_ebitda:    mult?.ev_ebitda != null ? Number(mult.ev_ebitda) : null,
      market_cap:   mult?.market_cap != null ? Number(mult.market_cap) : null,
      health_score: kpiMap.get(t) ?? null,
      is_primary:   memberRows.find(m => m.ticker === t)?.is_primary ?? false,
    };
  });

  return NextResponse.json({
    group:   { id: groupId, name: groupName, sector: groupSector },
    members,
  });
}
