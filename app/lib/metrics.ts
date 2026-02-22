// ─── In-memory metrics (per Lambda instance) ─────────────────────────────────
// Wartości resetują się przy każdym cold-start.
// Nie nadają się do agregacji multi-instance — służą do diagnostyki i alertów.

interface MetricsState {
  total_requests:   number;
  total_gets:       number;
  total_posts:      number;
  total_2xx:        number;
  total_4xx:        number;
  total_429:        number;
  total_5xx:        number;
  total_latency_ms: number;  // suma do obliczenia średniej
  started_at:       string;
}

export const metricsState: MetricsState = {
  total_requests:   0,
  total_gets:       0,
  total_posts:      0,
  total_2xx:        0,
  total_4xx:        0,
  total_429:        0,
  total_5xx:        0,
  total_latency_ms: 0,
  started_at:       new Date().toISOString(),
};

export function recordRequest(method: string, status: number, ms: number): void {
  metricsState.total_requests++;
  metricsState.total_latency_ms += ms;

  if (method === "GET")  metricsState.total_gets++;
  if (method === "POST") metricsState.total_posts++;

  if (status === 429)       metricsState.total_429++;
  else if (status >= 500)   metricsState.total_5xx++;
  else if (status >= 400)   metricsState.total_4xx++;
  else if (status >= 200)   metricsState.total_2xx++;
}

export function getSnapshot() {
  const { total_requests, total_latency_ms, started_at, ...counts } = metricsState;
  return {
    ...counts,
    total_requests,
    avg_latency_ms: total_requests > 0
      ? Math.round((total_latency_ms / total_requests) * 10) / 10
      : 0,
    started_at,
    note: "in-memory per Lambda instance — resets on cold-start",
  };
}
