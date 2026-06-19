import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { virloSearchResult } from "@/lib/factory/trendSources";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { nicheFromArticle } from "@/lib/factory/rubric";

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
  v = tryParse(t.replace(/,(\s*[}\]])/g, "$1")); if (v !== undefined) return v; // висячие запятые
  // обрыв по лимиту: пройти со стеком скобок (учитывая строки) и достроить хвост
  const stack: string[] = []; let inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }
  let s = t;
  if (inStr) s += '"';                          // закрыть оборванную строку
  s = s.replace(/\s+$/, "");
  s = s.replace(/,\s*"[^"]*"\s*:\s*$/, "");      // ,"ключ": без значения
  s = s.replace(/\{\s*"[^"]*"\s*:\s*$/, "{");    // {"ключ": без значения
  s = s.replace(/,\s*$/, "");                    // висячая запятая
  for (let i = stack.length - 1; i >= 0; i--) s += stack[i] === "{" ? "}" : "]";
  s = s.replace(/,(\s*[}\]])/g, "$1");
  return tryParse(s) ?? null;
}

// «Мозг маркетолога»: превращает сырую аналитику ниши (Virlo Orbit) в ПРОИЗВОДСТВЕННЫЙ плейбук,
// из которого пишут продюсер / промпт-инженер / сценарист. Это шаг ОБУЧЕНИЯ перед генерацией.
// Вход: job_id готового Orbit (тянем analysis+sounds сами) ИЛИ уже готовые analysis/sounds инлайном.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const niche: string = (body.niche || body.product_name || "").toString().trim();
  const jobId: string = (body.job_id || body.id || "").toString().trim();
  const article: string = (body.article || "").toString().trim(); // нужен для согласованной нормализации ниши с sync-orbit

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
 "winning_formats": [{"name":"...","engagement":"высокий|средний","hook":"первая фраза 0-1 сек по-русски","hook_type":"pattern_break|curiosity_gap|surprise|problem|demo","beats":["кадр 1","кадр 2","кадр 3"],"structure_by_seconds":"0-2 хук → 2-5 … → 5-10 … → payoff","retention_mechanism":"чем держит досмотр","psycho_trigger":"эмоция/триггер (shock|curiosity|flex|calm)","attention_break_point":"где перелом внимания","needs_human":true|false,"render_role":"где тут AI-рендер: обложка|кадр-вставка|нет"}],
 "hooks": ["5-7 готовых хуков под нишу, по-русски"],
 "sounds": [{"title":"...","id":"...","commerce_safe":true,"note":"метрика"}],
 "anti_patterns": ["что НЕ делать (что выглядит рекламой/скучно)"],
 "cta": "призыв с артикулом WB",
 "render_strategy": "1 фраза: как использовать наш Kling/карусель-рендер в этой нише"
}
Верни ГОЛЫЙ JSON без markdown-ограждения и без преамбулы. Будь компактным: 3-4 winning_formats, beats ≤3 коротких, hooks ровно 5. Отсортируй форматы по engagement.`;

  // грунтовка на корпусе: реальные примеры залетевшего из viral_videos/viral_hooks (таблицы могут ещё не существовать)
  let corpusBlock = "";
  try {
    const db = getSupabaseAdmin();
    if (db) {
      const rn = nicheFromArticle(article, niche);
      const [vv, vh] = await Promise.all([
        db.from("viral_videos").select("hook_text,format_detected,beat_structure,virality_score").eq("niche", rn).order("virality_score", { ascending: false }).limit(5),
        db.from("viral_hooks").select("hook_text").eq("niche", rn).order("viability_score", { ascending: false }).limit(8),
      ]);
      const vids = (vv.data as Record<string, unknown>[] | null) ?? [];
      const hks = ((vh.data as { hook_text: string }[] | null) ?? []).map((r) => r.hook_text).filter(Boolean);
      if (vids.length || hks.length) {
        corpusBlock = `\nРЕАЛЬНЫЙ КОРПУС (наши данные — строй НА ЭТОМ): ` +
          (hks.length ? `\nЗалетевшие хуки ниши: ${hks.map((h) => `«${h}»`).join(" | ")}` : "") +
          (vids.length ? `\nТоп-видео (hook · формат · beats): ${JSON.stringify(vids.map((v) => ({ hook: v.hook_text, format: v.format_detected, beats: v.beat_structure }))).slice(0, 1800)}` : "");
      }
    }
  } catch { /* корпуса ещё нет — плейбук строится только на Orbit */ }

  const user = `Ниша: ${niche || "(из данных)"}.
Темы/форматы (с метрикой): ${JSON.stringify(themes).slice(0, 3500)}
Виральные тактики: ${JSON.stringify(ad.viral_tactics || []).slice(0, 1200)}
Тайминг постинга: ${JSON.stringify(ad.timing_analysis || {}).slice(0, 300)}
Тренд-звуки (коммерч.=commerce, avg_views=средние просмотры): ${JSON.stringify(soundShort).slice(0, 1500)}${corpusBlock}
Собери плейбук.`;

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 4000, system: sys, messages: [{ role: "user", content: user }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    const playbook = extractJson(txt);
    if (!playbook) return NextResponse.json({ error: "пустой плейбук", raw: txt.slice(0, 150) }, { status: 502 });
    // ID звуков не доверяем модели (галлюцинирует UUID) — подставляем точные по названию из данных
    if (Array.isArray(playbook.sounds)) {
      const byTitle = new Map(soundShort.map((s) => [String(s.title || "").toLowerCase().trim(), s]));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      playbook.sounds = playbook.sounds.map((p: any) => {
        const src = byTitle.get(String(p?.title || "").toLowerCase().trim());
        return src ? { ...p, id: src.id, commerce_safe: !!src.commerce } : p;
      });
    }
    const rn = nicheFromArticle(article, niche);
    // best-effort: проверенные хуки плейбука → viral_hooks — чтобы хук-турнир калибровался
    try {
      const db = getSupabaseAdmin();
      if (db && Array.isArray(playbook.hooks) && playbook.hooks.length) {
        const hooks = (playbook.hooks as unknown[]).map((h) => String(h || "").trim()).filter(Boolean).slice(0, 10);
        const { data: existing } = await db.from("viral_hooks").select("hook_text").eq("niche", rn).limit(300);
        const have = new Set(((existing as { hook_text: string }[] | null) ?? []).map((r) => r.hook_text));
        const fresh = hooks.filter((h) => !have.has(h)).map((h) => ({ niche: rn, hook_text: h, viability_score: 1, effectiveness_notes: "from playbook" }));
        if (fresh.length) await db.from("viral_hooks").insert(fresh);
      }
    } catch { /* корпуса ещё нет / не критично */ }

    // best-effort: сохраняем скомпилированный плейбук в niche_playbooks → фоновая очередь может читать его без браузера
    try {
      const db = getSupabaseAdmin();
      if (db && rn) {
        await db.from("niche_playbooks").upsert({
          niche: rn, article: article || null, orbit_job_id: jobId || null,
          playbook, orbit_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }, { onConflict: "niche" });
      }
    } catch { /* niche_playbooks не применена / не критично */ }

    return NextResponse.json({ playbook });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
}
