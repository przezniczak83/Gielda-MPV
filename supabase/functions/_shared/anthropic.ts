import { MODELS, ModelKey } from "./model-router.ts";

interface AnthropicMessage {
  role:    "user" | "assistant";
  content: string;
}

export async function callAnthropic(
  modelKey:  ModelKey,
  system:    string,
  messages:  AnthropicMessage[],
  maxTokens = 500,
): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const model = MODELS[modelKey];
  const res   = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
  });

  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return data.content.find(b => b.type === "text")?.text ?? "";
}
