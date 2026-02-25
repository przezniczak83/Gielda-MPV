"use client";

// MacroInterpretation.tsx — Client component that fetches Claude Haiku analysis
// of macro indicators and their impact on GPW.

import { useState, useEffect } from "react";

interface MacroRow {
  name:       string;
  value:      number;
  prev_value: number | null;
  change_pct: number | null;
  period:     string | null;
}

interface Props {
  indicators: MacroRow[];
}

export default function MacroInterpretation({ indicators }: Props) {
  const [analysis,  setAnalysis]  = useState<string>("");
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  useEffect(() => {
    if (indicators.length === 0) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/macro-interpretation", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ indicators }),
          signal:  controller.signal,
        });

        if (!res.ok || !res.body) {
          const data = await res.json() as { error?: string };
          setError(data.error ?? "Błąd analizy");
          setLoading(false);
          return;
        }

        // SSE stream
        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let   buffer  = "";
        let   text    = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6).trim();
            if (!json) continue;
            try {
              const parsed = JSON.parse(json) as {
                type?:  string;
                delta?: { type?: string; text?: string };
              };
              if (
                parsed.type === "content_block_delta" &&
                parsed.delta?.type === "text_delta" &&
                parsed.delta.text
              ) {
                text += parsed.delta.text;
                setAnalysis(text);
              }
            } catch {
              // skip malformed chunks
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError(err instanceof Error ? err.message : "Błąd");
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, []); // run once on mount

  if (loading && !analysis) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
            Wpływ na GPW · Claude Haiku
          </span>
        </div>
        <div className="space-y-2">
          <div className="h-4 bg-gray-800 animate-pulse rounded w-3/4" />
          <div className="h-4 bg-gray-800 animate-pulse rounded w-full" />
          <div className="h-4 bg-gray-800 animate-pulse rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-800/30 bg-red-900/10 p-5">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  if (!analysis) return null;

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
          Wpływ na GPW
        </span>
        <span className="text-xs text-gray-600">Claude Haiku</span>
      </div>
      <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
        {analysis}
        {loading && (
          <span className="inline-block w-0.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-text-bottom" />
        )}
      </p>
    </div>
  );
}
