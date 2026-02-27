// app/api/screener/route.ts
// Company screener — dynamic filters on company_snapshot JSONB + companies RS data.
//
// POST body:
// {
//   market?:        "GPW" | "USA" | "ALL"
//   sector?:        string          (partial match)
//   health_min?:    number          (0–10)
//   health_max?:    number          (0–10)
//   price_min?:     number
//   price_max?:     number
//   change_min?:    number          (%)
//   change_max?:    number          (%)
//   rs_min?:        number          (RS score, 100 = parity with WIG20)
//   rs_trend?:      "up" | "down" | "flat"
//   sort_by?:       "health" | "price" | "change" | "ticker" | "rs"
//   sort_dir?:      "asc" | "desc"
//   limit?:         number          (max 100)
// }

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

interface ScreenerRequest {
  market?:     string;
  sector?:     string;
  health_min?: number;
  health_max?: number;
  price_min?:  number;
  price_max?:  number;
  change_min?: number;
  change_max?: number;
  rs_min?:     number;
  rs_trend?:   "up" | "down" | "flat";
  sort_by?:    "health" | "price" | "change" | "ticker" | "rs";
  sort_dir?:   "asc" | "desc";
  limit?:      number;
}

interface SnapshotRow {
  ticker:     string;
  snapshot:   {
    company?:         { name: string; sector: string | null; market: string };
    price?:           { close: number; date: string; change_pct?: number | null } | null;
    health_score?:    number | null;
    moat_score?:      number | null;
  };
  computed_at: string;
}

interface RsRow {
  ticker:   string;
  rs_score: number | null;
  rs_trend: string | null;
}

interface ScreenerResult {
  ticker:      string;
  name:        string;
  sector:      string | null;
  market:      string;
  price:       number | null;
  change_pct:  number | null;
  health:      number | null;
  rs_score:    number | null;
  rs_trend:    string | null;
  computed_at: string;
}

export async function POST(req: NextRequest) {
  const body = await req.json() as ScreenerRequest;

  const {
    market     = "ALL",
    sector,
    health_min,
    health_max,
    price_min,
    price_max,
    change_min,
    change_max,
    rs_min,
    rs_trend,
    sort_by    = "ticker",
    sort_dir   = "asc",
    limit      = 50,
  } = body;

  const db = supabase();

  // Fetch snapshots + RS data in parallel
  const [snapshotRes, rsRes] = await Promise.all([
    db.from("company_snapshot")
      .select("ticker, snapshot, computed_at")
      .order("ticker", { ascending: true })
      .limit(500),
    db.from("companies")
      .select("ticker, rs_score, rs_trend")
      .not("rs_score", "is", null),
  ]);

  if (snapshotRes.error) {
    return Response.json({ ok: false, error: snapshotRes.error.message }, { status: 500 });
  }

  // Build RS lookup map
  const rsMap = new Map<string, RsRow>();
  for (const r of (rsRes.data ?? []) as RsRow[]) {
    rsMap.set(r.ticker, r);
  }

  let rows = (snapshotRes.data ?? []) as SnapshotRow[];

  // ── Client-side filters ──────────────────────────────────────────────────
  if (market !== "ALL") {
    rows = rows.filter(r => r.snapshot.company?.market === market);
  }

  if (sector) {
    const s = sector.toLowerCase();
    rows = rows.filter(r =>
      r.snapshot.company?.sector?.toLowerCase().includes(s)
    );
  }

  if (health_min !== undefined) {
    rows = rows.filter(r => {
      const h = r.snapshot.health_score ?? null;
      return h !== null && h >= health_min;
    });
  }
  if (health_max !== undefined) {
    rows = rows.filter(r => {
      const h = r.snapshot.health_score ?? null;
      return h !== null && h <= health_max;
    });
  }

  if (price_min !== undefined) {
    rows = rows.filter(r => {
      const p = r.snapshot.price?.close ?? null;
      return p !== null && p >= price_min;
    });
  }
  if (price_max !== undefined) {
    rows = rows.filter(r => {
      const p = r.snapshot.price?.close ?? null;
      return p !== null && p <= price_max;
    });
  }

  if (change_min !== undefined) {
    rows = rows.filter(r => {
      const c = r.snapshot.price?.change_pct ?? null;
      return c !== null && c >= change_min;
    });
  }
  if (change_max !== undefined) {
    rows = rows.filter(r => {
      const c = r.snapshot.price?.change_pct ?? null;
      return c !== null && c <= change_max;
    });
  }

  if (rs_min !== undefined) {
    rows = rows.filter(r => {
      const rs = rsMap.get(r.ticker)?.rs_score ?? null;
      return rs !== null && rs >= rs_min;
    });
  }

  if (rs_trend) {
    rows = rows.filter(r => rsMap.get(r.ticker)?.rs_trend === rs_trend);
  }

  // ── Map to result shape ───────────────────────────────────────────────────
  let results: ScreenerResult[] = rows.map(r => ({
    ticker:      r.ticker,
    name:        r.snapshot.company?.name ?? r.ticker,
    sector:      r.snapshot.company?.sector ?? null,
    market:      r.snapshot.company?.market ?? "GPW",
    price:       r.snapshot.price?.close ?? null,
    change_pct:  r.snapshot.price?.change_pct ?? null,
    health:      r.snapshot.health_score ?? null,
    rs_score:    rsMap.get(r.ticker)?.rs_score ?? null,
    rs_trend:    rsMap.get(r.ticker)?.rs_trend ?? null,
    computed_at: r.computed_at,
  }));

  // ── Sort ──────────────────────────────────────────────────────────────────
  const dir = sort_dir === "desc" ? -1 : 1;
  results.sort((a, b) => {
    switch (sort_by) {
      case "health": {
        const ah = a.health ?? -Infinity;
        const bh = b.health ?? -Infinity;
        return dir * (ah - bh);
      }
      case "price": {
        const ap = a.price ?? -Infinity;
        const bp = b.price ?? -Infinity;
        return dir * (ap - bp);
      }
      case "change": {
        const ac = a.change_pct ?? -Infinity;
        const bc = b.change_pct ?? -Infinity;
        return dir * (ac - bc);
      }
      case "rs": {
        const ar = a.rs_score ?? -Infinity;
        const br = b.rs_score ?? -Infinity;
        return dir * (ar - br);
      }
      default:
        return dir * a.ticker.localeCompare(b.ticker);
    }
  });

  // ── Limit ─────────────────────────────────────────────────────────────────
  results = results.slice(0, Math.min(limit, 100));

  return Response.json({ ok: true, count: results.length, results });
}
