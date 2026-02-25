import fetch from "node-fetch";

// Stooq returns Polish column headers: Data,Otwarcie,Najwyzszy,Najnizszy,Zamkniecie,Wolumen
// Column positions are fixed: 0=date, 1=open, 2=high, 3=low, 4=close, 5=volume
const DATE_IDX   = 0;
const OPEN_IDX   = 1;
const HIGH_IDX   = 2;
const LOW_IDX    = 3;
const CLOSE_IDX  = 4;
const VOLUME_IDX = 5;

async function fetchCsv(ticker) {
  const symbol = ticker.toLowerCase();
  const url = `https://stooq.pl/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Stooq returned ${res.status} for ${ticker}`);
  }

  const csv = await res.text();
  if (csv.trim() === "Brak danych" || csv.trim() === "") {
    throw new Error(`No data from Stooq for ${ticker}`);
  }

  const lines = csv.trim().split("\n").filter(Boolean);
  if (lines.length < 2) {
    throw new Error(`No data rows from Stooq for ${ticker}`);
  }

  return lines;
}

/**
 * Fetch latest daily price data for a GPW-listed ticker from Stooq.
 * URL pattern: https://stooq.pl/q/d/l/?s={ticker}&i=d
 */
export async function fetchStooqPrice(ticker) {
  const lines = await fetchCsv(ticker);

  // Last row = most recent trading day
  const last = lines[lines.length - 1].split(",");

  return {
    ticker:  ticker.toUpperCase(),
    date:    last[DATE_IDX]?.trim()   ?? null,
    open:    parseFloat(last[OPEN_IDX])   || null,
    high:    parseFloat(last[HIGH_IDX])   || null,
    low:     parseFloat(last[LOW_IDX])    || null,
    close:   parseFloat(last[CLOSE_IDX])  || null,
    volume:  parseInt(last[VOLUME_IDX], 10) || null,
    source:  "stooq",
  };
}

/**
 * Fetch last N days of price history for a ticker.
 * Returns array sorted ascending by date.
 */
export async function fetchStooqHistory(ticker, days = 30) {
  let lines;
  try {
    lines = await fetchCsv(ticker);
  } catch {
    return [];
  }

  const rows = lines
    .slice(1) // skip header
    .map((line) => {
      const cols = line.split(",");
      return {
        date:   cols[DATE_IDX]?.trim() ?? null,
        close:  parseFloat(cols[CLOSE_IDX])  || null,
        volume: parseInt(cols[VOLUME_IDX], 10) || null,
      };
    })
    .filter((r) => r.date && r.close);

  // Return last N days (already ascending from Stooq)
  return rows.slice(-days);
}
