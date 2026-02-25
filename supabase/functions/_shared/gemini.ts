export async function callGemini(
  prompt:    string,
  maxTokens = 500,
): Promise<string> {
  const apiKey = Deno.env.get("GOOGLE_AI_KEY") ?? "";
  if (!apiKey) throw new Error("Missing GOOGLE_AI_KEY");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        contents:       [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    },
  );

  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = await res.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  return data.candidates[0]?.content?.parts[0]?.text ?? "";
}
