import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { formatAlert, formatStatus, runServerFinancialAnalysis, sendTelegramMessage } from "@/lib/opiu/telegramBot";
import { buildMarketplacePayoutForecast } from "@/lib/opiu/forecast";
import { recognizePaymentAnswer } from "@/lib/opiu/paymentAnswerRecognition";
import { DDS_CATEGORIES } from "@/lib/finance/categories";
import { selectPendingTelegramPayment } from "@/lib/opiu/telegramPaymentReply";

export const maxDuration = 60;

interface TelegramUpdate {
  message?: {
    message_id?: number;
    chat?: { id?: number };
    from?: { id?: number; first_name?: string; username?: string };
    text?: string;
    voice?: { file_id?: string; duration?: number; file_size?: number };
    reply_to_message?: { message_id?: number };
  };
}

const REVIEW_CATEGORIES = [...DDS_CATEGORIES];

async function transcribeTelegramVoice(fileId: string) {
  const telegramToken = process.env.FINANCE_TELEGRAM_BOT_TOKEN;
  const polzaKey = process.env.POLZA_AI_API_KEY || process.env.POLZA_API_KEY;
  if (!telegramToken) throw new Error("FINANCE_TELEGRAM_BOT_TOKEN не настроен");
  if (!polzaKey) throw new Error("Для голосовых ответов не настроен POLZA_AI_API_KEY");
  const fileInfoResponse = await fetch(`https://api.telegram.org/bot${telegramToken}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const fileInfo = await fileInfoResponse.json().catch(() => null) as { result?: { file_path?: string } } | null;
  const filePath = fileInfo?.result?.file_path;
  if (!fileInfoResponse.ok || !filePath) throw new Error("Telegram не вернул голосовой файл");
  const audioResponse = await fetch(`https://api.telegram.org/file/bot${telegramToken}/${filePath}`);
  if (!audioResponse.ok) throw new Error("Не удалось скачать голосовой ответ из Telegram");
  const audio = Buffer.from(await audioResponse.arrayBuffer());
  if (!audio.length || audio.length > 20 * 1024 * 1024) throw new Error("Голосовой ответ пустой или слишком большой");
  const response = await fetch("https://polza.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${polzaKey}` },
    body: JSON.stringify({
      file: `data:audio/ogg;base64,${audio.toString("base64")}`,
      model: "openai/whisper-1",
      language: "ru",
      response_format: "json",
    }),
  });
  const result = await response.json().catch(() => null) as { text?: string; error?: { message?: string } } | null;
  if (!response.ok || !result?.text?.trim()) throw new Error(result?.error?.message || "Не удалось распознать голосовой ответ");
  return result.text.trim();
}

async function handlePaymentReply(text: string, replyMessageId: number | undefined, chatId: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("База не настроена");
  const pending = await db.from("bank_review_items")
    .select("id,date,amount,purpose,counterparty,company_id,account_id,reasons")
    .eq("status", "waiting_manager")
    .limit(5_000);
  if (pending.error) throw new Error(pending.error.message);
  const rows = pending.data ?? [];
  if (rows.length === 0) return false;
  const item = selectPendingTelegramPayment(rows, replyMessageId);
  if (!item) {
    await sendTelegramMessage("Сейчас ответа ждут несколько платежей. Нажмите «Ответить» именно на сообщение с нужной суммой и датой — тогда я свяжу пояснение автоматически.", chatId);
    return true;
  }
  const companies = await db.from("companies").select("id,name").eq("is_active", true);
  if (companies.error) throw new Error(companies.error.message);
  const recognition = await recognizePaymentAnswer({
    answer: text,
    amount: Number(item.amount),
    purpose: item.purpose ?? "",
    counterparty: item.counterparty ?? "",
    currentCompanyId: item.company_id,
    companies: companies.data ?? [],
    categories: REVIEW_CATEGORIES,
  });
  const sourceCompanyId = item.company_id || recognition.companyId;
  const needsClarification = recognition.confidence < 0.85 || !recognition.category || !sourceCompanyId;
  if (needsClarification) {
    const clarification = recognition.clarification || (!sourceCompanyId
      ? "Для какого юридического лица был этот платёж?"
      : "Уточните, пожалуйста, за какой именно товар или услугу был платёж.");
    const messageId = await sendTelegramMessage(`🤔 ${clarification}`, chatId, { forceReply: true });
    const reasons = Array.isArray(item.reasons)
      ? item.reasons.map(String).filter((reason) => !reason.startsWith("__telegram_message_id:"))
      : [];
    if (messageId) reasons.push(`__telegram_message_id:${messageId}`);
    const updated = await db.from("bank_review_items").update({
      manager_answer: text,
      manager_question: clarification,
      reasons,
      status: "waiting_manager",
    }).eq("id", item.id).eq("status", "waiting_manager");
    if (updated.error) throw new Error(updated.error.message);
    return true;
  }
  const reasons = Array.isArray(item.reasons)
    ? [...item.reasons.map(String).filter((reason) => !reason.startsWith("__telegram_message_id:")), `Ответ руководителя распознан: ${recognition.explanation}`]
    : [`Ответ руководителя распознан: ${recognition.explanation}`];
  const status = item.account_id ? "ready" : "needs_info";
  const updated = await db.from("bank_review_items").update({
    manager_answer: text,
    // Юрлицо банковского счёта нельзя заменять юрлицом, упомянутым в ответе.
    // Получателя/направление пользователь назначает отдельным частям проводки.
    company_id: sourceCompanyId,
    category: recognition.category,
    reasons,
    status,
  }).eq("id", item.id).eq("status", "waiting_manager");
  if (updated.error) throw new Error(updated.error.message);
  await sendTelegramMessage("✅ Ответ распознан и передан финансовому специалисту на окончательную проверку.", chatId);
  return true;
}

