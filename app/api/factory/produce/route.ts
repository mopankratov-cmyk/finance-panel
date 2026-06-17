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

ВАЖНО (проверено ОТК на наших рендерах):
- AI-анимация фото (Higgsfield image-to-video) ЧАСТО ИСКАЖАЕТ форму/упаковку товара — превращает в другой предмет. НЕ годится, когда нужен точный реальный товар в кадре.
- AI-аватар (HeyGen) — говорящая голова БЕЗ товара в руках; товар показывается только речью/обложкой.
- Карусель (реальное фото карточки WB + текст) — товар НЕ искажается, самый надёжный, высокий ROI на WB.

Доступные МАРШРУТЫ:
- "slideshow" — слайды/карусель: реальное фото товара + текст. ✅ НАДЁЖНО. Лучший дефолт, чтобы показать сам товар.
- "ai_avatar" — говорящий AI-аватар (talking-head UGC, HeyGen ✅). Для «рассказывает/отзыв». Товар — в речи + обложкой.
- "ai_generation" — AI-видео из сценария (Higgsfield ✅). ТОЛЬКО атмосфера/лайфстайл, где точная форма товара НЕ в фокусе. НЕ для показа товара.
- "repurpose_cut" — нарезка из ГОТОВОЙ реальной съёмки товара.
- "real_ugc" — реальный креатор (дорого/долго).

ПРАВИЛА выбора (приоритет сверху):
1. Формат talking-head/«рассказывает/отзыв» → ai_avatar.
2. Есть реальная съёмка товара → repurpose_cut.
3. Нужно ПОКАЗАТЬ сам товар (распаковка/до-после/демо/обзор) → slideshow (товар точный). НЕ ai_generation.
4. Только чистая атмосфера без точного товара → ai_generation.
5. Сомневаешься для WB-товара → slideshow.
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
