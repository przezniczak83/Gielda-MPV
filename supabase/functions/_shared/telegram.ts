export async function sendTelegram(message: string): Promise<boolean> {
  const token  = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID")   ?? "";
  if (!token || !chatId) return false;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          chat_id:    chatId,
          text:       message,
          parse_mode: "Markdown",
        }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
