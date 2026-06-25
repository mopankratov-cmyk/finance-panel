// R5 · Telegram-адаптер заводского бота (ОТДЕЛЬНЫЙ бот, не общий TELEGRAM_BOT_TOKEN).
// Шлёт оператору видео на ревью с кнопками ✓Беру/✕Не то; принимает голос-ревью (см. webhook).
// Ключи: FACTORY_TG_BOT_TOKEN + FACTORY_TG_CHAT_ID (владелец в Vercel). Мягкая деградация без них.

const token = (): string | null => process.env.FACTORY_TG_BOT_TOKEN || null;
export const tgOwnerChat = (): string | null => process.env.FACTORY_TG_CHAT_ID || null;
export const tgReady = (): boolean => !!token();

const API = (m: string) => `https://api.telegram.org/bot${token()}/${m}`;


async function tgApi(method: string, body: Record<string, unknown>): Promise<any> {
  if (!token()) return { ok: false, error: "FACTORY_TG_BOT_TOKEN не настроен" };
  try {
    const r = await fetch(API(method), { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
    return await r.json().catch(() => ({ ok: false, error: `telegram ${r.status}: не JSON` }));
  } catch (e) { return { ok: false, error: String((e as Error)?.message || e).slice(0, 120) }; }
}

// Inline-кнопки ревью. callback_data кодирует рецепт: win:<id> / rej:<id>.
function reviewKeyboard(recipeId: number) {
  return { inline_keyboard: [[
    { text: "✓ Беру", callback_data: `win:${recipeId}` },
    { text: "✕ Не то", callback_data: `rej:${recipeId}` },
  ]] };
}

// Отправить ролик на ревью. В подпись вшиваем #r<id> — чтобы голосовой ОТВЕТ можно было смаппить на рецепт.
export async function tgSendReview(videoUrl: string, caption: string, recipeId: number, chatId?: string) {
  const chat = chatId || tgOwnerChat();
  if (!chat) return { ok: false, error: "FACTORY_TG_CHAT_ID не настроен" };
  const cap = `${caption}\n\n#r${recipeId} · ответь голосом «ок/не ок + что не так» или кнопкой`.slice(0, 1024);
  return tgApi("sendVideo", { chat_id: chat, video: videoUrl, caption: cap, reply_markup: reviewKeyboard(recipeId) });
}

export async function tgSendMessage(text: string, chatId?: string) {
  const chat = chatId || tgOwnerChat();
  if (!chat) return { ok: false, error: "нет chat_id" };
  return tgApi("sendMessage", { chat_id: chat, text: text.slice(0, 4000) });
}

export async function tgAnswerCallback(callbackQueryId: string, text: string) {
  return tgApi("answerCallbackQuery", { callback_query_id: callbackQueryId, text: text.slice(0, 200) });
}

// URL файла (голосового) для скачивания/whisper: getFile → file_path → file-API URL (содержит токен).
export async function tgFileUrl(fileId: string): Promise<string | null> {
  const j = await tgApi("getFile", { file_id: fileId });
  const path = j?.result?.file_path;
  return path ? `https://api.telegram.org/file/bot${token()}/${path}` : null;
}

// Секрет вебхука — выводим из токена (без нового env). Telegram шлёт его в заголовке
// X-Telegram-Bot-Api-Secret-Token → проверяем, что вызов реально от Telegram.
export const tgWebhookSecret = (): string => ((token() || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(-32) || "factory-fallback");

// Регистрация вебхука (владелец дёргает 1 раз после деплоя с прод-URL). НЕ в гит — токен из env.
export async function tgSetWebhook(baseUrl: string) {
  return tgApi("setWebhook", { url: `${baseUrl.replace(/\/$/, "")}/api/factory/telegram`, allowed_updates: ["message", "callback_query"], secret_token: tgWebhookSecret() });
}
