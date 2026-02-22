"use client";

import React, { useEffect, useMemo, useState } from "react";

type NewsRow = {
  id: string;
  ticker: string;
  title: string;
  source: string | null;
  url: string | null;
  published_at: string | null;
  created_at: string | null;
  impact_score: number | null;
  category: string | null;
};

type ApiListResponse = {
  data: NewsRow[];
  error: string | null;
  meta?: {
    limit: number;
    offset: number;
    returned: number;
  };
};

type ApiInsertResponse = {
  data: NewsRow | null;
  error: string | null;
};

function toLocalDateTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/**
 * Akceptuje:
 * - "AAPL, TSLA"
 * - "AAPL TSLA"
 * - "AAPL/TSLA"
 * - "AAPL;TSLA"
 * - "AAPL | TSLA"
 * Zwraca: ["AAPL","TSLA"]
 */
function parseTickers(input: string): string[] {
  const raw = (input || "")
    .toUpperCase()
    .replaceAll("|", ",")
    .replaceAll("/", ",")
    .replaceAll(";", ",")
    .replaceAll("\n", ",")
    .split(/[\s,]+/g)
    .map((x) => x.trim())
    .filter(Boolean);

  // dedupe, zachowaj kolejność
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export default function Page() {
  // ---- FORM
  const [ticker, setTicker] = useState("AAPL");
  const [title, setTitle] = useState("Test news item");
  const [source, setSource] = useState("manual");
  const [url, setUrl] = useState("https://example.com");
  const [published, setPublished] = useState("2026-02-22T03:30:00Z");
  const [impact, setImpact] = useState("5");
  const [category, setCategory] = useState("test");

  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const clearMessage = () => setMessage(null);

  // ---- LIST / FILTER
  const [filterInput, setFilterInput] = useState("AAPL, TSLA");
  const tickers = useMemo(() => parseTickers(filterInput), [filterInput]);

  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);

  const [rows, setRows] = useState<NewsRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastQuery, setLastQuery] = useState("");

  const buildListUrl = () => {
    const params = new URLSearchParams();
    for (const t of tickers) params.append("ticker", t);
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    return `/api/news?${params.toString()}`;
  };

  const load = async () => {
    setLoading(true);
    try {
      const listUrl = buildListUrl();
      setLastQuery(listUrl);

      const res = await fetch(listUrl, { method: "GET" });
      const json = (await res.json()) as ApiListResponse;

      if (!res.ok || json.error) {
        setRows([]);
        setMessage({ kind: "err", text: json.error || `Błąd pobierania (${res.status})` });
        return;
      }

      setRows(json.data || []);
    } catch (e: any) {
      setRows([]);
      setMessage({ kind: "err", text: e?.message || "Błąd pobierania" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // auto-load on mount / when filter changes / pagination changes
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.join(","), limit, offset]);

  const onAdd = async () => {
    clearMessage();

    const payload = {
      ticker: ticker.trim().toUpperCase(),
      title: title.trim(),
      source: source.trim() || null,
      url: url.trim() || null,
      published_at: published.trim() || null,
      impact_score: impact ? Number(impact) : null,
      category: category.trim() || null,
    };

    try {
      const res = await fetch("/api/news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as ApiInsertResponse;

      if (!res.ok || json.error) {
        setMessage({ kind: "err", text: json.error || `Błąd (${res.status})` });
        return;
      }

      setMessage({ kind: "ok", text: "OK: dodano wpis" });

      // 1) po dodaniu wróć na pierwszą stronę wyników
      setOffset(0);

      // 2) i odśwież listę (jeśli offset już 0, to zadziała od razu)
      // jeśli offset było !=0, useEffect odpali load po setOffset(0), ale tu robimy też natychmiastowe odświeżenie
      await load();
    } catch (e: any) {
      setMessage({ kind: "err", text: e?.message || "Błąd zapisu" });
    }
  };

  const styles = {
    wrap: { maxWidth: 1100, margin: "40px auto", padding: "0 16px", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" } as React.CSSProperties,
    h1: { fontSize: 28, marginBottom: 20 } as React.CSSProperties,
    card: { border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, marginBottom: 16, background: "#fff" } as React.CSSProperties,
    row: { display: "grid", gridTemplateColumns: "160px 1fr", gap: 12, alignItems: "center", marginBottom: 10 } as React.CSSProperties,
    label: { fontWeight: 600, color: "#111827" } as React.CSSProperties,
    input: { width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 10 } as React.CSSProperties,
    btnRow: { display: "flex", gap: 10, marginTop: 12 } as React.CSSProperties,
    btn: { padding: "10px 14px", borderRadius: 10, border: "1px solid #111827", background: "#111827", color: "#fff", cursor: "pointer" } as React.CSSProperties,
    btnGhost: { padding: "10px 14px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" } as React.CSSProperties,
    msgOk: { marginTop: 10, color: "#16a34a", fontWeight: 600 } as React.CSSProperties,
    msgErr: { marginTop: 10, color: "#dc2626", fontWeight: 600 } as React.CSSProperties,
    filterRow: { display: "grid", gridTemplateColumns: "1fr 140px 120px 1fr", gap: 10, alignItems: "center" } as React.CSSProperties,
    small: { color: "#6b7280", fontSize: 12, marginTop: 6 } as React.CSSProperties,
    table: { width: "100%", borderCollapse: "collapse" as const, marginTop: 12 } as React.CSSProperties,
    th: { textAlign: "left" as const, padding: 10, borderBottom: "1px solid #e5e7eb", color: "#111827" } as React.CSSProperties,
    td: { padding: 10, borderBottom: "1px solid #f3f4f6", verticalAlign: "top" as const } as React.CSSProperties,
    pill: { fontSize: 12, padding: "2px 8px", borderRadius: 999, border: "1px solid #e5e7eb", color: "#374151" } as React.CSSProperties,
  };

  return (
    <div style={styles.wrap}>
      <h1 style={styles.h1}>News</h1>

      <div style={styles.card}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Add news</div>

        <div style={styles.row}>
          <div style={styles.label}>Ticker *</div>
          <input style={styles.input} value={ticker} onChange={(e) => setTicker(e.target.value)} />
        </div>

        <div style={styles.row}>
          <div style={styles.label}>Title *</div>
          <input style={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div style={styles.row}>
          <div style={styles.label}>Source *</div>
          <input style={styles.input} value={source} onChange={(e) => setSource(e.target.value)} />
        </div>

        <div style={styles.row}>
          <div style={styles.label}>URL</div>
          <input style={styles.input} value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>

        <div style={styles.row}>
          <div style={styles.label}>Published (ISO)</div>
          <input style={styles.input} value={published} onChange={(e) => setPublished(e.target.value)} />
        </div>

        <div style={styles.row}>
          <div style={styles.label}>Impact</div>
          <input style={styles.input} value={impact} onChange={(e) => setImpact(e.target.value)} />
        </div>

        <div style={styles.row}>
          <div style={styles.label}>Category</div>
          <input style={styles.input} value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>

        <div style={styles.btnRow}>
          <button style={styles.btn} onClick={onAdd}>Add news</button>
          <button style={styles.btnGhost} onClick={clearMessage}>Clear message</button>
        </div>

        {message?.kind === "ok" && <div style={styles.msgOk}>{message.text}</div>}
        {message?.kind === "err" && <div style={styles.msgErr}>Error: {message.text}</div>}
      </div>

      <div style={styles.card}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Filter</div>

        <div style={styles.filterRow}>
          <input
            style={styles.input}
            value={filterInput}
            onChange={(e) => {
              setOffset(0);
              setFilterInput(e.target.value);
            }}
            placeholder="np. AAPL, TSLA"
          />

          <select style={styles.input} value={limit} onChange={(e) => { setOffset(0); setLimit(Number(e.target.value)); }}>
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>

          <button style={styles.btnGhost} onClick={load} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              style={styles.btnGhost}
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
              disabled={offset === 0 || loading}
            >
              Prev
            </button>
            <span style={{ alignSelf: "center", color: "#6b7280" }}>offset: {offset}</span>
            <button
              style={styles.btnGhost}
              onClick={() => setOffset((o) => o + limit)}
              disabled={loading}
            >
              Next
            </button>
          </div>
        </div>

        <div style={styles.small}>
          Możesz wpisać: <span style={styles.pill}>AAPL, TSLA</span> albo <span style={styles.pill}>AAPL TSLA</span> albo{" "}
          <span style={styles.pill}>AAPL/TSLA</span> albo <span style={styles.pill}>AAPL;TSLA</span>
        </div>

        <div style={styles.small}>
          Query: <code>{lastQuery || buildListUrl()}</code>
        </div>

        <div style={{ marginTop: 12, fontWeight: 700 }}>News list</div>

        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Ticker</th>
              <th style={styles.th}>Title</th>
              <th style={styles.th}>Source</th>
              <th style={styles.th}>Published</th>
              <th style={styles.th}>Impact</th>
              <th style={styles.th}>Category</th>
              <th style={styles.th}>URL</th>
              <th style={styles.th}>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td style={styles.td} colSpan={8}>
                  {loading ? "Ładowanie..." : "Brak wyników"}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...styles.td, fontWeight: 700 }}>{r.ticker}</td>
                  <td style={styles.td}>{r.title}</td>
                  <td style={styles.td}>{r.source ?? ""}</td>
                  <td style={styles.td}>{toLocalDateTime(r.published_at)}</td>
                  <td style={styles.td}>{r.impact_score ?? ""}</td>
                  <td style={styles.td}>{r.category ?? ""}</td>
                  <td style={styles.td}>
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer">
                        open
                      </a>
                    ) : (
                      ""
                    )}
                  </td>
                  <td style={styles.td}>{toLocalDateTime(r.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}