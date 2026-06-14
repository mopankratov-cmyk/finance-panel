import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MODEL = "claude-sonnet-4-6";

// Агент-Продюсер: по идее/сценарию + тренду + наличию материалов решает СПОСОБ производства.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const idea: string = (body.idea || body.hook || body.scenario || "").toString().trim();
  if (!idea) return NextResponse.json({ error: "Нужна идея/сценарий" }, { status: 400 });
  const product: string = (body.product || body.article || "").toString().trim();
  const trend: string = (body.trend_format || "").toString().trim();
  const av = body.available || {};
  const availability = `есть фото товара: ${av.photos ? "да" : "нет/неизвестно"}; есть реальная видеосъёмка: ${av.footage ? "да" : "нет"}; AI-аватар разрешён: ${av.avatar === false ? "нет" : "да"}`;

  const client = await createClaudeClient();
  if (!client) return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });

  const sys = `Ты — Продюсер контент-завода. Решаешь, КАК произвести короткое видео под идею, чтобы получить максимум охвата и доверия при минимуме затрат.

Доступные МАРШРУТЫ производства и инструменты:
- "slideshow" — слайды/карусель (фото товара + текст). Дёшево, высокий ROI на WB. Инструменты: наша лаба (Higgsfield/fal) + редактор текста. ✅ есть у нас.
- "ai_generation" — полная AI-генерация видео из сценария. Для лайфстайла/сцен без съёмки. Инструменты: Higgsfield/fal ✅; премиум — Veo 3.1 (кинематограф+звук), Kling 3.0 (дёшево ~$0.10/с, липсинк).
- "repurpose_cut" — нарезка из ГОТОВОГО (реальная съёмка товара/стримы/длинные видео → шортсы). Самый аутентичный и дешёвый, если материал есть. Инструменты: Klap (открытый API), OpusClip (virality score).
- "ai_avatar" — говорящий AI-аватар читает скрипт (talking-head UGC). Инструменты: Arcads (UGC-актёры), HeyGen (клон+голос), Shhots (ecom, строит вокруг фото товара).
- "real_ugc" — заказать реальному креатору (макс. доверие, дорого/долго).

ПРАВИЛА выбора:
1. Если тренд-формат — talking head/«девушка рассказывает» → ai_avatar (или real_ugc).
2. Если есть реальная съёмка товара и формат это позволяет → repurpose_cut (аутентичность > AI, дёшево).
3. Если демо/распаковка/до-после без съёмки → ai_generation (но товар держать правдиво) или slideshow.
4. Слайд-шоу/текст-на-фото — самый дешёвый и часто лучший по ROI старт; предлагай как быстрый вариант.
5. Для ГЛАВНОЙ точной карточки товара — реальное фото/съёмка, не чистая генерация.
Верни СТРОГО JSON: {"route":"slideshow|ai_generation|repurpose_cut|ai_avatar|real_ugc","tool":"конкретный инструмент","why":"почему этот маршрут (кратко)","needs":"что нужно для этого (материалы/доступы)","alt_route":"запасной маршрут","cost":"low|medium|high"}. Только JSON.`;

  const user = `Идея/сценарий: «${idea}». Товар: ${product || "—"}. Тренд-формат: ${trend || "не указан"}. Что есть: ${availability}. Реши способ производства.`;

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 600, system: sys, messages: [{ role: "user", content: user }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "пустое решение" }, { status: 502 });
    return NextResponse.json({ decision: JSON.parse(m[0]) });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
}
