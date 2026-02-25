"use client";

interface Props {
  href:  string;
  label?: string;
}

export default function ExportButton({ href, label = "CSV" }: Props) {
  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors font-medium"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 2v8m0 0-3-3m3 3 3-3M2 11v2a1 1 0 001 1h10a1 1 0 001-1v-2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label}
    </a>
  );
}
