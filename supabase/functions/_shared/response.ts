export function okResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(
    JSON.stringify({ ok: true, ...data, ts: new Date().toISOString() }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

export function errorResponse(message: string, status = 500): Response {
  return new Response(
    JSON.stringify({ ok: false, error: message, ts: new Date().toISOString() }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}
