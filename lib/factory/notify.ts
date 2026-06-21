// Уведомление владельцу завода. Переиспользуем Telegram-бота (@mkt_aibot, TELEGRAM_BOT_TOKEN).
// Цель: TELEGRAM_ALERT_CHAT_ID (личка владельца) или TELEGRAM_CHANNEL как fallback.
// Инертно без токена/чата → sent:false (алерт всё равно громко виден в дашборде красным бейджем).
export async function notifyOwner(text: string): Promise<{ sent: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_ALERT_CHAT_ID || process.env.TELEGRAM_CHANNEL || "";
  if (!token) return { sent: false, error: "TELEGRAM_BOT_TOKEN не настроен" };
  if (!chat) return { sent: false, error: "нет чата (TELEGRAM_ALERT_CHAT_ID / TELEGRAM_CHANNEL)" };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
    });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    return j.ok ? { sent: true } : { sent: false, error: `Telegram: ${j.description || r.status}` };
  } catch (e) {
    return { sent: false, error: String(e).slice(0, 140) };
  }
}
