import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { virloSearchResult } from "@/lib/factory/trendSources";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MODEL = "claude-sonnet-4-6";

// Терпимый разбор JSON от модели: снимает ограждение, чинит висячие запятые,
// и при обрыве по лимиту достраивает закрывающие ] и } до баланса.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractJson(raw: string): any | null {
  let t = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const start = t.indexOf("{");
  if (start < 0) return null;
  t = t.slice(start);
  const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return undefined; } };
  let v = tryParse(t); if (v !== undefined) return v;
  // 1) убрать висячие запятые
  v = tryParse(t.replace(/,(\s*[}\]])/g, "$1")); if (v !== undefined) return v;
  // 2) обрыв по лимиту: отрезать до последней «;,}]"» и достроить скобки по балансу (вне строк)
  let depthCurly = 0, depthSq = 0, inStr = false, esc = false, lastSafe = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; if (!inStr) lastSafe = i; continue; }
    if (inStr) continue;
    if (c === "{") depthCurly++; else if (c === "}") { depthCurly--; lastSafe = i; }
    else if (c === "[") depthSq++; else if (c === "]") { depthSq--; lastSafe = i; }
    else if (c === "," || /[0-9eel.]/i.test(c)) lastSafe = i;
  }
  if (lastSafe > 0) {
    let cut = t.slice(0, lastSafe + 1).replace(/,(\s*)$/, "");
    // пересчитать баланс по обрезанному и закрыть
    let dc = 0, ds = 0, s2 = false, e2 = false;
    for (let i = 0; i < cut.length; i++) { const c = cut[i]; if (e2) { e2 = false; continue; } if (c === "\\") { e2 = true; continue; } if (c === '"') { s2 = !s2; continue; } if (s2) continue; if (c === "{") dc++; else if (c === "}") dc--; else if (c === "[") ds++; else if (c === "]") ds--; }
    cut += "]".repeat(Math.max(0, ds)) + "}".repeat(Math.max(0, dc));
    v = tryParse(cut.replace(/,(\s*[}\]])/g, "$1")); if (v !== undefined) return v;
  }
  return null;
}

// «Мозг маркетолога»: превращает сырую аналитику ниши (Virlo Orbit) в ПРОИЗВОДСТВЕННЫЙ плейбук,
// из которого пишут продюсер / промпт-инженер / сценарист. Это шаг ОБУЧЕНИЯ перед генерацией.
// Вход: job_id готового Orbit (тянем analysis+sounds сами) ИЛИ уже готовые analysis/sounds инлайном.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const niche: string = (body.niche || body.product_name || "").toString().trim();
  const jobId: string = (body.job_id || body.id || "").toString().trim();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let analysis: any = body.analysis || null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sounds: any[] = Array.isArray(body.sounds) ? body.sounds : [];

  if (jobId && (!analysis || !sounds.length)) {
    const [a, s] = await Promise.all([
      analysis ? Promise.resolve(null) : virloSearchResult(jobId, "analysis").catch(() => null),
      sounds.length ? Promise.resolve(null) : virloSearchResult(jobId, "sounds").catch(() => null),
    ]);
    if (a) analysis = a.data || a;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (s) sounds = ((s as any).data || s) as any[];
  }
  if (!analysis) return NextResponse.json({ error: "Нет аналитики ниши (передай job_id готового Orbit или analysis)" }, { status: 400 });

  const client = await createClaudeClient();
  if (!client) return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });

  // сжимаем вход, чтобы влезть в контекст: темы/тактики + только коммерчески-чистые звуки с метрикой
  const ad = analysis.analysis_data || analysis;
  const themes = (ad.themes || []).map((t: Record<string, unknown>) => ({
    name: t.name, video_count: t.video_count, confidence: t.confidence, why: t.why_it_works, tactics: t.tactics,
  }));
  const soundShort = (sounds || [])
    .map((s: Record<string, unknown>) => ({ id: s.id, title: s.title, commerce: s.is_commerce_music, usage: s.usage_count, avg_views: s.avg_views }))
    .sort((a, b) => (Number(b.avg_views) || 0) - (Number(a.avg_views) || 0))
    .slice(0, 8);

  const sys = `Ты — главный маркетолог контент-завода для карточек WB/Ozon. На входе — РЕАЛЬНАЯ аналитика залетевших коротких видео в нише (темы/форматы с метрикой + тренд-звуки). Преврати её в ПРОИЗВОДСТВЕННЫЙ плейбук, по которому продюсер выбирает формат, промпт-инженер собирает кадры, а сценарист пишет хук и текст.
ВАЖНО honest-правила: глянцевый AI-рендер товара САМ ПО СЕБЕ редко залетает органически — он читается как реклама. Его роль — ОДИН кадр-вставка/обложка внутри живого формата (распаковка, «что влезает», демонстрация руками, проблема-решение), а не целое видео. Учитывай это в render_role каждого формата.
Верни СТРОГО JSON:
{
 "niche": "коротко",
 "summary": "1-2 предложения: что реально заходит",
 "winning_formats": [{"name":"...","engagement":"высокий|средний","hook":"первая фраза 0-1 сек по-русски","beats":["кадр 1","кадр 2","кадр 3"],"needs_human":true|false,"render_role":"где тут AI-рендер: обложка|кадр-вставка|нет"}],
 "hooks": ["5-7 готовых хуков под нишу, по-русски"],
 "sounds": [{"title":"...","id":"...","commerce_safe":true,"note":"метрика"}],
 "anti_patterns": ["что НЕ делать (что выглядит рекламой/скучно)"],
 "cta": "призыв с артикулом WB",
 "render_strategy": "1 фраза: как использовать наш Kling/карусель-рендер в этой нише"
}
Только JSON, без преамбулы. 3-5 winning_formats, отсортируй по engagement.`;

  const user = `Ниша: ${niche || "(из данных)"}.
Темы/форматы (с метрикой): ${JSON.stringify(themes).slice(0, 3500)}
Виральные тактики: ${JSON.stringify(ad.viral_tactics || []).slice(0, 1200)}
Тайминг постинга: ${JSON.stringify(ad.timing_analysis || {}).slice(0, 300)}
Тренд-звуки (коммерч.=commerce, avg_views=средние просмотры): ${JSON.stringify(soundShort).slice(0, 1500)}
Собери плейбук.`;

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 3000, system: sys, messages: [{ role: "user", content: user }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    const playbook = extractJson(txt);
    if (!playbook) return NextResponse.json({ error: "пустой плейбук", raw: txt.slice(0, 150) }, { status: 502 });
    return NextResponse.json({ playbook });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
}
