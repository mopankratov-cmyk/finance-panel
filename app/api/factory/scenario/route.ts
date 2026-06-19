import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { DEAI_FILTERS, PROBLEM_STACK } from "@/lib/factory/standard";
import { brandProfile } from "@/lib/factory/brandProfiles";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6"; // быстрый, укладываемся в лимит

// Развернуть идею-хук в полный покадровый сценарий короткого видео (готов к съёмке/монтажу).
export async function POST(req: NextRequest) {
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
  // профиль не задан вручную → подбираем по БРЕНДУ товара (1 бренд = 1 профиль)
  const profile: string = (body.profile || "").toString().trim().slice(0, 2000) || brandProfile(article, name);
  const pb = body.playbook && typeof body.playbook === "object" ? body.playbook : null;
  // из плейбука ниши: проверенные хуки + покадровая структура лучшего формата + тренд-звук
  let pbHint = "";
  if (pb) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      (pb.cta ? `\nCTA: ${pb.cta}` : "");
  }

  // Корпус вирального: грунтовка на реально залетевших видео/хуках ниши (таблицы могут не существовать).
  // Работает из фоновой очереди — не требует playbook (который только в браузере).
  let corpusHint = "";
  if (!pb && article) {
    try {
      const dbC = getSupabaseAdmin();
      const rn = nicheFromArticle(article, name);
      if (dbC && rn) {
        const [{ data: vids }, { data: hks }] = await Promise.all([
          dbC.from("viral_videos").select("hook_text,format_detected,beat_structure").eq("niche", rn).order("virality_score", { ascending: false }).limit(3),
          dbC.from("viral_hooks").select("hook_text").eq("niche", rn).order("viability_score", { ascending: false }).limit(6),
        ]);
        const vidLines = ((vids || []) as { hook_text?: string; format_detected?: string; beat_structure?: unknown }[])
          .filter((v) => v.hook_text || v.beat_structure)
          .map((v) => `• «${v.hook_text || "?"}» [${v.format_detected || ""}${v.beat_structure ? " / " + JSON.stringify(v.beat_structure).slice(0, 80) : ""}]`)
          .join("\n");
        const hkLine = ((hks || []) as { hook_text: string }[]).map((h) => `«${h.hook_text}»`).join(" | ");
        if (vidLines || hkLine) {
          corpusHint =
            "\n\nКОРПУС ЗАЛЕТЕВШЕГО В НИШЕ (реальные примеры — повтори дух/структуру в первом кадре):" +
            (vidLines ? "\n" + vidLines : "") +
            (hkLine ? "\nПроверенные хуки: " + hkLine : "");
        }
      }
    } catch { /* corpus optional */ }
  }

  const client = await createClaudeClient();
  if (!client) return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });

  const sys = "Ты режиссёр коротких UGC-видео для WB/Ozon. Разворачиваешь идею в покадровый сценарий 15-30 сек, готовый к съёмке или AI-генерации. Живой UGC, не реклама. " +
    (profile ? "ПРОФИЛЬ БРЕНДА/АУДИТОРИИ (пиши в этом голосе): " + profile + " " : "") +
    "Озвучка (voiceover) и текст на экране обязаны звучать как живой человек, без «запаха нейронки». " + DEAI_FILTERS + " " +
    "Верни СТРОГО JSON: {\"title\":\"название\",\"duration_sec\":20,\"shots\":[{\"t\":\"0-3с\",\"visual\":\"что в кадре\",\"voiceover\":\"закадр/реплика\",\"onscreen\":\"текст на экране\"}],\"caption\":\"подпись под видео\",\"hashtags\":[\"...\"],\"cta\":\"призыв искать товар на WB\",\"music\":\"тип трендового звука\"}. Только JSON.";
  const isStack = /проблем|3 проблем|problem|стек/i.test(format);
  const hookBoost = body.hook_boost === true; // хук-гейт забраковал хук → просим резче
  const user = `Товар: ${name || article}${article ? ` (арт. ${article})` : ""}. Идея/хук: «${hook}».${format ? ` Формат: ${format}.` : ""}${isStack ? ` Разверни по структуре «3 проблемы»: ${PROBLEM_STACK}` : ""}${pbHint}${corpusHint} Сделай покадровый сценарий: первый кадр = хук в лоб, держит внимание, в конце мягкий CTA на поиск товара на WB.${hookBoost ? " ВАЖНО: предыдущий хук получился слабым — сделай ПЕРВУЮ ФРАЗУ и первый кадр заметно резче: паттерн-брейк/новизна/интрига/неожиданность, без общих слов и витрины." : ""}`;

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 1800, system: sys, messages: [{ role: "user", content: user }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: "пустой сценарий" }, { status: 502 });
    return NextResponse.json({ article, product: name || article, scenario: JSON.parse(m[0]) });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
}
