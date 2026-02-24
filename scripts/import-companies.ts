// scripts/import-companies.ts
// Importuje companies.csv do tabeli companies w Supabase via REST API.
// Uruchom: npx --yes tsx scripts/import-companies.ts
// (z katalogu root repo: gielda-mpv/)

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, "..");

// ── Wczytaj app/.env.local ───────────────────────────────────────────────────

function loadEnv(path: string): Record<string, string> {
  const content = readFileSync(path, "utf-8");
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    result[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
  }
  return result;
}

const env = loadEnv(resolve(ROOT, "app/.env.local"));

// process.env overrides .env.local (allows passing correct key directly)
const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? env["NEXT_PUBLIC_SUPABASE_URL"];
const SERVICE_KEY  = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? env["SUPABASE_SERVICE_ROLE_KEY"];

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("ERROR: brak NEXT_PUBLIC_SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

console.log("SUPABASE_URL:", SUPABASE_URL);

// ── Parsuj companies.csv ─────────────────────────────────────────────────────

const lines = readFileSync(resolve(ROOT, "companies.csv"), "utf-8").trim().split("\n");

const rows = lines.slice(1).map(line => {
  const [ticker, name, sector, market, has_subsidiaries] = line.split(",");
  return {
    ticker:           ticker.trim(),
    name:             name.trim(),
    sector:           sector.trim(),
    market:           market.trim(),
    has_subsidiaries: has_subsidiaries.trim().toUpperCase() === "TRUE",
  };
});

console.log(`Parsed ${rows.length} rows from companies.csv`);

// ── Upsert via Supabase REST API ─────────────────────────────────────────────

async function main() {
  const headers = {
    "apikey":        SERVICE_KEY,
    "Authorization": `Bearer ${SERVICE_KEY}`,
    "Content-Type":  "application/json",
    "Prefer":        "resolution=merge-duplicates,return=representation",
  };

  const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/companies`, {
    method:  "POST",
    headers,
    body:    JSON.stringify(rows),
  });

  if (!upsertRes.ok) {
    const body = await upsertRes.text();
    console.error(`ERROR ${upsertRes.status}:`, body);
    process.exit(1);
  }

  const upserted = await upsertRes.json() as unknown[];
  console.log(`Upserted ${upserted.length} companies`);

  // ── Weryfikacja: COUNT ───────────────────────────────────────────────────

  const countRes = await fetch(`${SUPABASE_URL}/rest/v1/companies?select=count`, {
    headers: {
      "apikey":        SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Prefer":        "count=exact",
    },
  });

  const total = parseInt(countRes.headers.get("content-range")?.split("/")[1] ?? "0", 10);
  console.log(`Total companies in DB: ${total}`);

  if (total >= 30) {
    console.log("✓ DONE — tabela companies ma 30+ rekordów");
  } else {
    console.error(`✗ Oczekiwano 30+ rekordów, jest ${total}`);
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
