import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { virloSearchResult } from "@/lib/factory/trendSources";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MODEL = "claude-sonnet-4-6";

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
    const res = await client.messages.create({ model: MODEL, max_tokens: 1600, system: sys, messages: [{ role: "user", content: user }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    txt = txt.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "пустой плейбук", raw: txt.slice(0, 150) }, { status: 502 });
    const playbook = JSON.parse(m[0]);
    return NextResponse.json({ playbook });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
}
