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

МАРШРУТЫ И ИХ КАЧЕСТВО (проверено ОТК на наших рендерах — балл из 10):
- "slideshow" (8/10 ✅) — карусель/слайдшоу: реальное фото товара + текст + движение. Товар НЕ искажается. Лучший дефолт для надёжного ПОКАЗА товара (распаковка, listicle, до/после, демо, tutorial).
- "ai_generation_ref" (7/10 ✅) — ДИНАМИЧНОЕ видео из фото товара (Kling i2v, FAL). Реальное движение камеры/сцены, товар в основном держится. Бери, когда нужна именно ДИНАМИКА/«живой» кадр товара, премиум hero-shot, POV с движением.
- "ai_avatar" (6/10) — говорящий AI-аватар (HeyGen). Для «рассказывает/отзыв/founder/GRWM». Товара в руках нет — он в речи + обложкой.
- "ai_generation" (атмосфера) — Higgsfield i2v. ТОЛЬКО абстрактная атмосфера/лайфстайл БЕЗ узнаваемого товара (он искажает товар — 3/10). Не для показа товара.
- "repurpose_cut" — нарезка из ГОТОВОЙ реальной съёмки товара (если материал есть).
- "real_ugc" — реальный креатор-человек (макс. доверие, дорого/долго).

ПРАВИЛА выбора (по рубрике/сценарию):
1. «Рассказывает / отзыв / founder / GRWM / talking-head» → ai_avatar.
2. Есть реальная съёмка товара → repurpose_cut.
3. Нужна ДИНАМИКА товара (живой кадр, движение, премиум hero, эффектный POV) → ai_generation_ref (Kling — держит товар).
4. Надёжный ПОКАЗ товара (распаковка/listicle/до-после/демо/tutorial), важна точность > движение → slideshow.
5. Чистая атмосфера БЕЗ конкретного товара → ai_generation.
6. Сомневаешься → slideshow (безопасно) или ai_generation_ref (если хочется видео-движения).
Верни СТРОГО JSON: {"route":"slideshow|ai_generation_ref|ai_avatar|ai_generation|repurpose_cut|real_ugc","tool":"конкретный инструмент","why":"кратко","needs":"что нужно","alt_route":"запасной","cost":"low|medium|high"}. Только JSON.`;

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
