import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const MODEL = "claude-sonnet-4-6";

// Самообучение: критик нашёл дефекты → Claude переписывает промпт генерации, чтобы их убрать.
// Ветки: video (i2v) — английский motion-промпт; nano_edit (source-prep) — английский edit-промпт
// (усиливаем Constraints, не трогая Lock); иначе — русский монолог/текст.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const original: string = (body.original || "").toString().trim();
  const defects: string[] = Array.isArray(body.defects) ? body.defects : [];
  const fixes: string[] = Array.isArray(body.fixes) ? body.fixes : [];
  const route: string = (body.route || "ai_generation_ref").toString();
  const engine: string = (body.engine || "seedance").toString().toLowerCase();
  const context: string = (body.context || "").toString().slice(0, 200);
  if (!defects.length && !fixes.length) return NextResponse.json({ error: "нет дефектов" }, { status: 400 });

  const client = await createClaudeClient();
  if (!client) return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });

  // nano_edit — реген ИСХОДНОГО кадра (source-prep), а не движения; engine nano/seedream тоже сюда
  const isNanoEdit = route === "nano_edit" || engine.includes("nano") || engine.includes("seedream");
  const isVideo = !isNanoEdit && (route === "ai_generation_ref" || route === "ai_generation");
  // Engine-specific guidance: Seedance holds product shape best with slow drift/light motion;
  // Kling responds better to explicit preservation tokens; Higgsfield is atmosphere/lifestyle only.
  const engineNote = engine.includes("seedance")
    ? "Движок — Seedance (отлично держит форму товара). Предпочитай медленное/плавное движение (slow drift, gentle sway, subtle zoom). Не усиливай скорость или трансформацию — именно они ломают товар."
    : engine.includes("higgsfield")
    ? "Движок — Higgsfield (лайфстайл/атмосфера, НЕ крупный товар). Не упоминай товар вплотную — только среда/настроение."
    : "Движок — Kling. Явно включи токены preservation: «product stable and intact throughout, no shape change, crisp edges».";
  const sys = isNanoEdit
    ? `Ты edit-промпт-инженер для Nano Banana (Gemini Flash Image) через fal. ОТК нашёл дефект на ИСХОДНОМ кадре (искажён/обрезан лого, обрезан товар, грязный фон, паразитный релайт). Усиль секцию Constraints edit-промпта так, чтобы дефект ушёл, НЕ трогая Lock (форма/лого/текст/цвет товара неизменны) и сохранив структуру Lock→Change→Amount→Constraints. Секцию Lock из исходного промпта сохрани ДОСЛОВНО (если её нет — реконструируй из перечисленных якорей товара). Пример: дефект «лого искажён» → добавь «keep the logo razor-sharp, legible and uncropped, identical to source». НИКОГДА не пиши «remove watermark/logo/text» — пре-фильтр вернёт MALFORMED_FUNCTION_CALL; формулируй СОЗИДАТЕЛЬНО («recreate clean … showing ONLY», «keep …»). Один тип изменения за раз. Верни ТОЛЬКО английский edit-промпт, без преамбулы.`
    : isVideo
    ? `Ты промпт-инженер для image-to-video. Перепиши motion-промпт (АНГЛИЙСКИЙ), чтобы устранить найденные дефекты, СОХРАНИВ товар точным (форма/лейбл/пропорции/цвет — не менять). ${engineNote} Верни ТОЛЬКО улучшенный английский промпт, без преамбулы.`
    : "Ты редактор. Перепиши текст/монолог, чтобы устранить дефекты, сохранив живой русский UGC-тон. Верни ТОЛЬКО улучшенный текст, без преамбулы.";
  const user = `Товар/контекст: ${context}. Исходный промпт: «${original}». Дефекты от ОТК: ${defects.join("; ")}. Что поправить: ${fixes.join("; ")}. Перепиши промпт, чтобы дефекты ушли.`;

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 400, system: sys, messages: [{ role: "user", content: user }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    if (!txt) return NextResponse.json({ error: "пусто" }, { status: 502 });
    return NextResponse.json({ prompt: txt.replace(/^["«]|["»]$/g, "").trim() });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 150) }, { status: 502 });
  }
}