const help = [
  "🤖 <b>Финансовый помощник</b>",
  "/status — финансовое состояние",
  "/alerts — серьёзные отклонения",
  "/recalculate — пересчитать прогноз и предупреждения",
  "/tasks — последние задачи руководителя",
  "Любое другое сообщение будет сохранено как задача финансовой команде.",
].join("\n");

export async function POST(request: Request) {
  const webhookSecret = process.env.FINANCE_TELEGRAM_WEBHOOK_SECRET;
  if (!webhookSecret || request.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret) {
    return NextResponse.json({ error: "Нет доступа" }, { status: 401 });
  }
  const update = await request.json() as TelegramUpdate;
  const chatId = update.message?.chat?.id;
  if (!chatId) return NextResponse.json({ ok: true });
  const allowedChat = process.env.FINANCE_TELEGRAM_CHAT_ID;
  if (!allowedChat) return NextResponse.json({ error: "Разрешённый Telegram-чат не настроен" }, { status: 503 });
  if (String(chatId) !== allowedChat) return NextResponse.json({ ok: true });

  try {
    let text = update.message?.text?.trim() ?? "";
    if (!text && update.message?.voice?.file_id) {
      if ((update.message.voice.duration ?? 0) > 180 || (update.message.voice.file_size ?? 0) > 20 * 1024 * 1024) {
        throw new Error("Голосовой ответ длиннее 3 минут или больше 20 МБ");
      }
      text = await transcribeTelegramVoice(update.message.voice.file_id);
    }
    if (!text) return NextResponse.json({ ok: true });
    const replyMessageId = update.message?.reply_to_message?.message_id;
    if (replyMessageId) {
      await handlePaymentReply(text, replyMessageId, String(chatId));
      return NextResponse.json({ ok: true });
    }
    const command = text.split(/\s+/)[0].toLowerCase().split("@")[0];
    if (!command.startsWith("/")) {
      if (await handlePaymentReply(text, undefined, String(chatId))) return NextResponse.json({ ok: true });
    }
    if (command === "/start" || command === "/help") {
      await sendTelegramMessage(help, String(chatId));
    } else if (command === "/status" || command === "/recalculate") {
      if (command === "/recalculate") {
        const now = new Date();
        await buildMarketplacePayoutForecast(now.getFullYear(), now.getMonth() + 1, { forceRecalculate: true });
      }
      const result = await runServerFinancialAnalysis({ notify: command === "/recalculate" });
      await sendTelegramMessage(formatStatus(result), String(chatId));
    } else if (command === "/alerts") {
      const result = await runServerFinancialAnalysis();
      await sendTelegramMessage(
        result.alerts.length ? result.alerts.map(formatAlert).join("\n\n") : "✅ Критических финансовых отклонений нет.",
        String(chatId),
      );
    } else if (command === "/tasks") {
      const db = getSupabaseAdmin();
      if (!db) throw new Error("База не настроена");
      const { data, error } = await db.from("finance_tasks").select("text,status,created_at").order("created_at", { ascending: false }).limit(10);
      if (error) throw new Error(error.message);
      const taskText = data?.length
        ? data.map((task, index) => `${index + 1}. ${task.text} — ${task.status}`).join("\n")
        : "Задач пока нет.";
      await sendTelegramMessage(`📝 <b>Последние задачи</b>\n${taskText}`, String(chatId));
    } else if (command === "/pay") {
      const [, code = "", ...answerParts] = text.split(/\s+/);
      const answer = answerParts.join(" ").trim();
      if (!/^[0-9a-f-]{6,36}$/i.test(code) || !answer) {
        await sendTelegramMessage("Формат ответа: <code>/pay код пояснение платежа</code>", String(chatId));
      } else {
        const db = getSupabaseAdmin();
        if (!db) throw new Error("База не настроена");
        const matches = await db.from("bank_review_items")
          .select("id")
          .ilike("id", `${code}%`)
          .eq("status", "waiting_manager")
          .limit(2);
        if (matches.error) throw new Error(matches.error.message);
        if ((matches.data ?? []).length !== 1) {
          await sendTelegramMessage("Не удалось однозначно найти ожидающий платёж по этому коду.", String(chatId));
        } else {
          const updated = await db.from("bank_review_items").update({
            manager_answer: answer,
            status: "needs_info",
          }).eq("id", matches.data![0].id).eq("status", "waiting_manager");
          if (updated.error) throw new Error(updated.error.message);
          await sendTelegramMessage("✅ Ответ сохранён. Платёж вернулся финансовому специалисту на проверку.", String(chatId));
        }
      }
    } else {
      const db = getSupabaseAdmin();
      if (!db) throw new Error("База не настроена");
      const { error } = await db.from("finance_tasks").insert({
        text,
        status: "new",
        source: "telegram",
        telegram_user_id: update.message?.from?.id ?? null,
        author_name: update.message?.from?.username ?? update.message?.from?.first_name ?? "Руководитель",
      });
      if (error) throw new Error(error.message);
      await sendTelegramMessage("✅ Задача сохранена. Финансовая команда увидит её в панели.", String(chatId));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    await sendTelegramMessage(`Не удалось выполнить команду: ${error instanceof Error ? error.message : "неизвестная ошибка"}`, String(chatId)).catch(() => undefined);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
