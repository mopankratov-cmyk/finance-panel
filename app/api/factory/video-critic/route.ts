import { NextRequest, NextResponse } from "next/server";
import { CLAUDE_MODEL as MODEL, createClaudeClient } from "@/lib/agent/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Терпимый парсер: сначала пробует полный JSON, иначе вытаскивает поля из обрезанного ответа (max_tokens).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseLooseJson(txt: string): any | null {
  const m = txt.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* обрезан — ниже */ } }
  const score = txt.match(/"score"\s*:\s*(\d+(?:\.\d+)?)/);
  if (!score) return null; // совсем нет вердикта
  const verdict = txt.match(/"verdict"\s*:\s*"([^"]+)"/);
  const hint = txt.match(/"regen_hint"\s*:\s*"([^"]+)"/);
  const arr = (key: string): string[] => {
    const block = txt.match(new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)(\\]|$)`));
    if (!block) return [];
    return (block[1].match(/"([^"]+)"/g) || []).map((s) => s.replace(/^"|"$/g, ""));
  };
  return { score: Number(score[1]), verdict: verdict?.[1], issues: arr("issues"), fixes: arr("fixes"), regen_hint: hint?.[1] || "" };
}

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

  const sys = `Ты строгий ОТК видео-контента для карточек Wildberries. На входе — кадры одного короткого вертикального ролика.
${kind === "avatar"
    ? `Тип: AI-АВАТАР (говорящий блогер, HeyGen). ВНИМАНИЕ: ты видишь только СТАТИЧНЫЕ кадры — липсинк, движение губ, роботичность подачи и звук тебе НЕ видны, а именно там у аватаров главный брак. Поэтому суди СТРОГО и КОНСЕРВАТИВНО: при ЛЮБОМ намёке на «AI-запах» занижай балл. Признаки брака (каждый = балл ≤4): пластиковая/восковая кожа, мёртвые или асимметричные глаза, неестественная/застывшая мимика, кривой или «приклеенный» рот, артефакты зубов/губ, странные руки/пальцы, неестественная поза, дешёвый или нерелевантный фон, обрезанное/кривое кадрирование, общий синтетический вид. Аватар проходит (8-10) ТОЛЬКО если лицо безупречно реалистично и кадр не отличить от живой съёмки. Любые сомнения → 3-5. Не завышай балл из вежливости — на видео липсинк скорее всего ещё хуже, чем на кадре.`
    : `Тип: анимация фото товара — смотри ГЛАВНОЕ: не искажён ли товар (деформация, расплывание, лишние объекты, неправильная форма/текст на упаковке), композиция, артефакты. Липсинк/звук не оценивай.`}
Критерии (1-10): целостность и реализм · нет артефактов/мусора · композиция и кадрирование · общий «не-ИИ» вид · пригодность как реклама.
Будь придирчив — это для продаж. Верни СТРОГО JSON: {"score":1-10,"verdict":"ok|rework|trash","issues":["конкретный дефект",...],"fixes":["что поправить при регене",...],"regen_hint":"одна короткая англ. фраза-добавка к промпту генерации, чтобы убрать главный дефект"}. Только JSON.`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [{ type: "text", text: `Контекст: ${context || "—"}. Оцени эти ${frames.length} кадра(ов) ролика.` }];
  for (const f of frames) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: f } });

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 1024, system: sys, messages: [{ role: "user", content }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    txt = txt.replace(/```json\s*/gi, "").replace(/```/g, "").trim(); // снять markdown-ограждение
    const j = parseLooseJson(txt);
    if (!j) return NextResponse.json({ error: "пустой ответ критика", raw: txt.slice(0, 150) }, { status: 502 });
    const sc = Number(j.score) || 5;
    return NextResponse.json({ score: sc, verdict: j.verdict || (sc >= 7 ? "ok" : sc >= 4 ? "rework" : "trash"), issues: j.issues || [], fixes: j.fixes || [], regen_hint: j.regen_hint || "" });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
}
