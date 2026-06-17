import { NextRequest, NextResponse } from "next/server";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Видео-критик: оценивает кадры ролика зрением Claude и даёт балл + дефекты + правку для регена.
// Принимает frames: массив base64-JPEG (без префикса data:). Липсинк/звук по кадрам не судит — только визуал.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const frames: string[] = Array.isArray(body.frames) ? body.frames.slice(0, 6) : [];
  const context: string = (body.context || "").toString().slice(0, 400);
  const kind: string = body.kind === "avatar" ? "avatar" : "product"; // что за ролик
  if (!frames.length) return NextResponse.json({ error: "Нет кадров" }, { status: 400 });

  const client = await createClaudeClient();
  if (!client) return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });

  const sys = `Ты строгий ОТК видео-контента для карточек Wildberries. На входе — кадры одного короткого вертикального ролика. Оцени ВИЗУАЛ по кадрам (липсинк/звук не оценивай — их по кадрам не видно).
Тип ролика: ${kind === "avatar" ? "AI-аватар (говорящий блогер) — смотри на естественность лица, артефакты лица/рук, кадрирование, фон" : "анимация фото товара — смотри ГЛАВНОЕ: не искажён ли товар (деформация, расплывание, лишние объекты, неправильная форма/текст на упаковке), композиция, артефакты"}.
Критерии (1-10): товар/лицо целостны и реалистичны · нет артефактов/мусора · композиция и кадрирование · общий «не-ИИ» вид · пригодность как реклама.
Будь придирчив — это для продаж. Верни СТРОГО JSON: {"score":1-10,"verdict":"ok|rework|trash","issues":["конкретный дефект",...],"fixes":["что поправить при регене",...],"regen_hint":"одна короткая англ. фраза-добавка к промпту генерации, чтобы убрать главный дефект"}. Только JSON.`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [{ type: "text", text: `Контекст: ${context || "—"}. Оцени эти ${frames.length} кадра(ов) ролика.` }];
  for (const f of frames) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: f } });

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 700, system: sys, messages: [{ role: "user", content }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "пустой ответ критика", raw: txt.slice(0, 150) }, { status: 502 });
    const j = JSON.parse(m[0]);
    const sc = Number(j.score) || 5;
    return NextResponse.json({ score: sc, verdict: j.verdict || (sc >= 7 ? "ok" : sc >= 4 ? "rework" : "trash"), issues: j.issues || [], fixes: j.fixes || [], regen_hint: j.regen_hint || "" });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
}
