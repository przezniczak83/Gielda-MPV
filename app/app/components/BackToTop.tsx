"use client";

import { useEffect, useState } from "react";

export default function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed bottom-6 right-6 z-50 w-10 h-10 rounded-full bg-gray-700 hover:bg-gray-600 border border-gray-600 text-gray-300 hover:text-white flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-110"
      aria-label="Wróć do góry"
      title="Wróć do góry"
    >
      ↑
    </button>
  );
}
