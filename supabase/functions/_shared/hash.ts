/** First 32 hex chars of SHA-256 — sufficient for URL deduplication. */
export async function hashUrl(url: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
