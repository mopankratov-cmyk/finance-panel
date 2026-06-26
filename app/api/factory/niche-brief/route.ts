import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createClaudeClient } from "@/lib/agent/client";
import { nicheFromArticle } from "@/lib/factory/rubric";
import { extractJson } from "@/lib/factory/extractJson";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MODEL = "claude-sonnet-4-6";
const FRESH_MS = 7 * 24 * 3600 * 1000; // бриф свеж 7 дней (как недельный corpus-cron)

// §14 V3 Маркетолог-агент: полный разбор ниши для карты осознания.
//   GET ?niche=X | ?article=Y [&product_name=] [&refresh=1]
//   → NicheBrief { summary, top_formats[], content_recommendations[], distribution[], viral_examples[], updated_at }
// Агрегирует НАШ корпус (viral_videos/viral_hooks) + niche_playbooks → LLM сводит. Кеш в niche_briefs.
// Всегда JSON (обработчик в try/catch). Веб-ресёрч — позже (сейчас сигнал = корпус, надёжнее).

function fallbackBrief(niche: string, reason: string, sources: Record<string, unknown> = {}) {
  return {
    ok: true,
    niche,
    brief: {
      summary: "Бриф временно собран без маркетолог-агента. Для MVP можно продолжать: выбери товар, собери один понятный сценарий и проверь выпуск MP4.",
      top_formats: [
        { name: "проблема → демонстрация → итог", why: "самый устойчивый короткий формат для проверки пайплайна", example_video_url: "" },
        { name: "живой тест руками", why: "меньше AI-риска и понятнее польза товара", example_video_url: "" },
      ],
      content_recommendations: [
        { type: "видео", format: "один товар, один хук, один визуальный proof", rationale: "сейчас важнее стабильный прогон, чем широкий fan-out" },
        { type: "статик", format: "карточка с одним тезисом", rationale: "можно использовать как fallback-креатив без дорогого видео" },
      ],
      distribution: [
        { platform: "Reels/TikTok/VK Клипы", cadence: "после успешного MP4", note: "сначала добейся стабильной сборки, потом сравнивай площадки" },
      ],
      viral_examples: [],
      updated_at: new Date().toISOString(),
    },
    sources,
    cached: false,
    fallback: true,
    warning: reason,
  };
}

