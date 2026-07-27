import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { formatAlert, formatStatus, runServerFinancialAnalysis, sendTelegramMessage } from "@/lib/opiu/telegramBot";
import { buildMarketplacePayoutForecast } from "@/lib/opiu/forecast";

export const maxDuration = 60;

interface TelegramUpdate {
  message?: {
    chat?: { id?: number };
    from?: { id?: number; first_name?: string; username?: string };
    text?: string;
  };
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
  const text = update.message?.text?.trim();
  const chatId = update.message?.chat?.id;
  if (!text || !chatId) return NextResponse.json({ ok: true });
  const allowedChat = process.env.FINANCE_TELEGRAM_CHAT_ID;
  if (!allowedChat) return NextResponse.json({ error: "Разрешённый Telegram-чат не настроен" }, { status: 503 });
  if (String(chatId) !== allowedChat) return NextResponse.json({ ok: true });

  try {
    const command = text.split(/\s+/)[0].toLowerCase().split("@")[0];
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
