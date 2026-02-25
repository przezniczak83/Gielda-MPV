import fetch from "node-fetch";
import * as cheerio from "cheerio";

const GPW_INSIDER_URL = "https://www.gpw.pl/transakcje-insiderow";

/**
 * Scrape insider transactions from GPW website.
 * Returns array of transaction objects.
 */
export async function fetchInsiderTransactions() {
  const res = await fetch(GPW_INSIDER_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
      "Cache-Control": "no-cache",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`GPW returned ${res.status} for insider transactions`);
  }

  const html = await res.text();
  const $    = cheerio.load(html);

  const transactions = [];

  // GPW insider table selector — table with class containing "table" inside main content
  $("table").each((_, table) => {
    const rows = $(table).find("tbody tr");
    if (rows.length === 0) return;

    // Detect if this is the insider table by checking header cells
    const headers = $(table)
      .find("thead th, thead td")
      .map((_, el) => $(el).text().trim().toLowerCase())
      .get();

    const hasInsiderHeaders =
      headers.some((h) => h.includes("spółka") || h.includes("emitent") || h.includes("issuer")) ||
      headers.some((h) => h.includes("transakcja") || h.includes("transaction"));

    if (!hasInsiderHeaders && headers.length > 0) return;

    rows.each((_, row) => {
      const cells = $(row)
        .find("td")
        .map((_, td) => $(td).text().trim())
        .get();

      if (cells.length < 4) return;

      // Try to parse common GPW insider table structure
      // Columns vary but typically: date, company/ticker, person, position, type, price, volume, value
      transactions.push({
        raw: cells,
        date:    cells[0] ?? null,
        company: cells[1] ?? null,
        person:  cells[2] ?? null,
        type:    cells[3] ?? null,
        price:   parsePolishNumber(cells[4]),
        volume:  parsePolishNumber(cells[5]),
        value:   parsePolishNumber(cells[6]),
      });
    });
  });

  return transactions;
}

/** Parse Polish number format: "1 234,56" → 1234.56 */
function parsePolishNumber(str) {
  if (!str) return null;
  const cleaned = str.replace(/\s/g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}
