// app/app/alerts/page.tsx
// Server component — fetches alert history, delegates rendering to AlertsPageClient.

import { supabase } from "@/lib/supabase";
import AlertsPageClient, { type AlertRow } from "../components/AlertsPageClient";

export const revalidate = 60; // ISR: 1 minute

export default async function AlertsPage() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const { data: alerts } = await supabase
    .from("company_events")
    .select("ticker, title, event_type, impact_score, published_at, created_at")
    .gte("impact_score", 7)
    .gt("created_at", sevenDaysAgo)
    .order("created_at", { ascending: false });

  return <AlertsPageClient alerts={(alerts ?? []) as AlertRow[]} />;
}
