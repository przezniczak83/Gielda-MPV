"use client";

import { useState, useEffect } from "react";
import { isFavorite, toggleFavorite } from "@/lib/storage";

interface Props {
  ticker: string;
  size?:  "sm" | "md";
}

export default function FavoriteButton({ ticker, size = "md" }: Props) {
  const [fav, setFav] = useState(false);

  useEffect(() => {
    setFav(isFavorite(ticker));
  }, [ticker]);

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = toggleFavorite(ticker);
    setFav(next);
    window.dispatchEvent(new CustomEvent("favorites-changed"));
  }

  const sizeClass = size === "sm"
    ? "w-4 h-4 text-sm"
    : "w-5 h-5 text-base";

  return (
    <button
      onClick={handleClick}
      title={fav ? "Usuń z ulubionych" : "Dodaj do ulubionych"}
      className={`${sizeClass} transition-colors shrink-0 ${
        fav ? "text-yellow-400 hover:text-yellow-300" : "text-gray-600 hover:text-yellow-400"
      }`}
    >
      {fav ? "★" : "☆"}
    </button>
  );
}
