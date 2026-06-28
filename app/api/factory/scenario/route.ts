import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { DEAI_FILTERS, PROBLEM_STACK } from "@/lib/factory/standard";
import { brandProfile } from "@/lib/factory/brandProfiles";
import { nicheFromArticle } from "@/lib/factory/rubric";
import { extractJson } from "@/lib/factory/extractJson";
import { buildPlatformBrainHint, normalizeTargetPlatform } from "@/lib/factory/reelsBrainPlaybook";
import { winnersHintFor } from "@/lib/factory/learningHints";
import { buildProducerBlueprint } from "@/lib/factory/producerBlueprint";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6"; // быстрый, укладываемся в лимит

function fallbackScenario(input: { hook: string; article: string; name: string; reason: string }) {
  const product = input.name || input.article || "товар";
  return {
    article: input.article,
    product,
    scenario: {
      title: input.hook.slice(0, 80) || `Короткий ролик про ${product}`,
      duration_sec: 18,
      shots: [
        { t: "0-3с", visual: "Крупный план товара или первый живой кадр использования", voiceover: input.hook || `Смотри, что важно знать про ${product}`, onscreen: input.hook || "Вот что важно" },
        { t: "3-10с", visual: "Показать 2-3 детали товара в движении", voiceover: "Коротко показать пользу и реальный сценарий использования", onscreen: "Польза без лишних слов" },
        { t: "10-18с", visual: "Финальный кадр с товаром и понятным действием", voiceover: "Если актуально, ищи артикул на Wildberries", onscreen: input.article ? `Арт. ${input.article}` : "Ищи на WB" },
      ],
      caption: input.article ? `Ищи на WB: ${input.article}` : "Сохрани, чтобы не потерять",
      hashtags: ["#wildberries", "#обзор", "#находка"],
      cta: input.article ? `Ищи артикул ${input.article} на WB` : "Ищи товар на WB",
      music: "спокойный трендовый звук без вокального конфликта",
      warnings: [`scenario fallback: ${input.reason}`],
    },
  };
}

