"use client";

import { useEffect, useRef } from "react";

interface TradingViewWidgetProps {
  ticker: string;
  market: string; // "GPW" | "USA"
}

export default function TradingViewWidget({ ticker, market }: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  function getSymbol(): string {
    if (market === "GPW") return `GPW:${ticker}`;
    // For US stocks, let TradingView auto-resolve exchange
    return ticker;
  }

  useEffect(() => {
    if (!containerRef.current) return;
    // Clear any previous widget
    containerRef.current.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize:            true,
      symbol:              getSymbol(),
      interval:            "D",
      timezone:            "Europe/Warsaw",
      theme:               "dark",
      style:               "1",
      locale:              "pl",
      backgroundColor:     "rgba(17, 24, 39, 1)",
      gridColor:           "rgba(31, 41, 55, 0.8)",
      hide_side_toolbar:   false,
      allow_symbol_change: false,
      calendar:            false,
      support_host:        "https://www.tradingview.com",
    });
    containerRef.current.appendChild(script);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, market]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container rounded-xl overflow-hidden border border-gray-800 bg-gray-900/40"
      style={{ height: "420px" }}
    />
  );
}
