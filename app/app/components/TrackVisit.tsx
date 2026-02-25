"use client";

// Tiny client component embedded in server company page to track visits.
import { useEffect } from "react";
import { trackVisit } from "@/lib/storage";

export default function TrackVisit({ ticker, name }: { ticker: string; name: string }) {
  useEffect(() => {
    trackVisit(ticker, name);
  }, [ticker, name]);
  return null;
}