// Развернуть идею-хук в полный покадровый сценарий короткого видео (готов к съёмке/монтажу).
export async function POST(req: NextRequest) {
  try {
  const body = await req.json().catch(() => ({}));
  const hook: string = (body.hook || body.concept || "").toString().trim();
  if (!hook) return NextResponse.json({ error: "Нужен хук/идея" }, { status: 400 });
  const article: string = (body.article || "").toString().trim();
  let name: string = (body.product_name || "").toString().trim();
  if (!name && article) {
    const db = getSupabaseAdmin();
    if (db) { const { data } = await db.from("product_costs").select("name").eq("article", article).maybeSingle(); name = (data?.name as string) || ""; }
  }
  const format: string = (body.format || "").toString().trim();
  const targetPlatform = normalizeTargetPlatform(body.target_platform || body.platform);
  // профиль не задан вручную → подбираем по БРЕНДУ товара (1 бренд = 1 профиль)
  const profile: string = (body.profile || "").toString().trim().slice(0, 2000) || brandProfile(article, name);
  const pb = body.playbook && typeof body.playbook === "object" ? body.playbook : null;
  // из плейбука ниши: проверенные хуки + покадровая структура лучшего формата + тренд-звук
  let pbHint = "";
  if (pb) {

    const fmts: any[] = Array.isArray(pb.winning_formats) ? pb.winning_formats : [];
    const chosen = fmts.find((f) => format && String(f.name || "").toLowerCase().includes(format.toLowerCase())) || fmts[0];
    const snd = Array.isArray(pb.sounds) ? pb.sounds.find((s: Record<string, unknown>) => s.commerce_safe) || pb.sounds[0] : null;
    pbHint =
      `\nПЛЕЙБУК НИШИ (опирайся на РЕАЛЬНО залетающее):` +
      (Array.isArray(pb.hooks) && pb.hooks.length ? `\nРабочие хуки-образцы: ${pb.hooks.slice(0, 5).join(" | ")}` : "") +
      (chosen
        ? `\nФормат «${chosen.name}»:` +
          (chosen.structure_by_seconds ? ` Структура по секундам: ${chosen.structure_by_seconds}.` : ` Биты: ${(chosen.beats || []).join(" → ")}.`) +
          (chosen.hook ? ` Первый кадр-хук: ${chosen.hook}.` : "") +
          (chosen.retention_mechanism ? ` Механизм удержания: ${chosen.retention_mechanism}.` : "") +
          (chosen.psycho_trigger ? ` Психо-триггер: ${chosen.psycho_trigger}.` : "") +
          (chosen.attention_break_point ? ` Перелом внимания: ${chosen.attention_break_point}.` : "") +
          (chosen.render_role && chosen.render_role !== "нет" ? ` AI-рендер: ${chosen.render_role} (не целый ролик!).` : "")
        : "") +
      (Array.isArray(pb.anti_patterns) && pb.anti_patterns.length ? `\nНЕ делай: ${pb.anti_patterns.slice(0, 4).join("; ")}` : "") +
      (snd ? `\nТренд-звук под нишу: «${snd.title}»${snd.commerce_safe ? " (коммерч-безопасен)" : " (только органика, не для рекламы)"} — укажи его в поле music.` : "") +
      buildPlatformBrainHint(pb, targetPlatform) +
      (pb.cta ? `\nCTA: ${pb.cta}` : "");
  }

  // Корпус вирального: грунтовка на реально залетевших видео/хуках/звуках ниши (таблицы могут не существовать).
  // Работает из фоновой очереди — не требует playbook (который только в браузере).
  let corpusHint = "";
  let winnersHint = "";
  if (!pb && article) {
    try {
      const dbC = getSupabaseAdmin();
      const rn = nicheFromArticle(article, name);
      if (dbC && rn) {
        winnersHint = await winnersHintFor(dbC, rn, targetPlatform);
        const [{ data: vids }, { data: hks }, { data: orbits }] = await Promise.all([
          dbC.from("viral_videos").select("hook_text,format_detected,beat_structure,platform").eq("niche", rn).order("virality_score", { ascending: false }).limit(6),
          dbC.from("viral_hooks").select("hook_text").eq("niche", rn).order("viability_score", { ascending: false }).limit(6),
          dbC.from("orbit_searches").select("sounds").eq("niche", rn).not("sounds", "is", null).limit(3),
        ]);
        const vidLines = ((vids || []) as { hook_text?: string; format_detected?: string; beat_structure?: unknown; platform?: string }[])
          .filter((v) => normalizeTargetPlatform(v.platform) === targetPlatform)
          .filter((v) => v.hook_text || v.beat_structure)
          .map((v) => `• «${v.hook_text || "?"}» [${v.format_detected || ""}${v.beat_structure ? " / " + JSON.stringify(v.beat_structure).slice(0, 80) : ""}]`)
          .slice(0, 3)
          .join("\n");
        const hkLine = ((hks || []) as { hook_text: string }[]).map((h) => `«${h.hook_text}»`).join(" | ");
        // top commerce-safe звук из synced орбит этой ниши
        let sndHint = "";
        try {
          const sounds = (orbits || []).flatMap((o: { sounds: unknown }) => Array.isArray(o.sounds) ? o.sounds as Record<string, unknown>[] : [])
            .filter((s) => typeof s.is_commerce_safe !== "boolean" || s.is_commerce_safe)
            .sort((a, b) => (Number(b.avg_views) || 0) - (Number(a.avg_views) || 0));
          if (sounds[0]?.title) sndHint = `\nТоп звук ниши (commerce-safe): «${sounds[0].title}»${sounds[0].avg_views ? ` (avg ${Math.round(Number(sounds[0].avg_views) / 1000)}K просм.)` : ""} — укажи его в поле music.`;
        } catch { /* */ }
        if (vidLines || hkLine) {
          corpusHint =
            "\n\nКОРПУС ЗАЛЕТЕВШЕГО В НИШЕ (реальные примеры — повтори дух/структуру в первом кадре):" +
            (vidLines ? "\n" + vidLines : "") +
            (hkLine ? "\nПроверенные хуки: " + hkLine : "") +
            sndHint;
        }
      }
    } catch { /* corpus optional */ }
  }

  const client = await createClaudeClient();
  if (!client) {
    const fallback = fallbackScenario({ hook, article, name, reason: "ANTHROPIC_API_KEY не настроен" });
    const blueprint = buildProducerBlueprint({
      article,
      product_name: name,
      hook,
      scenario: fallback.scenario,
      lane: body.lane,
      format,
      canonical_frame_url: body.canonical_frame_url,
      source_asset_url: body.source_asset_url,
      hook_source: body.hook_source || "strong_prompt",
    });
    return NextResponse.json({ ...fallback, blueprint: blueprint.blueprint, blueprint_valid: blueprint.valid, blueprint_errors: blueprint.errors, hook_policy: blueprint.hook_policy });
  }

  const sys = `Ты режиссёр коротких UGC-видео для WB/Ozon. Разворачиваешь идею в покадровый сценарий 15-30 сек, готовый к съёмке или AI-генерации. Живой UGC, не реклама. ЦЕЛЕВАЯ ПЛАТФОРМА: ${targetPlatform}. Сценарий должен звучать как native-${targetPlatform}, а не как универсальный ролик для всех платформ. ` +
    (profile ? "ПРОФИЛЬ БРЕНДА/АУДИТОРИИ (пиши в этом голосе): " + profile + " " : "") +
    "Озвучка (voiceover) и текст на экране обязаны звучать как живой человек, без «запаха нейронки». " + DEAI_FILTERS + " " +
    "Верни СТРОГО JSON: {\"title\":\"название\",\"duration_sec\":20,\"shots\":[{\"t\":\"0-3с\",\"visual\":\"что в кадре\",\"voiceover\":\"закадр/реплика\",\"onscreen\":\"текст на экране\"}],\"caption\":\"подпись под видео\",\"hashtags\":[\"...\"],\"cta\":\"призыв искать товар на WB\",\"music\":\"тип трендового звука\"}. Только JSON.";
  const isStack = /проблем|3 проблем|problem|стек/i.test(format);
  const hookBoost = body.hook_boost === true; // хук-гейт забраковал хук → просим резче
  const user = `Товар: ${name || article}${article ? ` (арт. ${article})` : ""}. Идея/хук: «${hook}».${format ? ` Формат: ${format}.` : ""}${isStack ? ` Разверни по структуре «3 проблемы»: ${PROBLEM_STACK}` : ""}${pbHint}${winnersHint}${corpusHint} Сделай покадровый сценарий: первый кадр = хук в лоб, держит внимание, в конце мягкий CTA на поиск товара на WB.${hookBoost ? " ВАЖНО: предыдущий хук получился слабым — сделай ПЕРВУЮ ФРАЗУ и первый кадр заметно резче: паттерн-брейк/новизна/интрига/неожиданность, без общих слов и витрины." : ""}`;

  // сэмплинг из ноды Claude (инспектор) — раньше всё было захардкожено

  const samp: Record<string, any> = { model: typeof body.model === "string" && body.model ? body.model : MODEL, max_tokens: Math.min(8192, Math.max(1800, Number(body.max_tokens) || 1800)), system: sys, messages: [{ role: "user", content: user }] };
  if (typeof body.system === "string" && body.system.trim()) samp.system = body.system.trim() + "\n\n" + sys; // доп. system-промпт владельца сверху
  if (typeof body.temperature === "number") samp.temperature = Math.min(1, Math.max(0, body.temperature));
  else if (typeof body.top_p === "number") samp.top_p = Math.min(1, Math.max(0, body.top_p)); // temperature XOR top_p
  if (typeof body.top_k === "number" && body.top_k >= 1) samp.top_k = body.top_k; // top_k минимум 1 (0 невалиден)
  const stopRaw = Array.isArray(body.stop_sequences) ? body.stop_sequences : (typeof body.stop_sequences === "string" ? body.stop_sequences.split("\n") : []);
  const stops = stopRaw.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 4);
  if (stops.length) samp.stop_sequences = stops;
  if (body.service_tier === "auto" || body.service_tier === "standard_only") samp.service_tier = body.service_tier;
  if (typeof body.thinking_budget === "number" && body.thinking_budget >= 1024) { samp.thinking = { type: "enabled", budget_tokens: Math.min(body.thinking_budget, (samp.max_tokens as number) - 1) }; delete samp.temperature; delete samp.top_p; delete samp.top_k; } // extended thinking запрещает temp/top_p/top_k
  try {

    const res = await client.messages.create(samp as any);

    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    const scenario = extractJson(txt);
    if (!scenario) {
      const fallback = fallbackScenario({ hook, article, name, reason: "пустой/нечитаемый сценарий" });
      const blueprint = buildProducerBlueprint({
        article,
        product_name: name,
        hook,
        scenario: fallback.scenario,
        lane: body.lane,
        format,
        canonical_frame_url: body.canonical_frame_url,
        source_asset_url: body.source_asset_url,
        hook_source: body.hook_source || "strong_prompt",
      });
      return NextResponse.json({ ...fallback, blueprint: blueprint.blueprint, blueprint_valid: blueprint.valid, blueprint_errors: blueprint.errors, hook_policy: blueprint.hook_policy });
    }
    const blueprint = buildProducerBlueprint({
      article,
      product_name: name,
      hook,
      scenario,
      lane: body.lane,
      format,
      canonical_frame_url: body.canonical_frame_url,
      source_asset_url: body.source_asset_url,
      hook_source: body.hook_source || "strong_prompt",
    });
    return NextResponse.json({ article, product: name || article, scenario, blueprint: blueprint.blueprint, blueprint_valid: blueprint.valid, blueprint_errors: blueprint.errors, hook_policy: blueprint.hook_policy });
  } catch (e) {
    const fallback = fallbackScenario({ hook, article, name, reason: String(e).slice(0, 160) });
    const blueprint = buildProducerBlueprint({
      article,
      product_name: name,
      hook,
      scenario: fallback.scenario,
      lane: body.lane,
      format,
      canonical_frame_url: body.canonical_frame_url,
      source_asset_url: body.source_asset_url,
      hook_source: body.hook_source || "strong_prompt",
    });
    return NextResponse.json({ ...fallback, blueprint: blueprint.blueprint, blueprint_valid: blueprint.valid, blueprint_errors: blueprint.errors, hook_policy: blueprint.hook_policy });
  }
  } catch (e) {
    return NextResponse.json({
      error: "scenario crash: " + String((e as Error)?.message || e).slice(0, 160),
      ...fallbackScenario({ hook: "", article: "", name: "", reason: "route-level crash" }),
    }, { status: 500 });
  }
}
