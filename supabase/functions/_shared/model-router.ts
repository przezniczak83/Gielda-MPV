// Centralny rejestr modeli AI — zmień tu, zmieni się wszędzie
export const MODELS = {
  // Tanie — bulk processing
  bulk_classification: "gemini-2.0-flash",
  pdf_extraction:      "gemini-2.0-flash",
  simple_summary:      "claude-haiku-4-5-20251001",
  email_extraction:    "claude-haiku-4-5-20251001",

  // Średnie — analityka
  health_score:        "claude-haiku-4-5-20251001",
  red_flags:           "claude-haiku-4-5-20251001",
  dividend:            "claude-haiku-4-5-20251001",
  earnings_quality:    "claude-haiku-4-5-20251001",
  sentiment_analysis:  "claude-haiku-4-5-20251001",
  macro_interpretation: "claude-haiku-4-5-20251001",

  // Najlepsze — złożona analiza
  ai_chat:             "claude-sonnet-4-20250514",
  moat_analysis:       "claude-sonnet-4-20250514",
  forecast_gen:        "claude-sonnet-4-20250514",
  pdf_complex:         "claude-sonnet-4-20250514",
} as const;

export type ModelKey = keyof typeof MODELS;
