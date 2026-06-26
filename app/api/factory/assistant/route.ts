import { NextRequest } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MODEL = "claude-sonnet-4-6";

// §16 V3 «Проводник» — живой ИИ-ассистент нод-студии. На каждом экране видит
//   состояние (ctx-дайджест из S) и ведёт пользователя за руку: что сделать дальше
//   и ПОЧЕМУ. POST { ctx, messages[] } → стрим text/plain (токен за токеном).
//   Детерминированный «следующий шаг» считает фронт мгновенно; сюда идут только
//   свободные вопросы → экономим токены, не дёргаем Claude на каждый клик.

// Карта студии — чтобы проводник давал точную навигацию, а не общие слова.
const STUDIO_MAP = `НОД-СТУДИЯ собирает виральные видео для карточек WB/Ozon. 8 экранов, ядро — поток 01→05:
01 Командный центр (center): выбор НИШИ слева → справа бриф маркетолога (что реально заходит в нише). Отсюда уходят в формат/конкурентов.
02 Анализ конкурентов (compete): лента ВИРУСНЫХ видео конкурентов (сверху — по виральности). Клик по видео → Claude раскладывает его на типизированные НОДЫ (хук/сцена/пейофф/титры/звук) — это скелет ролика.
03 Нод-канвас (canvas): граф нод. Проверить порядок (хук→сцены→пейофф), добавить/убрать ноды. Клик по ноде → инспектор.
04 Инспектор ноды (inspector): на каждой ноде выбрать ИНСТРУМЕНТ (claude/seedance/kling/creatify/shotstack/disk_real/sound), заполнить поля, сгенерить ПРЕВЬЮ. Эвристика: детальная игрушка/реальное фото → seedance; простое/жёсткое движение → kling; живой актёр/UGC → creatify.
05 Сборка · ОТК (assembly): авто-раскладка нод на таймлайн → запуск сборки → ОТК оценивает по 5 осям (хук/удержание/нативность/бренд/CTA). Хук<7 → вернуться на ноду хука.
06 База видосов (library): галерея готовых видео + сохранённые рецепты (графы-шаблоны).
07 Балансы сервисов (balances): остатки $ по API (claude/seedance/kling/creatify/shotstack/fal).
DS Дизайн-система: справочник токенов (служебный).`;

function sysPrompt(ctx: unknown): string {
  return `Ты — «Проводник» нод-студии контент-завода. Твоя задача: чтобы человек ПОНИМАЛ, как работает система, и всегда знал следующий шаг.

${STUDIO_MAP}

ТЕКУЩЕЕ СОСТОЯНИЕ (что у пользователя прямо сейчас): ${JSON.stringify(ctx)}

Правила:
— Отвечай по-русски, коротко и по делу (обычно 2-5 предложений). Без воды, без «как ИИ я…».
— Опирайся на ТЕКУЩЕЕ СОСТОЯНИЕ: называй конкретный экран/ноду/инструмент, а не общие фразы.
— Всегда давай следующее КОНКРЕТНОЕ действие и коротко ПОЧЕМУ оно нужно (логика завода).
— Когда уместно — называй экран по номеру («иди на 02», «вернись на 04»), это помогает навигации.
— Если спрашивают «что делать» — веди по потоку 01→05. Если творческий вопрос (хук/инструмент/формат) — дай конкретную рекомендацию с обоснованием из логики виральности.
— Не выдумывай данные, которых нет в состоянии. Не обещай действий, которые сам не выполняешь, — ты советник, кнопки жмёт человек.`;
}

type Msg = { role: "user" | "assistant"; content: string };

function txt(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}

export async function POST(req: NextRequest) {
  try {
  let body: { ctx?: unknown; messages?: unknown } = {};
  try { body = await req.json(); } catch { /* пустое тело — ниже отдадим подсказку */ }

  const ctx = body.ctx ?? {};
  const messages: Msg[] = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m): m is Msg => !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "")
    .slice(-10)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));

  if (!messages.length) return txt("Спроси что угодно про этот экран — подскажу следующий шаг.");

  const client = await createClaudeClient();
  if (!client) return txt("⚠ Проводник офлайн: ANTHROPIC_API_KEY не настроен.");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let emitted = false;
      try {
        const s = await client.messages.create({ model: MODEL, max_tokens: 700, system: sysPrompt(ctx), messages, stream: true });

        for await (const ev of s as any) {
          if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
            controller.enqueue(encoder.encode(ev.delta.text)); emitted = true;
          }
        }
      } catch (e) {
        // SSE-стрим рвётся на некоторых egress (РФ-локалка/прокси), хотя обычный POST к Anthropic работает.
        // Если ещё ничего не отдали — ОДИН retry БЕЗ stream: Проводник отвечает целиком, а не «Connection error».
        if (!emitted) {
          try {
            const r = await client.messages.create({ model: MODEL, max_tokens: 700, system: sysPrompt(ctx), messages });

            const t = (r.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join("");
            if (t) { controller.enqueue(encoder.encode(t)); emitted = true; }
          } catch { /* и не-стрим не вышел — отдадим ошибку ниже */ }
        }
        if (!emitted) controller.enqueue(encoder.encode("\n⚠ сбой проводника: " + String((e as Error)?.message || e).slice(0, 140)));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
  } catch (e) {
    return txt("⚠ ассистент завода упал: " + String((e as Error)?.message || e).slice(0, 160), 500);
  }
}
