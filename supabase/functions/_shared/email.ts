// _shared/email.ts
// Send transactional emails via Resend API.
// Requires: RESEND_API_KEY secret + ALERT_EMAIL env var (recipient address)
//
// Setup:
//   supabase secrets set RESEND_API_KEY=re_xxxx
//   supabase secrets set ALERT_EMAIL=your@email.com
//   Free key at: https://resend.com (100 emails/day free)

interface SendEmailOptions {
  to:      string;
  subject: string;
  html:    string;
  text?:   string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<boolean> {
  const apiKey   = Deno.env.get("RESEND_API_KEY") ?? "";
  const fromAddr = Deno.env.get("ALERT_FROM_EMAIL") ?? "alerts@gielda-monitor.pl";

  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set — skipping email send");
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from:    fromAddr,
        to:      [opts.to],
        subject: opts.subject,
        html:    opts.html,
        text:    opts.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[email] Resend error ${res.status}: ${body}`);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[email] fetch error:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

// ── Alert email template ───────────────────────────────────────────────────────

export function buildAlertEmail(opts: {
  ticker:       string;
  title:        string;
  impact_score: number;
  event_type:   string | null;
  published_at: string | null;
  summary?:     string | null;
}): { subject: string; html: string; text: string } {
  const impact   = opts.impact_score;
  const badge    = impact >= 7 ? "🔴 WYSOKI IMPAKT" : impact >= 4 ? "🟡 ŚREDNI IMPAKT" : "🟢 NISKI IMPAKT";
  const dateStr  = opts.published_at
    ? new Date(opts.published_at).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })
    : "—";

  const subject = `${badge} ${opts.ticker}: ${opts.title.slice(0, 80)}`;

  const html = `
<!DOCTYPE html>
<html lang="pl">
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, sans-serif; background: #111827; color: #e5e7eb; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto;">
    <div style="background: #1f2937; border-radius: 12px; padding: 24px; border: 1px solid #374151;">
      <div style="margin-bottom: 16px;">
        <span style="font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.1em;">
          GIEŁDA MONITOR — ALERT
        </span>
      </div>
      <h1 style="font-size: 20px; color: #fff; margin: 0 0 8px;">
        ${opts.ticker}
        <span style="font-size: 13px; background: ${impact >= 7 ? '#7f1d1d' : impact >= 4 ? '#78350f' : '#14532d'};
              color: ${impact >= 7 ? '#fca5a5' : impact >= 4 ? '#fde68a' : '#86efac'};
              padding: 2px 8px; border-radius: 9999px; margin-left: 8px; font-weight: 600;">
          Impact: ${impact}/10
        </span>
      </h1>
      <p style="font-size: 16px; color: #d1d5db; margin: 0 0 16px;">${opts.title}</p>
      ${opts.summary ? `<p style="font-size: 14px; color: #9ca3af; border-left: 2px solid #4b5563; padding-left: 12px; margin: 0 0 16px;">${opts.summary}</p>` : ""}
      <div style="font-size: 12px; color: #6b7280; border-top: 1px solid #374151; padding-top: 12px; margin-top: 12px;">
        <span>Typ: ${opts.event_type ?? "—"}</span>
        <span style="margin-left: 16px;">Data: ${dateStr}</span>
      </div>
    </div>
  </div>
</body>
</html>`;

  const text = `GIEŁDA MONITOR — ALERT\n\n${badge}\n${opts.ticker}: ${opts.title}\nImpact: ${impact}/10\n${opts.summary ?? ""}\n\nTyp: ${opts.event_type ?? "—"}\nData: ${dateStr}`;

  return { subject, html, text };
}

// ── Morning brief email template ───────────────────────────────────────────────

export function buildMorningBriefEmail(opts: {
  date:       string;
  events:     Array<{ ticker: string; title: string; impact_score: number | null }>;
  sentiment:  string | null;
}): { subject: string; html: string; text: string } {
  const subject = `📊 Giełda Monitor — Poranny Brief ${opts.date}`;

  const topEvents = opts.events.slice(0, 10);
  const rows = topEvents.map(e => `
    <tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #374151; font-weight: 600; color: #93c5fd;">${e.ticker}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #374151; color: #d1d5db; font-size: 13px;">${e.title.slice(0, 100)}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #374151; text-align: right; font-weight: 700;
            color: ${(e.impact_score ?? 0) >= 7 ? '#fca5a5' : (e.impact_score ?? 0) >= 4 ? '#fde68a' : '#86efac'};">
        ${e.impact_score ?? "—"}
      </td>
    </tr>`).join("");

  const html = `
<!DOCTYPE html>
<html lang="pl">
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, sans-serif; background: #111827; color: #e5e7eb; padding: 24px;">
  <div style="max-width: 640px; margin: 0 auto;">
    <div style="background: #1f2937; border-radius: 12px; padding: 24px; border: 1px solid #374151;">
      <h1 style="font-size: 18px; color: #fff; margin: 0 0 4px;">📊 Poranny Brief</h1>
      <p style="font-size: 12px; color: #6b7280; margin: 0 0 20px;">${opts.date}</p>
      ${opts.sentiment ? `<div style="background: #111827; border-radius: 8px; padding: 12px; margin-bottom: 16px; font-size: 13px; color: #9ca3af; border-left: 3px solid #3b82f6;">${opts.sentiment}</div>` : ""}
      <h2 style="font-size: 13px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 8px;">
        Kluczowe eventy
      </h2>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="color: #6b7280; font-size: 11px; text-transform: uppercase;">
            <th style="text-align: left; padding: 6px 12px;">Ticker</th>
            <th style="text-align: left; padding: 6px 12px;">Tytuł</th>
            <th style="text-align: right; padding: 6px 12px;">Impact</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;

  const text = `GIEŁDA MONITOR — Poranny Brief ${opts.date}\n\n${opts.sentiment ?? ""}\n\nKluczowe eventy:\n${topEvents.map(e => `• ${e.ticker} (${e.impact_score ?? "?"}): ${e.title}`).join("\n")}`;

  return { subject, html, text };
}
