import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { extractJson } from "@/lib/factory/extractJson";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MODEL = "claude-sonnet-4-6";

function fallbackDecision(input: { available: Record<string, unknown>; reason: string }) {
  const route = input.available?.footage ? "repurpose_cut" : "slideshow";
  return {
    decision: {
      route,
      engine: "",
      why: `producer fallback: ${input.reason}`,
      needs: route === "repurpose_cut" ? "готовое видео товара" : "фото товара и сценарий",
      alt_route: "slideshow",
      cost: "low",
    },
  };
}

// Агент-Продюсер: по идее/сценарию + тренду + наличию материалов решает СПОСОБ производства.
export async function POST(req: NextRequest) {
  try {
  const body = await req.json().catch(() => ({}));
  const idea: string = (body.idea || body.hook || body.scenario || "").toString().trim();
  if (!idea) return NextResponse.json({ error: "Нужна идея/сценарий" }, { status: 400 });
  const product: string = (body.product || body.article || "").toString().trim();
  const trend: string = (body.trend_format || "").toString().trim();
  const pb = body.playbook && typeof body.playbook === "object" ? body.playbook : null;
  // выжимка плейбука ниши: какие форматы реально заходят + роль AI-рендера (обложка/вставка/нет)
  const pbHint = pb
    ? `\nПЛЕЙБУК НИШИ (выбери формат из РЕАЛЬНО залетающих):\n` +
      (Array.isArray(pb.winning_formats) ? pb.winning_formats.slice(0, 5).map((f: Record<string, unknown>) => `• ${f.name} [engagement: ${f.engagement || "?"}; нужен человек: ${f.needs_human ? "да" : "нет"}; роль рендера: ${f.render_role || "?"}]`).join("\n") : "") +
      `\nПРАВИЛО: если у подходящего формата render_role = "нет" или начинается с "кадр-вставка"/"обложка" — НЕ делай AI-видео целым роликом (route ≠ ai_generation_ref), бери slideshow/repurpose_cut/real_ugc (рендер пойдёт обложкой/вставкой). ai_generation_ref только если render_role прямо допускает видео целиком.`
    : "";
  const av = body.available || {};
  const availability = `есть фото товара: ${av.photos ? "да" : "нет/неизвестно"}; есть реальная видеосъёмка: ${av.footage ? "да" : "нет"}`;

  const client = await createClaudeClient();
  if (!client) return NextResponse.json(fallbackDecision({ available: av, reason: "ANTHROPIC_API_KEY не настроен" }));

  const sys = `Ты — Продюсер контент-завода. Решаешь, КАК произвести короткое видео под идею, чтобы получить максимум охвата и доверия при минимуме затрат.

ПРИНЦИП (важно): глянцевый AI-рендер товара ЦЕЛЫМ роликом читается как реклама и даёт AI-слоп — товар плывёт. Реальный материал = ХРЕБЕТ ролика; AI = только акцент/обложка/вставка. Лента любит движение, но «движущийся рекламный рендер» ≠ органика.

МАРШРУТЫ И ИХ КАЧЕСТВО (проверено ОТК на наших рендерах — балл из 10):
- "repurpose_cut" — монтаж из ГОТОВОЙ реальной видео-съёмки товара. ЛУЧШИЙ: живой человек+товар, ноль слопа, не реклама. Дефолт, если есть реальное видео.
- "slideshow" (8/10 ✅) — реальное ФОТО товара + кинетический текст + структура. Товар НЕ искажается, не «глянец-реклама». Дефолт для показа товара, когда нет видео-съёмки (распаковка, listicle, до/после, демо, «что влезает»).
- "ai_generation_ref" — ДИНАМИЧНОЕ видео из фото товара (FAL i2v). РЕДКО, не дефолт (см. правила). Поле "engine":
   • "seedance" (7-8/10) — лучше всех держит форму И текст/лого. Бери, когда i2v всё же нужен ИЛИ для AI-кадра-ВСТАВКИ с точным товаром.
   • "kling" (7/10) — эффектный hero-наезд на жёсткой форме (сумка/флакон).
   • "pika" (5/10, СЛАБЫЙ) — РЕДКО, только живая мягкая сцена без текста.
- "ai_generation" (атмосфера) — Higgsfield i2v. ТОЛЬКО атмосфера/лайфстайл/кино-движение БЕЗ узнаваемого товара (крупный товар искажает — 3/10). Роль — обложка/вставка-настроение, не показ товара.
- "real_ugc" — реальный креатор-человек или AI-актёр (Лагерь B: актёр-голова + реальный товар-b-roll). Макс. доверие.

ПРАВИЛА выбора (ПРИОРИТЕТ — РЕАЛЬНЫЙ материал; AI ≠ целый ролик):
1. «Рассказывает/отзыв/founder/GRWM/talking-head» → real_ugc. AI-аватары как «говорящая голова целиком» НЕ используем; реальный товар идёт b-roll.
2. Есть реальная ВИДЕО-съёмка товара → repurpose_cut (ДЕФОЛТ). Самый надёжный, ноль слопа.
3. Нет видео, есть реальное ФОТО товара → slideshow (ДЕФОЛТ для показа товара). Реальный товар, не плывёт, не «глянец».
4. "ai_generation_ref" (Seedance целым роликом) — РЕДКО: только когда render_role плейбука ПРЯМО допускает видео целиком И нет реального материала. НЕ дефолт.
5. AI-рендер как ОБЛОЖКА/ВСТАВКА (1 кадр внутри slideshow/repurpose) — допустимо всегда: seedance для точного товара, ai_generation/Higgsfield для атмосферы БЕЗ крупного товара.
6. Чистая атмосфера/лайфстайл БЕЗ конкретного товара → ai_generation (Higgsfield, кино-движение).
7. Сомневаешься → slideshow (реальное фото надёжнее AI-видео; ОТК отфильтрует, фолбэк безопасен).
Верни СТРОГО JSON: {"route":"slideshow|ai_generation_ref|ai_generation|repurpose_cut|real_ugc","engine":"seedance|kling|pika (ТОЛЬКО если route=ai_generation_ref, иначе пусто)","why":"кратко","needs":"что нужно","alt_route":"запасной","cost":"low|medium|high"}. Только JSON.`;

  const user = `Идея/сценарий: «${idea}». Товар: ${product || "—"}. Тренд-формат: ${trend || "не указан"}. Что есть: ${availability}.${pbHint} Реши способ производства.`;

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 600, system: sys, messages: [{ role: "user", content: user }] });

    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    const decision = extractJson(txt);
    if (!decision) return NextResponse.json(fallbackDecision({ available: av, reason: "пустое/нечитаемое решение продюсера" }));
    return NextResponse.json({ decision });
  } catch (e) {
    return NextResponse.json(fallbackDecision({ available: av, reason: String(e).slice(0, 160) }));
  }
  } catch (e) {
    return NextResponse.json({
      error: "производство ролика упало: " + String((e as Error)?.message || e).slice(0, 160),
      ...fallbackDecision({ available: {}, reason: "сбой роутера продюсера" }),
    }, { status: 500 });
  }
}
