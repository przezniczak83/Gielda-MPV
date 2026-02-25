// supabase/functions/fetch-email/index.ts
// Reads UNSEEN emails from Gmail IMAP.
// Path A: ESPI emails → raw_ingest
// Path B: DM recommendation emails → Claude Haiku extraction → analyst_forecasts + Telegram

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ImapFlow }     from "npm:imapflow@1";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmailRecord {
  ticker:       string;
  title:        string;
  url:          string | null;
  published_at: string | null;
}

interface AnalystForecastInsert {
  ticker:          string;
  institution:     string | null;
  analyst_name:    string | null;
  recommendation:  string;
  price_target:    number | null;
  currency:        string;
  horizon_months:  number | null;
  upside_pct:      number | null;
  source_type:     string;
  published_at:    string;
}

// ─── Parse helpers ────────────────────────────────────────────────────────────

function parseSubject(subject: string): { ticker: string; title: string } | null {
  const m = subject.match(/^([A-Z0-9]{1,10})\s*-\s*(.+)$/);
  if (!m) return null;
  return { ticker: m[1].trim().toUpperCase(), title: m[2].trim() };
}

function extractTableCell(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<td[^>]*>\\s*${escaped}\\s*:?\\s*</td>\\s*<td[^>]*>(.*?)</td>`,
    "is",
  );
  const m = html.match(re);
  if (!m) return null;
  return m[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function extractLink(html: string): string | null {
  const re = /<td[^>]*>\s*Link\s*:?\s*<\/td>\s*<td[^>]*>.*?href="([^"]+)"/is;
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

function parseDate(raw: string | null): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const ddmm = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (ddmm) {
    const d = new Date(`${ddmm[3]}-${ddmm[2]}-${ddmm[1]}`);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

// ─── Recommendation keywords (quick pre-filter) ───────────────────────────────

const RECOMMENDATION_KEYWORDS = [
  "rekomendacja", "recommendation",
  "kupuj", "sprzedaj", "trzymaj",
  "buy", "sell", "hold", "neutral", "overweight",
];

function isRecommendation(subject: string): boolean {
  const lower = subject.toLowerCase();
  return RECOMMENDATION_KEYWORDS.some(k => lower.includes(k));
}

// ─── Claude Haiku extraction ──────────────────────────────────────────────────

interface HaikuForecast {
  ticker:         string | null;
  institution:    string | null;
  analyst_name:   string | null;
  recommendation: string | null;
  price_target:   number | null;
  currency:       string | null;
  horizon_months: number | null;
}

async function extractWithHaiku(
  subject: string,
  bodyText: string,
  apiKey: string,
): Promise<HaikuForecast | null> {
  const prompt = `Przeanalizuj poniższy e-mail z rekomendacją DM (Dom Maklerski) i wyciągnij dane strukturalne. Odpowiedz TYLKO obiektem JSON, bez markdown, bez wyjaśnień.

Wymagany format JSON:
{
  "ticker": "kod giełdowy spółki (2-6 liter, np. PKN, CDR, KGHM)",
  "institution": "nazwa domu maklerskiego (np. Pekao BM, mBank, DM BOŚ)",
  "analyst_name": "imię i nazwisko analityka lub null",
  "recommendation": "jedna z: BUY, HOLD, SELL, NEUTRAL, OVERWEIGHT, UNDERWEIGHT",
  "price_target": cena docelowa jako liczba lub null,
  "currency": "PLN lub EUR lub USD (domyślnie PLN)",
  "horizon_months": horyzont inwestycyjny w miesiącach lub null
}

Temat: ${subject}

Treść:
${bodyText.slice(0, 3000)}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":         "application/json",
        "x-api-key":            apiKey,
        "anthropic-version":    "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages:   [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error("[fetch-email] Haiku API error:", res.status, await res.text());
      return null;
    }

    const data = await res.json();
    const text = data?.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]) as HaikuForecast;
  } catch (err) {
    console.error("[fetch-email] Haiku extraction failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ─── Fetch current price for upside_pct ──────────────────────────────────────

async function fetchCurrentPrice(
  supabase: ReturnType<typeof createClient>,
  ticker: string,
): Promise<number | null> {
  const { data } = await supabase
    .from("price_history")
    .select("close")
    .eq("ticker", ticker)
    .order("date", { ascending: false })
    .limit(1)
    .single();
  return data?.close ?? null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_EMAILS = 20;
const ESPI_FROM  = "espi@gpw.pl";

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request): Promise<Response> => {
  console.log("[fetch-email] Function invoked at:", new Date().toISOString());

  const supabaseUrl    = Deno.env.get("SUPABASE_URL")              ?? "";
  const serviceKey     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const gmailEmail     = Deno.env.get("GMAIL_EMAIL")               ?? "";
  const gmailPass      = Deno.env.get("GMAIL_APP_PASSWORD")        ?? "";
  const anthropicKey   = Deno.env.get("ANTHROPIC_API_KEY")         ?? "";
  const tgToken        = Deno.env.get("TELEGRAM_BOT_TOKEN")        ?? "";
  const tgChatId       = Deno.env.get("TELEGRAM_CHAT_ID")          ?? "";

  const missing = (
    [
      ["SUPABASE_URL",              supabaseUrl],
      ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
      ["GMAIL_EMAIL",               gmailEmail],
      ["GMAIL_APP_PASSWORD",        gmailPass],
    ] as [string, string][]
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    const msg = `Missing env vars: ${missing.join(", ")}`;
    console.error("[fetch-email]", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const imap = new ImapFlow({
    host:   "imap.gmail.com",
    port:   993,
    secure: true,
    auth:   { user: gmailEmail, pass: gmailPass },
    logger: false,
  });

  const records:       EmailRecord[]          = [];
  const forecasts:     AnalystForecastInsert[] = [];
  const errors:        string[]               = [];

  try {
    await imap.connect();
    console.log("[fetch-email] IMAP connected");

    const lock = await imap.getMailboxLock("INBOX");
    try {
      const allUids  = await imap.search({ unseen: true }, { uid: true });
      const espiUids = await imap.search({ unseen: true, from: ESPI_FROM }, { uid: true });
      const espiSet  = new Set(espiUids.map(String));

      console.log(`[fetch-email] Found ${allUids.length} unseen email(s) (${espiUids.length} from ESPI)`);

      const toProcess = allUids.slice(0, MAX_EMAILS);

      for (const uid of toProcess) {
        try {
          const msg = await imap.fetchOne(
            String(uid),
            { envelope: true, source: true },
            { uid: true },
          );

          if (!msg) {
            console.warn(`[fetch-email] uid ${uid}: empty fetch — skipping`);
            continue;
          }

          const subject    = msg.envelope?.subject ?? "";
          const fromAddr   = msg.envelope?.from?.[0]?.address ?? "";
          const receivedAt = new Date().toISOString();

          const rawMime = msg.source
            ? new TextDecoder("utf-8", { fatal: false }).decode(msg.source)
            : "";

          // ── Path A: ESPI email ─────────────────────────────────────────
          if (espiSet.has(String(uid))) {
            const parsed = parseSubject(subject);
            if (!parsed) {
              console.warn(`[fetch-email] uid ${uid}: unparseable ESPI subject "${subject}" — skipping`);
            } else {
              const tickerFromBody = extractTableCell(rawMime, "Ticker");
              const ticker         = (tickerFromBody ?? parsed.ticker).toUpperCase();
              const url            = extractLink(rawMime);
              const publishedRaw   = extractTableCell(rawMime, "Data publikacji");
              const published_at   = parseDate(publishedRaw);

              records.push({ ticker, title: parsed.title, url, published_at });
              console.log(`[fetch-email] uid ${uid}: ESPI ticker=${ticker}, published_at=${published_at}`);
            }
          }
          // ── Path B: DM recommendation email → Claude Haiku ────────────
          else if (isRecommendation(subject)) {
            console.log(`[fetch-email] uid ${uid}: DM recommendation email — extracting with Haiku`);
            const bodyText = rawMime.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

            let extracted: HaikuForecast | null = null;
            if (anthropicKey) {
              extracted = await extractWithHaiku(subject, bodyText, anthropicKey);
            }

            if (!extracted?.ticker || !extracted?.recommendation) {
              console.warn(`[fetch-email] uid ${uid}: Haiku extraction incomplete, skipping`);
            } else {
              const ticker = extracted.ticker.toUpperCase().trim();
              const rec    = extracted.recommendation.toUpperCase();

              // Fetch current price to compute upside
              const currentPrice = await fetchCurrentPrice(supabase, ticker);
              let upside_pct: number | null = null;
              if (currentPrice && extracted.price_target && currentPrice > 0) {
                upside_pct = parseFloat(
                  (((extracted.price_target - currentPrice) / currentPrice) * 100).toFixed(2)
                );
              }

              forecasts.push({
                ticker,
                institution:    extracted.institution,
                analyst_name:   extracted.analyst_name,
                recommendation: rec,
                price_target:   extracted.price_target,
                currency:       extracted.currency ?? "PLN",
                horizon_months: extracted.horizon_months,
                upside_pct,
                source_type:    "email",
                published_at:   receivedAt,
              });

              console.log(`[fetch-email] uid ${uid}: forecast ticker=${ticker} rec=${rec} tp=${extracted.price_target} upside=${upside_pct}%`);
            }
          }

          // Mark as SEEN
          await imap.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true });

        } catch (msgErr) {
          const errMsg = msgErr instanceof Error ? msgErr.message : String(msgErr);
          console.error(`[fetch-email] uid ${uid} error:`, errMsg);
          errors.push(`uid=${uid}: ${errMsg}`);
        }
      }
    } finally {
      lock.release();
    }
  } catch (connErr) {
    const errMsg = connErr instanceof Error ? connErr.message : String(connErr);
    console.error("[fetch-email] IMAP connection error:", errMsg);
    return new Response(
      JSON.stringify({ ok: false, error: `IMAP: ${errMsg}` }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  } finally {
    try { await imap.logout(); } catch { /* ignore */ }
    console.log("[fetch-email] IMAP disconnected");
  }

  // ── Insert analyst_forecasts ──────────────────────────────────────────────
  let forecastsInserted = 0;
  if (forecasts.length > 0) {
    console.log(`[fetch-email] Inserting ${forecasts.length} forecast(s) to analyst_forecasts`);
    const { data: fData, error: fErr } = await supabase
      .from("analyst_forecasts")
      .insert(forecasts)
      .select("id, ticker");

    if (fErr) {
      console.error("[fetch-email] analyst_forecasts insert error:", fErr.message);
    } else {
      forecastsInserted = fData?.length ?? 0;

      // Telegram alerts
      if (tgToken && tgChatId) {
        for (const f of forecasts) {
          const recEmoji = f.recommendation.startsWith("BUY") || f.recommendation === "OVERWEIGHT"
            ? "🟢" : f.recommendation.startsWith("SELL") || f.recommendation === "UNDERWEIGHT"
            ? "🔴" : "🟡";
          const tpStr = f.price_target ? ` | Cel: *${f.price_target} ${f.currency}*` : "";
          const upStr = f.upside_pct != null
            ? ` | Potencjał: *${f.upside_pct > 0 ? "+" : ""}${f.upside_pct}%*` : "";
          const instStr = f.institution ? `\n🏦 ${f.institution}` : "";
          const text = [
            "💼 *REKOMENDACJA DM*",
            `${recEmoji} *${f.ticker}* — ${f.recommendation}${tpStr}${upStr}`,
            `${instStr}`,
          ].filter(Boolean).join("\n");

          try {
            await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
              method:  "POST",
              headers: { "Content-Type": "application/json" },
              body:    JSON.stringify({ chat_id: tgChatId, text, parse_mode: "Markdown" }),
            });
          } catch (tgErr) {
            console.warn("[fetch-email] Telegram alert failed:", tgErr instanceof Error ? tgErr.message : String(tgErr));
          }
        }
      }
    }
  }

  // ── Insert ESPI to raw_ingest ─────────────────────────────────────────────
  let inserted = 0;
  if (records.length > 0) {
    console.log(`[fetch-email] Inserting ${records.length} ESPI record(s) to raw_ingest`);
    const rows = records.map(r => ({
      source:  "email",
      payload: r as unknown as Record<string, unknown>,
    }));

    const { data, error } = await supabase
      .from("raw_ingest")
      .insert(rows)
      .select("id");

    if (error) {
      console.error("[fetch-email] raw_ingest insert error:", error.message);
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    inserted = data?.length ?? 0;
  }

  console.log(`[fetch-email] Done — espi=${inserted} forecasts=${forecastsInserted}`);

  return new Response(
    JSON.stringify({
      ok:                  true,
      espi_inserted:       inserted,
      forecasts_inserted:  forecastsInserted,
      source:              "email",
      ts:                  new Date().toISOString(),
      ...(errors.length > 0 && { partial_errors: errors }),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
