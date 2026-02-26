"use client";

import { useState, useEffect } from "react";
import { LiveTimestamp }       from "./LiveTimestamp";

interface SentimentData {
  ticker:      string;
  score:       number;
  label:       "BULLISH" | "NEUTRAL" | "BEARISH";
  summary:     string;
  analyzed_at: string;
}

interface Props {
  ticker: string;
}

function SentimentGauge({ score }: { score: number }) {
  // score: -1.0 to +1.0
  const pct   = ((score + 1) / 2) * 100;  // 0–100%
  const color =
    score >= 0.3  ? "bg-green-500"
    : score <= -0.3 ? "bg-red-500"
    : "bg-yellow-500";

  return (
    <div className="mt-2">
      <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-600 mt-0.5">
        <span>BEARISH</span>
        <span className="font-mono">{score >= 0 ? "+" : ""}{score.toFixed(2)}</span>
        <span>BULLISH</span>
      </div>
    </div>
  );
}

function LabelBadge({ label }: { label: string }) {
  const cls =
    label === "BULLISH" ? "bg-green-500/15 text-green-400 border-green-500/25"
    : label === "BEARISH" ? "bg-red-500/15 text-red-400 border-red-500/25"
    : "bg-yellow-500/15 text-yellow-400 border-yellow-500/25";

  return (
    <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

export default function SentimentWidget({ ticker }: Props) {
  const [data,      setData]      = useState<SentimentData | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  async function load() {
    try {
      const res  = await fetch(`/api/company-sentiment?ticker=${encodeURIComponent(ticker)}`);
      const json = await res.json() as { ok: boolean; sentiment: SentimentData | null; error?: string };
      if (json.ok && json.sentiment) {
        setData(json.sentiment);
      }
    } catch {
      // silent — widget just shows empty
    } finally {
      setLoading(false);
    }
  }

  async function analyze() {
    setAnalyzing(true);
    setError(null);
    try {
      const res  = await fetch("/api/company-sentiment", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ticker }),
      });
      const json = await res.json() as { ok: boolean; score?: number; label?: string; summary?: string; analyzed_at?: string; error?: string };
      if (!json.ok) {
        setError(json.error ?? "Błąd analizy");
      } else {
        setData({
          ticker,
          score:       json.score ?? 0,
          label:       (json.label ?? "NEUTRAL") as "BULLISH" | "NEUTRAL" | "BEARISH",
          summary:     json.summary ?? "",
          analyzed_at: json.analyzed_at ?? new Date().toISOString(),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd połączenia");
    } finally {
      setAnalyzing(false);
    }
  }

  useEffect(() => { load(); }, [ticker]);

  const analyzedDate = data?.analyzed_at
    ? new Date(data.analyzed_at).toLocaleDateString("pl-PL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
          Sentyment AI
        </span>
        <div className="flex items-center gap-2">
          {data && <LabelBadge label={data.label} />}
          <button
            onClick={analyze}
            disabled={analyzing}
            className="text-xs px-2.5 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 transition-colors"
          >
            {analyzing ? "Analizuję…" : "Analizuj"}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400 mb-2">{error}</p>
      )}

      {loading && !data ? (
        <div className="space-y-2">
          <div className="h-2 bg-gray-800 animate-pulse rounded-full" />
          <div className="h-4 bg-gray-800 animate-pulse rounded w-3/4 mt-3" />
        </div>
      ) : data ? (
        <>
          <SentimentGauge score={data.score} />
          {data.summary && (
            <p className="text-sm text-gray-300 mt-3 leading-relaxed">{data.summary}</p>
          )}
          <p className="text-xs text-gray-600 mt-2 flex items-center gap-1">
            Claude Haiku
            <LiveTimestamp date={data?.analyzed_at} prefix="sentiment" />
          </p>
        </>
      ) : (
        <p className="text-sm text-gray-500">
          Brak danych sentymentu. Kliknij „Analizuj" aby wygenerować ocenę.
        </p>
      )}
    </div>
  );
}
