"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Company {
  ticker: string;
  name:   string;
}

type ReportType = "financial" | "dm";
type Status     = "idle" | "uploading" | "done" | "error";

export default function UploadPage() {
  const [companies,    setCompanies]    = useState<Company[]>([]);
  const [reportType,   setReportType]   = useState<ReportType>("financial");
  const [ticker,       setTicker]       = useState("");
  const [institution,  setInstitution]  = useState("");
  const [reportDate,   setReportDate]   = useState("");
  const [file,         setFile]         = useState<File | null>(null);
  const [status,       setStatus]       = useState<Status>("idle");
  const [message,      setMessage]      = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/companies-list")
      .then(r => r.json())
      .then((d: Company[]) => {
        setCompanies(d);
        if (d.length > 0) setTicker(d[0].ticker);
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (reportType === "financial" && !ticker) return;

    setStatus("uploading");
    setMessage("Przetwarzanie…");

    const form = new FormData();
    form.append("file", file);

    let endpoint: string;

    if (reportType === "financial") {
      form.append("ticker", ticker);
      endpoint = "/api/upload-pdf";
    } else {
      if (institution) form.append("institution", institution);
      if (reportDate)  form.append("report_date",  reportDate);
      endpoint = "/api/upload-dm-pdf";
    }

    try {
      const res  = await fetch(endpoint, { method: "POST", body: form });
      const json = await res.json() as Record<string, unknown>;

      if (!res.ok || !json.ok) {
        setStatus("error");
        setMessage((json.error as string) ?? "Nieznany błąd");
      } else {
        setStatus("done");
        if (reportType === "financial") {
          const fields = (json.extracted_fields as Record<string, unknown>) ?? {};
          const count  = Object.keys(fields).filter(k => k !== "warning").length;
          setMessage(count > 0
            ? `Gotowe! Wyodrębniono ${count} pól finansowych dla ${ticker}.`
            : `Plik wysłany dla ${ticker}. Dane finansowe zaktualizowane.`);
        } else {
          const tickers = (json.tickers as string[]) ?? [];
          setMessage(`Gotowe! Raport DM dla ${json.institution ?? "DM"} — ${tickers.length > 0 ? tickers.join(", ") : "0"} spółek.`);
        }
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Błąd sieci");
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-xl mx-auto px-6 py-12">

        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300 transition-colors mb-10"
        >
          ← Dashboard
        </Link>

        <h1 className="text-2xl font-bold text-white mb-2">Wgraj raport PDF</h1>
        <p className="text-gray-500 text-sm mb-8">
          Raport finansowy spółki lub rekomendacja domu maklerskiego.
        </p>

        {/* Report type toggle */}
        <div className="flex gap-2 mb-6">
          {(["financial", "dm"] as ReportType[]).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => { setReportType(t); setStatus("idle"); setMessage(""); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                reportType === t
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-gray-200"
              }`}
            >
              {t === "financial" ? "Raport finansowy" : "Rekomendacja DM"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">

          {reportType === "financial" ? (
            /* ── Financial report: company selector ── */
            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Spółka
              </label>
              <select
                value={ticker}
                onChange={e => setTicker(e.target.value)}
                required
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
              >
                {companies.length === 0 ? (
                  <option value="">Ładowanie…</option>
                ) : (
                  companies.map(c => (
                    <option key={c.ticker} value={c.ticker}>{c.ticker} — {c.name}</option>
                  ))
                )}
              </select>
            </div>
          ) : (
            /* ── DM report: institution + date ── */
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Dom maklerski (opcjonalnie)
                </label>
                <input
                  type="text"
                  placeholder="np. Pekao BM, mBank, DM BOŚ"
                  value={institution}
                  onChange={e => setInstitution(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Data raportu (opcjonalnie)
                </label>
                <input
                  type="date"
                  value={reportDate}
                  onChange={e => setReportDate(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            </>
          )}

          {/* File */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              Plik PDF (max 20 MB)
            </label>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              required
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-gray-800 file:text-gray-300 hover:file:bg-gray-700 file:transition-colors cursor-pointer"
            />
            {file && (
              <div className="mt-1.5 text-xs text-gray-500 truncate">
                {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
              </div>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={status === "uploading" || !file || (reportType === "financial" && !ticker)}
            className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-600 text-white font-semibold text-sm transition-colors"
          >
            {status === "uploading" ? "Wysyłam…" : "Wyślij i przetwórz"}
          </button>

          {/* Status */}
          {status !== "idle" && (
            <div className={`rounded-lg px-4 py-3 text-sm ${
              status === "done"  ? "bg-green-500/10 text-green-400 border border-green-500/20" :
              status === "error" ? "bg-red-500/10 text-red-400 border border-red-500/20" :
              "bg-gray-800 text-gray-400"
            }`}>
              {message}
            </div>
          )}
        </form>

        <div className="mt-10 rounded-xl border border-gray-800 bg-gray-900/40 px-5 py-4 text-xs text-gray-500 leading-relaxed">
          <div className="font-semibold text-gray-400 mb-1">Jak to działa?</div>
          {reportType === "financial" ? (
            <ol className="list-decimal list-inside space-y-1">
              <li>Wybierz spółkę i wgraj plik PDF (raport roczny / kwartalny)</li>
              <li>PDF trafia do Supabase Storage (bucket: reports)</li>
              <li>AI (Gemini 2.0 Flash) wyodrębnia dane: przychody, EBITDA, EPS…</li>
              <li>Dane pojawiają się w sekcji Financial KPIs na stronie spółki</li>
            </ol>
          ) : (
            <ol className="list-decimal list-inside space-y-1">
              <li>Wgraj rekomendację DM (PDF domu maklerskiego)</li>
              <li>Gemini 2.0 Flash wykrywa typ dokumentu i wyodrębnia rekomendacje</li>
              <li>AI rozpoznaje wszystkie spółki, rekomendacje i ceny docelowe</li>
              <li>Dane trafiają do sekcji Konsensus na stronach spółek + alert Telegram</li>
            </ol>
          )}
        </div>

      </div>
    </div>
  );
}
