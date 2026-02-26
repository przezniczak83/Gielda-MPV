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

// ── Blacklist — never use these as aliases ────────────────────────────────────
// Common words that cause false positives (appear in articles unrelated to the company)

const BLACKLIST = new Set([
  // Common Polish words
  "text", "bank", "dom", "art", "eco", "net", "bit", "pro", "med",
  "lab", "era", "one", "now", "act", "fast", "data", "tech",
  "soft", "work", "fund", "star", "idea", "nova", "agro", "auto",
  "home", "life", "care", "time", "link", "line", "next",
  // Common English words
  "group", "capital", "energy", "power", "global", "trade", "first",
  "best", "real", "open", "core", "plus",
  // Generic corporate words
  "holding", "finance", "invest", "inwest", "euro",
  "polska", "polish", "polskie", "national", "towarzystwo",
  "spolka", "spólka", "spółka", "akcyjna", "limited", "investments",
  // Currencies / indices / institutions (not companies)
  "msz", "nbp", "eur", "usd", "pln", "gbp", "chf", "jpy",
  "wig", "wig20", "mwig40", "swig80",
  // Other ambiguous abbreviations
  "gs", "ab", "pcc", "ons", "ono",
]);

// ── Alias validator ───────────────────────────────────────────────────────────

function isValidAlias(alias: string, ticker: string): boolean {
  const a = alias.trim().toLowerCase();

  // Empty or too short
  if (!a || a.length < 2) return false;

  // On blacklist — always reject
  if (BLACKLIST.has(a)) return false;

  // Must contain at least 3 meaningful letters
  if (!/[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]{3,}/.test(a)) return false;

  // For non-ticker aliases: require min 4 chars
  // (ticker itself can be short: ART, GS, etc. — allowed as abbreviation)
  if (a.length <= 3 && a !== ticker.toLowerCase()) return false;

  return true;
}

// ── Alias generator ───────────────────────────────────────────────────────────

function generateAliases(ticker: string, name: string): AliasRow[] {
  const seen    = new Set<string>();
  const aliases: AliasRow[] = [];

  function add(raw: string, type: string) {
    const cleaned = raw.trim().toLowerCase();
    if (!isValidAlias(cleaned, ticker)) return;
    if (seen.has(cleaned)) return;
    seen.add(cleaned);
    aliases.push({ ticker, alias: cleaned, alias_type: type, language: "pl" });
  }

  // 1. Ticker abbreviation (always — even if short)
  const tickerLower = ticker.toLowerCase();
  seen.add(tickerLower);
  aliases.push({ ticker, alias: tickerLower, alias_type: "abbreviation", language: "pl" });

  // 2. Full official name
  add(name, "official_name");

  // 3. Name stripped of legal form suffix
  const stripped = name
    .replace(/\s+(S\.A\.|SA|S\.A|Spółka Akcyjna|Spolka Akcyjna|sp\. z o\.o\.|Sp\. z o\.o\.|S\.K\.A\.|ASI|SE|NV|PLC|Ltd\.?|GmbH|Inc\.?|Corp\.?|Co\.?)\.?\s*$/i, "")
    .trim();
  if (stripped && stripped !== name) add(stripped, "short_name");

  const baseName = stripped || name;

  // 4. First significant word — only if ≥ 5 chars (avoid short ambiguous words)
  const SKIP_FIRST = new Set(["bank", "grupa", "polska", "polskie", "towarzystwo", "fundusz", "first", "best"]);
  const firstWord  = baseName.split(/\s+/)[0];
  if (firstWord && firstWord.length >= 5 && !SKIP_FIRST.has(firstWord.toLowerCase())) {
    add(firstWord, "short_name");
  }

  // 5. Without leading "Grupa "
  if (baseName.toLowerCase().startsWith("grupa ")) {
    const withoutGrupa = baseName.slice(6);
    if (withoutGrupa.length >= 5) add(withoutGrupa, "short_name");
  }

  // 6. Acronym from 2–4 word names — only if ≥ 3 chars and not on blacklist
  const words = baseName.split(/[\s\-\.]+/).filter((w: string) => w.length > 1);
  if (words.length >= 2 && words.length <= 4) {
    const acronym = words.map((w: string) => w[0]).join("").toLowerCase();
    // Only add acronym if it's 3+ chars and different from ticker
    if (acronym.length >= 3 && acronym !== ticker.toLowerCase() && isValidAlias(acronym, ticker)) {
      add(acronym, "abbreviation");
    }
  }

  // 7. Manual brand overrides for well-known companies
  //    Only include unambiguous brand names (4+ chars, not common words)
  const overrides: Record<string, string[]> = {
    "PKN":  ["orlen", "pkn orlen", "orlen sa"],
    "CDR":  ["cd projekt", "cd projekt red", "cdprojekt"],
    "ALE":  ["allegro", "allegro.eu"],
    "KGH":  ["kghm", "kghm polska miedz", "kghm polska miedź"],
    "PZU":  ["pzu sa", "powszechny zaklad ubezpieczen"],
    "PKO":  ["pko bp", "pko bank polski"],
    "SPL":  ["santander", "santander bank polska", "santander polska"],
    "MBK":  ["mbank", "mbank sa", "bre bank"],
    "PEO":  ["pekao", "bank pekao", "pekao sa"],
    "DNP":  ["dino", "dino polska"],
    "LPP":  ["reserved", "cropp", "mohito"],
    "CPS":  ["cyfrowy polsat", "polsat", "cyfrowy polsat sa"],
    "ALR":  ["amrest", "amrest holdings"],
    "JSW":  ["jastrzebska spolka weglowa", "jastrzębska spółka węglowa"],
    "PCO":  ["azoty police"],
    "ATT":  ["azoty tarnów", "azoty tarno"],
    "INK":  ["inpost", "inpost sa"],
    "XTB":  ["x-trade brokers"],
    "TEN":  ["ten square games", "tensquare"],
    "PLW":  ["play communications", "play polska"],
    "VGO":  ["vigo photonics", "vigo system"],
    "OPL":  ["orange polska", "telekomunikacja polska"],
    "GTC":  ["globe trade centre", "globe trade center"],
    "EMC":  ["emc instytut medyczny"],
    "MRC":  ["mercator medical"],
    "PKP":  ["pkp cargo"],
    "GPW":  ["giełda papierów wartościowych", "warsaw stock exchange"],
    "PGE":  ["polska grupa energetyczna"],
    "TPE":  ["tauron polska energia"],
    "BDX":  ["budimex"],
    "DOM":  ["dom development"],
    "ECH":  ["echo investment"],
    "SNK":  ["sanok rubber"],
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
  const compRes = await fetch(`${SUPABASE_URL}/rest/v1/companies?select=ticker,name`, { headers });
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
  console.log(`Wygenerowano ${allAliases.length} aliasów (po filtracji blacklisty)`);

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

  console.log(`\nWysłano: ${sent} wierszy (nowe + pominięte duplikaty), błędy: ${errors}`);

  // Final count
  const countRes = await fetch(`${SUPABASE_URL}/rest/v1/ticker_aliases?select=ticker`, {
    headers: { ...headers, "Prefer": "count=exact" },
  });
  const countHeader = countRes.headers.get("content-range") ?? "?";
  console.log(`\nLiczba aliasów w bazie: ${countHeader}`);
}

main().catch(err => { console.error(err); process.exit(1); });
