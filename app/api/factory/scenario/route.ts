import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { DEAI_FILTERS, PROBLEM_STACK } from "@/lib/factory/standard";

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
  const profile: string = (body.profile || "").toString().trim().slice(0, 2000);
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
      (chosen ? `\nФормат «${chosen.name}» — покадровая структура: ${(chosen.beats || []).join(" → ")}. Первый кадр: ${chosen.hook || "хук в лоб"}.` : "") +
      (Array.isArray(pb.anti_patterns) && pb.anti_patterns.length ? `\nНЕ делай: ${pb.anti_patterns.slice(0, 4).join("; ")}` : "") +
      (snd ? `\nТренд-звук под нишу: «${snd.title}»${snd.commerce_safe ? " (коммерч-безопасен)" : " (только органика, не для рекламы)"} — укажи его в поле music.` : "") +
      (pb.cta ? `\nCTA: ${pb.cta}` : "");
  }

  const client = await createClaudeClient();
  if (!client) return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });

  const sys = "Ты режиссёр коротких UGC-видео для WB/Ozon. Разворачиваешь идею в покадровый сценарий 15-30 сек, готовый к съёмке или AI-генерации. Живой UGC, не реклама. " +
    (profile ? "ПРОФИЛЬ БРЕНДА/АУДИТОРИИ (пиши в этом голосе): " + profile + " " : "") +
    "Озвучка (voiceover) и текст на экране обязаны звучать как живой человек, без «запаха нейронки». " + DEAI_FILTERS + " " +
    "Верни СТРОГО JSON: {\"title\":\"название\",\"duration_sec\":20,\"shots\":[{\"t\":\"0-3с\",\"visual\":\"что в кадре\",\"voiceover\":\"закадр/реплика\",\"onscreen\":\"текст на экране\"}],\"caption\":\"подпись под видео\",\"hashtags\":[\"...\"],\"cta\":\"призыв искать товар на WB\",\"music\":\"тип трендового звука\"}. Только JSON.";
  const isStack = /проблем|3 проблем|problem|стек/i.test(format);
  const user = `Товар: ${name || article}${article ? ` (арт. ${article})` : ""}. Идея/хук: «${hook}».${format ? ` Формат: ${format}.` : ""}${isStack ? ` Разверни по структуре «3 проблемы»: ${PROBLEM_STACK}` : ""}${pbHint} Сделай покадровый сценарий: первый кадр = хук в лоб, держит внимание, в конце мягкий CTA на поиск товара на WB.`;

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
