"use client";
// app/app/reports/[ticker]/ReportClient.tsx
// Generates and displays AI company reports with print/PDF support.

import { useEffect, useState } from "react";

interface ReportData {
  ok:           boolean;
  report_md:    string;
  ticker:       string;
  generated_at: string;
  cached:       boolean;
  error?:       string;
}

// Simple Markdown → HTML converter (subset: headers, bold, italic, lists, code)
function mdToHtml(md: string): string {
  return md
    // Escape HTML first (security — report comes from Claude)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    // Headers
    .replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>')
    .replace(/^# (.+)$/gm, '<h1 class="md-h1">$1</h1>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Unordered lists
    .replace(/^[\-\*] (.+)$/gm, "<li>$1</li>")
    // Blank lines → paragraph breaks
    .replace(/\n\n+/g, "</p><p>")
    // Wrap in <p>
    .replace(/^(?!<[h1-6li])(.+)$/gm, (m) =>
      m.startsWith("<") ? m : m
    )
    // Clean up <li> wrapping
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul class="md-ul">${m}</ul>`);
}

export default function ReportClient({ ticker }: { ticker: string }) {
  const [report,    setReport]    = useState<ReportData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  // Auto-generate on mount
  useEffect(() => {
    generateReport(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  async function generateReport(force: boolean) {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-report", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ticker, force }),
      });
      const data = await res.json() as ReportData;
      if (!data.ok) {
        setError(data.error ?? "Błąd generowania raportu");
      } else {
        setReport(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd połączenia");
    } finally {
      setGenerating(false);
    }
  }

  const handlePrint = () => window.print();

  return (
    <div>
      {/* Action bar — hidden on print */}
      <div className="mb-6 flex items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-3">
          <button
            onClick={() => generateReport(true)}
            disabled={generating}
            className="text-xs px-3 py-2 rounded-md bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 border border-gray-700 transition-colors"
          >
            {generating ? "⟳ Generuję..." : "⟳ Regeneruj raport"}
          </button>
          {report?.cached && (
            <span className="text-xs text-gray-600">
              Z pamięci podręcznej — {new Date(report.generated_at).toLocaleString("pl-PL")}
            </span>
          )}
        </div>
        <button
          onClick={handlePrint}
          disabled={!report || generating}
          className="text-xs px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-medium transition-colors"
        >
          🖨 Drukuj / PDF
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-800/50 bg-red-900/20 px-5 py-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {generating && !report && (
        <div className="space-y-4 animate-pulse">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-4 bg-gray-800 rounded" style={{ width: `${70 + (i % 3) * 10}%` }} />
          ))}
        </div>
      )}

      {/* Report content */}
      {report?.report_md && (
        <div
          id="report-content"
          className="report-body"
          dangerouslySetInnerHTML={{ __html: mdToHtml(report.report_md) }}
        />
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white !important; color: black !important; }
          .print\\:hidden { display: none !important; }
          #report-content { color: black; }
        }

        .report-body {
          color: #e5e7eb;
          font-size: 14px;
          line-height: 1.75;
        }

        @media print {
          .report-body { color: black; font-size: 12px; }
        }

        .report-body .md-h1 {
          font-size: 22px;
          font-weight: 700;
          color: white;
          margin: 24px 0 12px;
          padding-bottom: 6px;
          border-bottom: 2px solid #3b82f6;
        }

        .report-body .md-h2 {
          font-size: 17px;
          font-weight: 600;
          color: #93c5fd;
          margin: 20px 0 8px;
          padding-left: 8px;
          border-left: 3px solid #3b82f6;
        }

        .report-body .md-h3 {
          font-size: 14px;
          font-weight: 600;
          color: #d1d5db;
          margin: 14px 0 6px;
        }

        .report-body p {
          margin-bottom: 10px;
        }

        .report-body strong {
          color: #f9fafb;
          font-weight: 600;
        }

        .report-body .md-ul {
          list-style: disc;
          padding-left: 20px;
          margin-bottom: 10px;
        }

        .report-body .md-ul li {
          margin-bottom: 4px;
        }

        @media print {
          .report-body .md-h1, .report-body .md-h2, .report-body .md-h3,
          .report-body strong { color: black; }
          .report-body .md-h2 { border-color: black; }
        }
      `}</style>
    </div>
  );
}