async function buildBrief(niche: string) {
  const db = getSupabaseAdmin();
  if (!db) return fallbackBrief(niche, "Supabase не настроен — показан fallback-бриф");

  // 1) собрать сырьё из корпуса + плейбука
  const [vvR, vhR, pbR] = await Promise.all([
    db.from("viral_videos").select("url,caption,views,virality_score,hook_text,format_detected,sound_title,is_commerce_safe").eq("niche", niche).order("virality_score", { ascending: false, nullsFirst: false }).limit(14),
    db.from("viral_hooks").select("hook_text,viability_score").eq("niche", niche).order("viability_score", { ascending: false }).limit(12),
    db.from("niche_playbooks").select("playbook").eq("niche", niche).limit(1),
  ]);
  const vids = (vvR.data as Record<string, unknown>[] | null) || [];
  const hooks = ((vhR.data as { hook_text: string }[] | null) || []).map((r) => r.hook_text).filter(Boolean);
  const playbook = (pbR.data as { playbook: unknown }[] | null)?.[0]?.playbook || null;

  if (!vids.length && !hooks.length && !playbook) {
    return fallbackBrief(niche, "нет данных по нише — синкни орбиты или собери плейбук", { videos: 0, hooks: 0, playbook: false, sounds: 0 });
  }

  // топ-звуки из корпуса (по частоте появления в залетевших видео)
  const soundFreq = new Map<string, { title: string; commerce: boolean; count: number }>();
  for (const v of vids) {
    const t = String(v.sound_title || "").trim();
    if (!t) continue;
    const cur = soundFreq.get(t) || { title: t, commerce: !!v.is_commerce_safe, count: 0 };
    cur.count++; soundFreq.set(t, cur);
  }
  const topSounds = [...soundFreq.values()].sort((a, b) => b.count - a.count).slice(0, 6);

  const sources = { videos: vids.length, hooks: hooks.length, playbook: !!playbook, sounds: topSounds.length };

  const client = await createClaudeClient();
  if (!client) return fallbackBrief(niche, "ANTHROPIC_API_KEY не настроен — показан fallback-бриф", sources);

  const sys = `Ты — главный маркетолог контент-завода для карточек WB/Ozon. На входе РЕАЛЬНЫЙ корпус ниши (залетевшие видео конкурентов с метрикой + проверенные хуки + при наличии скомпилированный плейбук). Сделай ПОЛНЫЙ РАЗБОР НИШИ для владельца: что реально заходит, какие форматы, какой контент делать и КУДА его дистрибутировать.
ВАЖНО (honest): глянцевый AI-рендер товара целым роликом читается как реклама. Лучшие форматы — живые (распаковка/POV/проблема-решение/до-после/демо руками), AI = акцент/вставка. Рекомендации опирай на РЕАЛЬНЫЕ примеры из корпуса, не на теорию.
Верни СТРОГО JSON без преамбулы и markdown:
{
 "summary": "3-5 предложений: что реально заходит в нише и почему",
 "top_formats": [{"name":"...","why":"почему заходит","example_video_url":"url из корпуса или пусто"}],
 "content_recommendations": [{"type":"видео|карусель|статик","format":"конкретный формат","rationale":"зачем именно он"}],
 "distribution": [{"platform":"Reels|TikTok|VK Клипы|Shorts","cadence":"как часто","note":"что учесть на площадке"}],
 "viral_examples": [{"url":"из корпуса","score":число,"why":"чем зацепило"}]
}
3-5 top_formats, 3-5 content_recommendations, 2-4 distribution, до 6 viral_examples (бери реальные url с наибольшим virality_score). Только JSON.`;

  const corpusJson = JSON.stringify(vids.map((v) => ({ url: v.url, caption: typeof v.caption === "string" ? v.caption.slice(0, 180) : null, views: v.views, score: v.virality_score, hook: v.hook_text, format: v.format_detected }))).slice(0, 3800);
  const user = `Ниша: ${niche}.
Залетевшие видео (url · подпись · просмотры · score · хук · формат): ${corpusJson}
Проверенные хуки ниши: ${hooks.slice(0, 12).map((h) => `«${h}»`).join(" | ") || "—"}
Топ-звуки корпуса: ${JSON.stringify(topSounds) || "—"}
Скомпилированный плейбук (если есть): ${playbook ? JSON.stringify(playbook).slice(0, 2200) : "—"}
Собери полный маркетинговый разбор ниши.`;

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 3000, system: sys, messages: [{ role: "user", content: user }] });

    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    const brief = extractJson(txt);
    if (!brief || !brief.summary) return fallbackBrief(niche, "маркетолог не вернул бриф", sources);
    brief.updated_at = new Date().toISOString();
    // кеш
    try { await db.from("niche_briefs").upsert({ niche, brief, sources, updated_at: brief.updated_at }, { onConflict: "niche" }); } catch { /* таблица не применена — отдадим без кеша */ }
    return { ok: true, niche, brief, sources, cached: false };
  } catch (e) {
    return fallbackBrief(niche, "claude niche-brief: " + String((e as Error)?.message || e).slice(0, 160), sources);
  }
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    const sp = req.nextUrl.searchParams;
    const article = (sp.get("article") || "").trim();
    const productName = (sp.get("product_name") || "").trim();
    let niche = (sp.get("niche") || "").trim();
    if (!niche && article) niche = nicheFromArticle(article, productName);
    if (!niche) return NextResponse.json({ error: "нужен niche или article" }, { status: 400 });
    if (!db) return NextResponse.json(fallbackBrief(niche, "Supabase не настроен — показан fallback-бриф"), { headers: { "Cache-Control": "no-store" } });

    // кеш-хит (если свежий и не refresh)
    if (sp.get("refresh") !== "1") {
      try {
        const { data } = await db.from("niche_briefs").select("brief,sources,updated_at").eq("niche", niche).limit(1);
        const row = (data as { brief: Record<string, unknown>; sources: unknown; updated_at: string }[] | null)?.[0];
        if (row && Date.now() - new Date(row.updated_at).getTime() < FRESH_MS) {
          return NextResponse.json({ ok: true, niche, brief: row.brief, sources: row.sources, cached: true }, { headers: { "Cache-Control": "no-store" } });
        }
      } catch { /* нет таблицы — строим заново */ }
    }

    const r = await buildBrief(niche);
    const status = (r as { status?: number }).status || ((r as { error?: string }).error ? 400 : 200);
    return NextResponse.json(r, { status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json(fallbackBrief("default", "бриф ниши упал: " + String((e as Error)?.message || e).slice(0, 180)), { headers: { "Cache-Control": "no-store" } });
  }
}
