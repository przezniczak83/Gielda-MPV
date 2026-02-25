// supabase/functions/process-raw/index.ts
// raw_ingest → company_events pipeline.
//
// Dla każdego rekordu raw_ingest gdzie processed_at IS NULL:
//   1. Ticker w companies?               NIE → skip (mark processed)
//   2. SHA-256 hash duplicate?           TAK → skip (mark processed)
//   2b. pg_trgm fuzzy title duplicate?   TAK → skip (mark processed)
//   3. Detect event_type + impact_score from title
//   4. INSERT company_events
//   5. UPDATE raw_ingest SET processed_at = now()
//
// Wymaga migracji 0007_pgtrgm.sql (pg_trgm + find_fuzzy_duplicate function).
// Deploy: supabase functions deploy process-raw --project-ref pftgmorsthoezhmojjpg

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawRecord {
  id:           string;
  source:       string;
  payload:      Record<string, string | null>;
  fetched_at:   string;
}

interface CompanyEventInsert {
  ticker:        string;
  title:         string;
  url:           string | null;
  published_at:  string | null;
  event_type:    string;
  impact_score:  number;
  source:        string;
  raw_id:        string;
  content_hash:  string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** SHA-256 hex digest via Web Crypto API (available in Deno). */
async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

interface EventClassification {
  event_type:   string;
  impact_score: number;
}

/**
 * Detect event type and impact score from title.
 * Keywords are checked case-insensitively.
 */
function classifyTitle(title: string): EventClassification {
  const t = title.toLowerCase();

  if (/wyniki|raport|earnings|q[1-4]|roczn|kwartaln/.test(t)) {
    return { event_type: "earnings", impact_score: 8 };
  }
  if (/dywidend|dividend/.test(t)) {
    return { event_type: "dividend", impact_score: 7 };
  }
  if (/regulat|knf|uokik|nadzór|sankcj|kara/.test(t)) {
    return { event_type: "regulatory", impact_score: 6 };
  }
  return { event_type: "other", impact_score: 4 };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_BATCH = 50;

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  console.log("[process-raw] Invoked at:", new Date().toISOString());

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")              ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // ── Fetch unprocessed records ──────────────────────────────────────────────
  const { data: rawRecords, error: fetchErr } = await supabase
    .from("raw_ingest")
    .select("id, source, payload, fetched_at")
    .is("processed_at", null)
    .order("fetched_at", { ascending: true })
    .limit(MAX_BATCH);

  if (fetchErr) {
    console.error("[process-raw] Fetch error:", fetchErr.message);
    return new Response(
      JSON.stringify({ ok: false, error: fetchErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const records = (rawRecords ?? []) as RawRecord[];
  console.log(`[process-raw] Found ${records.length} unprocessed record(s)`);

  if (records.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, processed: 0, skipped: 0, ts: new Date().toISOString() }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // ── Load valid tickers from companies ─────────────────────────────────────
  const { data: companies, error: compErr } = await supabase
    .from("companies")
    .select("ticker");

  if (compErr) {
    console.error("[process-raw] Companies fetch error:", compErr.message);
    return new Response(
      JSON.stringify({ ok: false, error: compErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const validTickers = new Set((companies ?? []).map((c: { ticker: string }) => c.ticker.toUpperCase()));
  console.log(`[process-raw] Loaded ${validTickers.size} valid tickers`);

  // ── Process each record ───────────────────────────────────────────────────
  let processed = 0;
  let skipped   = 0;

  for (const rec of records) {
    try {
      const payload      = rec.payload;
      const ticker       = (payload["ticker"] ?? "").toUpperCase();
      const title        = payload["title"]        ?? "";
      const url          = payload["url"]          ?? null;
      const published_at = payload["published_at"] ?? null;

      // Step 1: ticker validation
      if (!ticker || !validTickers.has(ticker)) {
        console.log(`[process-raw] id=${rec.id} ticker="${ticker}" not in companies → skip`);
        await supabase.from("raw_ingest").update({ processed_at: new Date().toISOString() }).eq("id", rec.id);
        skipped++;
        continue;
      }

      // Step 2: duplicate check via SHA-256 hash
      const hashInput  = `${ticker}|${title}|${published_at ?? ""}`;
      const contentHash = await sha256(hashInput);

      const { data: existing } = await supabase
        .from("company_events")
        .select("id")
        .eq("content_hash", contentHash)
        .maybeSingle();

      if (existing) {
        console.log(`[process-raw] id=${rec.id} hash duplicate → skip`);
        await supabase.from("raw_ingest").update({ processed_at: new Date().toISOString() }).eq("id", rec.id);
        skipped++;
        continue;
      }

      // Step 2b: Level 2 — fuzzy title similarity via pg_trgm
      // Checks same ticker + same date + similarity(title, new_title) > 0.8
      if (published_at) {
        const { data: isFuzzyDup, error: fuzzyErr } = await supabase.rpc(
          "find_fuzzy_duplicate",
          {
            p_ticker:         ticker,
            p_published_date: published_at.slice(0, 10),
            p_title:          title,
          },
        );

        if (fuzzyErr) {
          // pg_trgm not available — log and continue without fuzzy check
          console.warn(`[process-raw] id=${rec.id} fuzzy check error (skipping): ${fuzzyErr.message}`);
        } else if (isFuzzyDup) {
          console.log(`[process-raw] id=${rec.id} fuzzy title duplicate (similarity>0.8) → skip`);
          await supabase.from("raw_ingest").update({ processed_at: new Date().toISOString() }).eq("id", rec.id);
          skipped++;
          continue;
        }
      }

      // Step 3: classify
      const { event_type, impact_score } = classifyTitle(title);
      console.log(`[process-raw] id=${rec.id} ticker=${ticker} event_type=${event_type} score=${impact_score}`);

      // Step 4: insert to company_events
      const eventRow: CompanyEventInsert = {
        ticker,
        title,
        url,
        published_at,
        event_type,
        impact_score,
        source:       rec.source,
        raw_id:       rec.id,
        content_hash: contentHash,
      };

      const { error: insertErr } = await supabase
        .from("company_events")
        .insert(eventRow);

      if (insertErr) {
        // Unique constraint violation on content_hash or url → treat as duplicate
        if (insertErr.code === "23505") {
          console.log(`[process-raw] id=${rec.id} insert conflict (duplicate) → skip`);
          await supabase.from("raw_ingest").update({ processed_at: new Date().toISOString() }).eq("id", rec.id);
          skipped++;
          continue;
        }
        console.error(`[process-raw] id=${rec.id} insert error:`, insertErr.message);
        // Don't mark processed — will retry next run
        continue;
      }

      // Step 5: mark raw_ingest as processed
      await supabase
        .from("raw_ingest")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", rec.id);

      processed++;
      console.log(`[process-raw] id=${rec.id} → company_events ✓`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[process-raw] id=${rec.id} unexpected error:`, msg);
      // Don't mark processed — will retry next run
    }
  }

  console.log(`[process-raw] Done: processed=${processed} skipped=${skipped}`);

  return new Response(
    JSON.stringify({
      ok:        true,
      processed,
      skipped,
      ts:        new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
