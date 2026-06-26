import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { virloSearchResult } from "@/lib/factory/trendSources";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { nicheFromArticle } from "@/lib/factory/rubric";
import { extractJson } from "@/lib/factory/extractJson";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MODEL = "claude-sonnet-4-6";

function fallbackPlaybook(niche: string, reason: string) {
  return {
    playbook: {
      niche: niche || "default",
      summary: `fallback playbook: ${reason}`,
      winning_formats: [
        {
          name: "simple product slideshow",
          engagement: "средний",
          hook: "Вот что важно заметить",
          hook_type: "problem",
          beats: ["первый кадр с товаром", "2-3 детали пользы", "мягкий CTA"],
          structure_by_seconds: "0-2 хук → 2-10 детали → 10-15 CTA",
          retention_mechanism: "быстрые смены деталей",
          psycho_trigger: "curiosity",
          attention_break_point: "после первой пользы",
          needs_human: false,
          render_role: "нет",
        },
      ],
      hooks: ["Вот что важно заметить", "Не покупай, пока не увидишь это", "Одна деталь меняет всё", "Почему это удобно каждый день", "Проверь перед заказом"],
      sounds: [],
      anti_patterns: ["глянцевый AI-ролик целиком", "длинное вступление", "абстрактная реклама"],
      cta: "Ищи артикул на WB",
      render_strategy: "Использовать slideshow из реальных фото; AI только как вставка/обложка.",
      warnings: [reason],
    },
  };
}

// «Мозг маркетолога»: превращает сырую аналитику ниши (Virlo Orbit) в ПРОИЗВОДСТВЕННЫЙ плейбук,
// из которого пишут продюсер / промпт-инженер / сценарист. Это шаг ОБУЧЕНИЯ перед генерацией.
// Вход: job_id готового Orbit (тянем analysis+sounds сами) ИЛИ уже готовые analysis/sounds инлайном.
export async function POST(req: NextRequest) {
  try {
  const body = await req.json().catch(() => ({}));
  const niche: string = (body.niche || body.product_name || "").toString().trim();
  const jobId: string = (body.job_id || body.id || "").toString().trim();
  const article: string = (body.article || "").toString().trim(); // нужен для согласованной нормализации ниши с sync-orbit


  let analysis: any = body.analysis || null;

  let sounds: any[] = Array.isArray(body.sounds) ? body.sounds : [];

  if (jobId && (!analysis || !sounds.length)) {
    const [a, s] = await Promise.all([
      analysis ? Promise.resolve(null) : virloSearchResult(jobId, "analysis").catch(() => null),
      sounds.length ? Promise.resolve(null) : virloSearchResult(jobId, "sounds").catch(() => null),
    ]);
    if (a) analysis = a.data || a;

    if (s) sounds = ((s as any).data || s) as any[];
  }
  // Orbit-аналитики может не быть (data_intelligence выключен / orbit без анализа). Тогда строим из НАШЕГО
  // корпуса: viral_videos (реальные залетевшие видео ниши) + viral_hooks. 182 видео достаточно для плейбука —
  // их описания/метрики уходят в corpusBlock ниже, а themes остаются пустыми (синтетический плейсхолдер).
  if (!analysis) {
    try {
      const db0 = getSupabaseAdmin();
      if (db0) {
        const rn0 = nicheFromArticle(article, niche);
        const { count } = await db0.from("viral_videos").select("id", { count: "exact", head: true }).eq("niche", rn0);
        if ((count ?? 0) > 0) analysis = { themes: [], viral_tactics: [], timing_analysis: {}, _from_corpus: true };
      }
    } catch { /* корпус недоступен */ }
  }
  if (!analysis) return NextResponse.json(fallbackPlaybook(niche, "Нет данных ниши: ни Orbit-аналитики, ни видео в корпусе"));

  const client = await createClaudeClient();
  if (!client) return NextResponse.json(fallbackPlaybook(niche, "ANTHROPIC_API_KEY не настроен"));

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
        db.from("viral_videos").select("hook_text,format_detected,caption,views,virality_score").eq("niche", rn).order("virality_score", { ascending: false, nullsFirst: false }).limit(12),
        db.from("viral_hooks").select("hook_text").eq("niche", rn).order("viability_score", { ascending: false }).limit(10),
      ]);
      const vids = (vv.data as Record<string, unknown>[] | null) ?? [];
      const hks = ((vh.data as { hook_text: string }[] | null) ?? []).map((r) => r.hook_text).filter(Boolean);
      if (vids.length || hks.length) {
        corpusBlock = `\nРЕАЛЬНЫЙ КОРПУС (наши данные — строй НА ЭТОМ): ` +
          (hks.length ? `\nЗалетевшие хуки ниши: ${hks.map((h) => `«${h}»`).join(" | ")}` : "") +
          (vids.length ? `\nТоп залетевших видео ниши (описание · просмотры · hook/формат если разобран): ${JSON.stringify(vids.map((v) => ({ caption: typeof v.caption === "string" ? v.caption.slice(0, 200) : null, views: v.views, hook: v.hook_text, format: v.format_detected }))).slice(0, 3000)}` : "");
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

    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    const playbook = extractJson(txt);
    if (!playbook) return NextResponse.json(fallbackPlaybook(niche, "пустой плейбук"));
    // ID звуков не доверяем модели (галлюцинирует UUID) — подставляем точные по названию из данных
    if (Array.isArray(playbook.sounds)) {
      const byTitle = new Map(soundShort.map((s) => [String(s.title || "").toLowerCase().trim(), s]));

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
    return NextResponse.json(fallbackPlaybook(niche, String(e).slice(0, 160)));
  }
  } catch (e) {
    return NextResponse.json({
      error: "плейбук ниши упал: " + String((e as Error)?.message || e).slice(0, 160),
      ...fallbackPlaybook("", "сбой сборки плейбука"),
    }, { status: 500 });
  }
}
