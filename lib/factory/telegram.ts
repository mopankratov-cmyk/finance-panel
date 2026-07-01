// R5 · Telegram-адаптер заводского бота (ОТДЕЛЬНЫЙ бот, не общий TELEGRAM_BOT_TOKEN).
// Шлёт оператору видео на ревью с кнопками ✓Беру/✕Не то; принимает голос-ревью (см. webhook).
// Ключи: FACTORY_TG_BOT_TOKEN + FACTORY_TG_CHAT_ID (владелец в Vercel). Мягкая деградация без них.

import { readFile } from "node:fs/promises";
import path from "node:path";

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

async function tgMultipart(method: string, form: FormData): Promise<any> {
  if (!token()) return { ok: false, error: "FACTORY_TG_BOT_TOKEN не настроен" };
  try {
    const r = await fetch(API(method), { method: "POST", body: form, cache: "no-store", signal: AbortSignal.timeout(45000) });
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

function voiceReviewKeyboard(batchId: string, candidateId: string, index: number) {
  return { inline_keyboard: [[
    { text: `✓ №${index} лучший`, callback_data: `vwin:${batchId}:${index}:${candidateId}` },
  ]] };
}

export async function tgSendAudioReviewItem(input: {
  batchId: string;
  index: number;
  candidateId: string;
  caption?: string;
  audioUrl?: string;
  filePath?: string;
  chatId?: string;
}) {
  const chat = input.chatId || tgOwnerChat();
  if (!chat) return { ok: false, error: "нет chat_id" };
  const caption = [
    `№${input.index} · ${input.candidateId}`,
    `#voicebatch_${input.batchId} #v${input.index}`,
    input.caption || "",
    "Ответь цифрой на список или нажми кнопку.",
  ].filter(Boolean).join("\n").slice(0, 1024);
  const reply_markup = voiceReviewKeyboard(input.batchId, input.candidateId, input.index);

  if (input.audioUrl) {
    return tgApi("sendAudio", { chat_id: chat, audio: input.audioUrl, caption, reply_markup });
  }
  if (!input.filePath) return { ok: false, error: "нужен audioUrl или filePath" };

  const buffer = await readFile(input.filePath);
  const form = new FormData();
  form.set("chat_id", chat);
  form.set("caption", caption);
  form.set("reply_markup", JSON.stringify(reply_markup));
  form.set("audio", new Blob([buffer], { type: "audio/mpeg" }), path.basename(input.filePath));
  return tgMultipart("sendAudio", form);
}

export async function tgSendVoiceReviewBatch(input: {
  batchId: string;
  title: string;
  items: Array<{ candidateId: string; caption?: string; audioUrl?: string; filePath?: string }>;
  chatId?: string;
}) {
  const chat = input.chatId || tgOwnerChat();
  if (!chat) return { ok: false, error: "нет chat_id" };
  const list = input.items.map((item, index) => `${index + 1}. ${item.candidateId}${item.caption ? ` — ${item.caption}` : ""}`).join("\n");
  const intro = [
    `Голосовой shortlist: ${input.title}`,
    `#voicebatch_${input.batchId}`,
    "",
    list,
    "",
    "Ответь на это сообщение номером лучшего: например 1 или 1,3.",
  ].join("\n").slice(0, 4000);
  const introResult = await tgSendMessage(intro, chat);
  const sent = [];
  for (let i = 0; i < input.items.length; i++) {
    sent.push(await tgSendAudioReviewItem({
      batchId: input.batchId,
      index: i + 1,
      candidateId: input.items[i].candidateId,
      caption: input.items[i].caption,
      audioUrl: input.items[i].audioUrl,
      filePath: input.items[i].filePath,
      chatId: chat,
    }));
  }
  return { ok: sent.every((result) => result?.ok), intro: introResult, sent };
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
