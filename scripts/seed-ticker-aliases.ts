// scripts/seed-ticker-aliases.ts
// Seeds ticker_aliases table with generated name variants for all companies.
// Run: npx --yes tsx scripts/seed-ticker-aliases.ts

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, "..");

// ── Read env ──────────────────────────────────────────────────────────────────

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

const SUPABASE_URL = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? env["NEXT_PUBLIC_SUPABASE_URL"] ?? "";
const SERVICE_KEY  = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("ERROR: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AliasRow {
  ticker:     string;
  alias:      string;
  alias_type: string;
  language:   string;
}

// ── Alias generator ───────────────────────────────────────────────────────────

function generateAliases(ticker: string, name: string): AliasRow[] {
  const seen    = new Set<string>();
  const aliases: AliasRow[] = [];

  function add(raw: string, type: string) {
    const cleaned = raw.trim().toLowerCase();
    if (cleaned.length < 2) return;
    if (seen.has(cleaned))  return;
    seen.add(cleaned);
    aliases.push({ ticker, alias: cleaned, alias_type: type, language: "pl" });
  }

  // 1. Ticker (always)
  add(ticker, "abbreviation");

  // 2. Full official name
  add(name, "official_name");

  // 3. Name stripped of legal form suffix
  const stripped = name
    .replace(/\s+(S\.A\.|SA|S\.A|Spółka Akcyjna|Spolka Akcyjna|sp\. z o\.o\.|Sp\. z o\.o\.|S\.K\.A\.|ASI|SE|NV|PLC|Ltd\.?|GmbH|Inc\.?|Corp\.?|Co\.?)\.?\s*$/i, "")
    .trim();
  if (stripped && stripped !== name) add(stripped, "short_name");

  const baseName = stripped || name;

  // 4. First significant word (if ≥ 3 chars, not a generic prefix)
  const SKIP_FIRST = new Set(["bank", "grupa", "polska", "polskie", "towarzystwo", "fundusz"]);
  const firstWord  = baseName.split(/\s+/)[0];
  if (firstWord && firstWord.length >= 3 && !SKIP_FIRST.has(firstWord.toLowerCase())) {
    add(firstWord, "short_name");
  }

  // 5. Without leading "Grupa "
  if (baseName.toLowerCase().startsWith("grupa ")) {
    add(baseName.slice(6), "short_name");
  }

  // 6. Acronym from 2–4 word names
  const words = baseName.split(/[\s\-\.]+/).filter((w: string) => w.length > 1);
  if (words.length >= 2 && words.length <= 4) {
    const acronym = words.map((w: string) => w[0]).join("").toLowerCase();
    if (acronym.length >= 2 && acronym !== ticker.toLowerCase()) {
      add(acronym, "abbreviation");
    }
  }

  // 7. Manual brand overrides for well-known companies
  const overrides: Record<string, string[]> = {
    "PKN":  ["orlen", "pkn orlen", "orlen sa", "pknorlen"],
    "CDR":  ["cd projekt", "cd projekt red", "cdp", "cdprojekt"],
    "ALE":  ["allegro", "allegro.eu", "allegro eu"],
    "KGH":  ["kghm", "kghm polska miedz", "kghm polska miedź", "polska miedź"],
    "PZU":  ["pzu", "powszechny zaklad ubezpieczen", "pzu sa"],
    "PKO":  ["pko bp", "pko bank polski", "pko bp sa"],
    "SPL":  ["santander", "santander bank polska", "bank santander", "santander polska"],
    "MBK":  ["mbank", "mbank sa", "bre bank"],
    "PEO":  ["pekao", "bank pekao", "pekao sa"],
    "DNP":  ["dino", "dino polska", "dino polska sa"],
    "LPP":  ["lpp", "lpp sa", "reserved", "cropp"],
    "CPS":  ["cyfrowy polsat", "polsat", "cyfrowy polsat sa", "plus"],
    "ALR":  ["amrest", "am rest", "amrest holdings"],
    "JSW":  ["jsw", "jastrzebska spolka weglowa", "jastrzębska spółka węglowa"],
    "TEXT": ["text", "text sa", "text software"],
    "PCO":  ["police", "grupa azoty police", "azoty police"],
    "ATT":  ["grupa azoty", "azoty", "azoty sa", "azoty tarnów"],
    "INK":  ["inpost", "inposta", "inpost sa"],
    "CCC":  ["ccc", "ccc sa", "ccc shoes"],
    "XTB":  ["xtb", "x-trade brokers", "xtb sa"],
    "TEN":  ["ten square games", "ten square", "tsq"],
    "PLW":  ["play", "play communications", "p4"],
    "VGO":  ["vigo photonics", "vigo", "vigo system"],
    "OPL":  ["orange polska", "orange", "telekomunikacja polska", "tp sa"],
    "GTC":  ["gtc", "globe trade centre", "globe trade center"],
    "EMC":  ["emc", "emc instytut medyczny"],
    "MRC":  ["mercator", "mercator medical"],
    "PKP":  ["pkp cargo", "pkp cargo sa"],
    "GPW":  ["gpw", "gielda papierow wartosciowych", "giełda papierów wartościowych", "warsaw stock exchange", "wse"],
    "PGE":  ["pge", "polska grupa energetyczna", "pge sa"],
    "TPE":  ["tauron", "tauron polska energia", "tauron pe"],
    "BDX":  ["budimex", "budimex sa"],
    "DOM":  ["dom development", "dom dev"],
    "ECH":  ["echo", "echo investment"],
    "SNK":  ["sanok rubber", "sanok"],
    "ZUE":  ["zue", "zue sa"],
  };

  if (overrides[ticker]) {
    for (const brand of overrides[ticker]) {
      add(brand, "brand");
    }
  }

  return aliases;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const headers = {
    "apikey":        SERVICE_KEY,
    "Authorization": `Bearer ${SERVICE_KEY}`,
  };

  // Fetch all companies
  const compRes = await fetch(`${SUPABASE_URL}/rest/v1/companies?select=ticker,name`, {
    headers,
  });
  if (!compRes.ok) {
    console.error("Failed to fetch companies:", compRes.status, await compRes.text());
    process.exit(1);
  }
  const companies = (await compRes.json()) as Array<{ ticker: string; name: string }>;
  console.log(`Generuję aliasy dla ${companies.length} spółek...`);

  // Generate all aliases
  const allAliases: AliasRow[] = [];
  for (const company of companies) {
    allAliases.push(...generateAliases(company.ticker, company.name));
  }
  console.log(`Wygenerowano ${allAliases.length} aliasów`);

  // Upsert in batches of 500
  const BATCH_SIZE = 500;
  let sent = 0;
  let errors = 0;

  for (let i = 0; i < allAliases.length; i += BATCH_SIZE) {
    const batch = allAliases.slice(i, i + BATCH_SIZE);
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/ticker_aliases?on_conflict=alias`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    });

    if (!upsertRes.ok) {
      const body = await upsertRes.text();
      console.error(`Błąd batch ${i}–${i + batch.length}: ${upsertRes.status} ${body.slice(0, 200)}`);
      errors += batch.length;
    } else {
      sent += batch.length;
      console.log(`Batch ${i}–${i + batch.length} ✓`);
    }
  }

  console.log(`\nWysłano: ${sent} wierszy (nowe wstawione + duplikaty pominięte), błędy: ${errors}`);

  // Final count
  const countRes = await fetch(`${SUPABASE_URL}/rest/v1/ticker_aliases?select=ticker`, {
    headers: { ...headers, "Prefer": "count=exact" },
  });
  const countHeader = countRes.headers.get("content-range") ?? "?";
  console.log(`\nLiczba aliasów w bazie: ${countHeader}`);

  // Verify TEXT
  const textRes = await fetch(`${SUPABASE_URL}/rest/v1/ticker_aliases?ticker=eq.TEXT&select=alias,alias_type`, {
    headers,
  });
  const textAliases = (await textRes.json()) as Array<{ alias: string; alias_type: string }>;
  console.log(`\nAliasy TEXT (${textAliases.length}):`);
  for (const a of textAliases) {
    console.log(`  ${a.alias_type.padEnd(15)} ${a.alias}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
