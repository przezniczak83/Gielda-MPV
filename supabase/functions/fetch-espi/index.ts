// supabase/functions/fetch-espi/index.ts
// MVP stub: symuluje fetch ESPI i zapisuje do raw_ingest.
// Docelowo: zastąp STUB_RECORDS prawdziwym fetchem z espi.gov.pl lub emailem.
//
// Deploy: supabase functions deploy fetch-espi --project-ref <ref>
// Invoke:  supabase functions invoke fetch-espi --project-ref <ref>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EspiRecord {
  ticker:       string;
  title:        string;
  url:          string | null;
  published_at: string | null;
}

// ─── MVP stub data ────────────────────────────────────────────────────────────
// Zastąp prawdziwym HTTP fetch gdy gotowy scraper/email parser.

const STUB_RECORDS: EspiRecord[] = [
  {
    ticker:       "PKN",
    title:        "ESPI stub: Wyniki Q4 2025 — test rekord",
    url:          null,
    published_at: new Date().toISOString(),
  },
  {
    ticker:       "CDR",
    title:        "ESPI stub: Umowa z dystrybutorem — test rekord",
    url:          null,
    published_at: new Date().toISOString(),
  },
];

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  // MVP: Simplified auth - rely on service_role JWT from cron call
  // Security sufficient for internal Edge Function (not publicly exposed)
  console.log("[fetch-espi] Function invoked at:", new Date().toISOString());

  // Klient Supabase z service_role — zapis do raw_ingest
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceKey) {
    console.error("[fetch-espi] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return new Response(
      JSON.stringify({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Fetch danych (stub — zastąp prawdziwym HTTP fetch)
  const records = STUB_RECORDS;

  // Zapis do raw_ingest
  const rows = records.map(r => ({
    source:  "espi",
    payload: r as unknown as Record<string, unknown>,
  }));

  console.log(`[fetch-espi] Processing ${records.length} stub records`);

  const { data, error } = await supabase
    .from("raw_ingest")
    .insert(rows)
    .select("id");

  if (error) {
    console.error("[fetch-espi] Insert error:", error.message);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const inserted = data?.length ?? 0;
  console.log(`[fetch-espi] Successfully inserted ${inserted} records`);

  return new Response(
    JSON.stringify({ ok: true, inserted, source: "espi", ts: new Date().toISOString() }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
