"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role:    "user" | "assistant";
  content: string;
}

export default function AiChat({ ticker }: { ticker: string }) {
  const [question,   setQuestion]   = useState("");
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [history,    setHistory]    = useState<Message[]>([]);
  const [loadingHist, setLoadingHist] = useState(true);
  // Streaming state
  const [streamingQ, setStreamingQ] = useState<string>("");
  const [streamingA, setStreamingA] = useState<string>("");

  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load persistent history on mount
  useEffect(() => {
    setLoadingHist(true);
    fetch(`/api/chat-history?ticker=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then((rows: Array<{ role: "user" | "assistant"; content: string }>) => {
        setHistory(rows);
        setLoadingHist(false);
      })
      .catch(() => setLoadingHist(false));
  }, [ticker]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, streamingA]);

  const submit = async () => {
    const q = question.trim();
    if (!q || loading) return;

    setLoading(true);
    setError(null);
    setStreamingQ(q);
    setStreamingA("");
    setQuestion("");

    try {
      const res = await fetch("/api/ai-query", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ticker, question: q }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? "Błąd połączenia z AI");
        setStreamingQ("");
        setStreamingA("");
        return;
      }

      // ── Read SSE stream ──────────────────────────────────────────────────
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = "";
      let   answer  = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last (potentially incomplete) line in the buffer
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
              answer += parsed.delta.text;
              setStreamingA(answer);
            }
          } catch {
            // malformed JSON chunk — skip
          }
        }
      }

      // ── Save to DB + update local history ────────────────────────────────
      if (answer) {
        setHistory(prev => [
          ...prev,
          { role: "user",      content: q },
          { role: "assistant", content: answer },
        ]);
        // Save assistant response to DB (user message already saved by server)
        fetch("/api/chat-history", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ ticker, role: "assistant", content: answer }),
        }).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd połączenia");
    } finally {
      setLoading(false);
      setStreamingQ("");
      setStreamingA("");
    }
  };

  function handleClearHistory() {
    if (!confirm("Wyczyścić historię rozmowy?")) return;
    fetch(`/api/chat-history?ticker=${encodeURIComponent(ticker)}`, { method: "DELETE" })
      .then(() => setHistory([]))
      .catch(() => {});
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
          AI Analiza
        </span>
        <div className="flex items-center gap-3">
          {history.length > 0 && (
            <button
              onClick={handleClearHistory}
              className="text-xs text-gray-600 hover:text-red-400 transition-colors"
            >
              wyczyść historię
            </button>
          )}
          <span className="text-xs text-gray-600">Claude Sonnet · streaming</span>
        </div>
      </div>

      {/* History */}
      {loadingHist ? (
        <div className="px-4 py-6 flex justify-center">
          <div className="flex gap-1 items-center">
            <span className="w-1.5 h-1.5 bg-gray-600 rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 bg-gray-600 rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 bg-gray-600 rounded-full animate-bounce [animation-delay:300ms]" />
          </div>
        </div>
      ) : history.length > 0 && (
        <div className="divide-y divide-gray-800/60 max-h-80 overflow-y-auto">
          {history.map((msg, i) => (
            <div key={i} className={`px-4 py-3 ${msg.role === "user" ? "flex justify-end" : "flex justify-start"}`}>
              {msg.role === "user" ? (
                <div className="bg-blue-600/20 border border-blue-500/20 rounded-xl rounded-tr-sm px-3 py-2 max-w-[85%]">
                  <p className="text-sm text-blue-200">{msg.content}</p>
                </div>
              ) : (
                <div className="bg-gray-800/60 rounded-xl rounded-tl-sm px-3 py-2 max-w-[90%]">
                  <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
                    {msg.content}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Streaming in-progress */}
      {loading && (streamingQ || streamingA) && (
        <div className="px-4 py-3 space-y-2 border-t border-gray-800/60">
          {streamingQ && (
            <div className="flex justify-end">
              <div className="bg-blue-600/20 border border-blue-500/20 rounded-xl rounded-tr-sm px-3 py-2 max-w-[85%]">
                <p className="text-sm text-blue-200">{streamingQ}</p>
              </div>
            </div>
          )}
          {streamingA ? (
            <div className="flex justify-start">
              <div className="bg-gray-800/60 rounded-xl rounded-tl-sm px-3 py-2 max-w-[90%]">
                <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
                  {streamingA}
                  <span className="inline-block w-0.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-text-bottom" />
                </p>
              </div>
            </div>
          ) : (
            <div className="flex justify-start">
              <div className="bg-gray-800/60 rounded-xl rounded-tl-sm px-3 py-2">
                <div className="flex gap-1 items-center h-5">
                  <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div ref={bottomRef} />

      {/* Error */}
      {error && (
        <div className="mx-4 my-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 flex gap-2 items-end border-t border-gray-800/40">
        <textarea
          ref={inputRef}
          rows={2}
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`Zadaj pytanie o ${ticker}...`}
          disabled={loading}
          className="flex-1 resize-none rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 placeholder-gray-600 px-3 py-2 focus:outline-none focus:border-blue-500 disabled:opacity-50 transition-colors"
        />
        <button
          onClick={submit}
          disabled={loading || !question.trim()}
          className="shrink-0 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          {loading ? (
            <span className="flex items-center gap-1.5">
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Piszę…
            </span>
          ) : (
            "Zapytaj AI"
          )}
        </button>
      </div>
      <p className="px-4 pb-3 text-xs text-gray-600">Enter = wyślij · Shift+Enter = nowa linia</p>
    </div>
  );
}
