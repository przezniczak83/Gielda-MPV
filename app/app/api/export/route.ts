// app/api/export/route.ts
// CSV export endpoint.
//
// GET /api/export?type=events&ticker=PKN
// GET /api/export?type=prices&ticker=PKN
// GET /api/export?type=financials&ticker=PKN
// GET /api/export?type=watchlist&id=<watchlist_id>

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

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function escape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines   = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map(h => escape(row[h])).join(","));
  }
  return lines.join("\r\n");
}

function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control":       "no-store",
    },
  });
}

// ─── Export handlers ──────────────────────────────────────────────────────────

async function exportEvents(ticker: string): Promise<Response> {
  const db = supabase();
  const { data, error } = await db
    .from("company_events")
    .select("published_at, event_type, title, impact_score, source, url")
    .eq("ticker", ticker)
    .order("published_at", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map(r => ({
    data:        r.published_at ? r.published_at.slice(0, 10) : "",
    typ:         r.event_type ?? "",
    tytul:       r.title,
    impact:      r.impact_score ?? "",
    zrodlo:      r.source ?? "",
    url:         r.url ?? "",
  }));

  return csvResponse(toCSV(rows), `${ticker}_events.csv`);
}

async function exportPrices(ticker: string): Promise<Response> {
  const db = supabase();
  const { data, error } = await db
    .from("price_history")
    .select("date, open, high, low, close, volume")
    .eq("ticker", ticker)
    .order("date", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return csvResponse(toCSV(data ?? []), `${ticker}_prices.csv`);
}

async function exportFinancials(ticker: string): Promise<Response> {
  const db = supabase();
  const { data, error } = await db
    .from("company_financials")
    .select("period, revenue, net_income, ebitda, eps, net_debt, currency")
    .eq("ticker", ticker)
    .order("period", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });

  return csvResponse(toCSV(data ?? []), `${ticker}_financials.csv`);
}

async function exportWatchlist(watchlistId: string): Promise<Response> {
  const db = supabase();
  const [wlRes, itemsRes] = await Promise.all([
    db.from("watchlists").select("name").eq("id", watchlistId).maybeSingle(),
    db.from("watchlist_items")
      .select("ticker, added_at, companies(name, sector, market)")
      .eq("watchlist_id", watchlistId)
      .order("added_at", { ascending: false }),
  ]);

  if (itemsRes.error) return Response.json({ error: itemsRes.error.message }, { status: 500 });

  const wlName = (wlRes.data?.name ?? "watchlist").replace(/[^a-zA-Z0-9_-]/g, "_");
  const rows   = (itemsRes.data ?? []).map(item => {
    const c = (item.companies as unknown as { name: string; sector: string | null; market: string }) ?? null;
    return {
      ticker:   item.ticker,
      nazwa:    c?.name ?? "",
      sektor:   c?.sector ?? "",
      rynek:    c?.market ?? "",
      dodano:   item.added_at ? item.added_at.slice(0, 10) : "",
    };
  });

  return csvResponse(toCSV(rows), `${wlName}.csv`);
}

// ─── GET handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const type   = searchParams.get("type") ?? "";
  const ticker = searchParams.get("ticker")?.toUpperCase().trim() ?? "";
  const id     = searchParams.get("id") ?? "";

  switch (type) {
    case "events":
      if (!ticker) return Response.json({ error: "ticker required" }, { status: 400 });
      return exportEvents(ticker);

    case "prices":
      if (!ticker) return Response.json({ error: "ticker required" }, { status: 400 });
      return exportPrices(ticker);

    case "financials":
      if (!ticker) return Response.json({ error: "ticker required" }, { status: 400 });
      return exportFinancials(ticker);

    case "watchlist":
      if (!id) return Response.json({ error: "id required" }, { status: 400 });
      return exportWatchlist(id);

    default:
      return Response.json(
        { error: "type must be: events | prices | financials | watchlist" },
        { status: 400 },
      );
  }
}
