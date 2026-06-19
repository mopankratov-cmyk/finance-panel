import { NextRequest, NextResponse } from "next/server";
import { createClaudeClient } from "@/lib/agent/client";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { DEAI_FILTERS } from "@/lib/factory/standard";
import { brandProfile } from "@/lib/factory/brandProfiles";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const MODEL = "claude-sonnet-4-6";

// P1.2 — Variation Engine: из ОДНОГО победившего ролика/хука делает N вариаций для теста на объёме
// (владелец льёт 20+/нед). Меняет ТОЛЬКО ОДИН рычаг за раз {первые 2 сек | хук | финал | эмоция},
// базовую идею/товар НЕ трогает — чтобы понять, что сработало. POST { hook|concept|scenario, count?, ... }.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const base: string = (body.hook || body.concept || (typeof body.scenario === "string" ? body.scenario : body.scenario?.title) || "").toString().trim();
  if (!base) return NextResponse.json({ error: "Нужен победивший хук/идея/сценарий (base)" }, { status: 400 });
  const article: string = (body.article || "").toString().trim();
  let name: string = (body.product_name || "").toString().trim();
  const count = Math.min(20, Math.max(3, Number(body.count) || 8));
  const format: string = (body.format || "").toString().trim();
  if (!name && article) {
    const db = getSupabaseAdmin();
    if (db) { const { data } = await db.from("product_costs").select("name").eq("article", article).maybeSingle(); name = (data?.name as string) || ""; }
  }
  const profile: string = (body.profile || "").toString().trim().slice(0, 1500) || brandProfile(article, name);

  const client = await createClaudeClient();
  if (!client) return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });

  const sys = `Ты — Variation Engine для вирусных коротких видео (Reels/Shorts/TikTok). Из ОДНОГО зашедшего ролика делаешь вариации для A/B-теста на объёме. ГЛАВНОЕ ПРАВИЛО: в каждой вариации меняй ТОЛЬКО ОДИН рычаг (lever) из {hook | first_2s | finale | emotion}, всё остальное оставляй как в базе — иначе непонятно, что сработало. Базовую ИДЕЮ и ТОВАР не меняй.
${profile ? `ПРОФИЛЬ БРЕНДА/ЦА: ${profile}\n` : ""}${DEAI_FILTERS}
Распредели вариации по рычагам примерно поровну. Хук ≤12 слов, разговорный, паттерн-брейк. Без вступлений-пустышек.
Верни СТРОГО JSON-массив из ${count}: [{"lever":"hook|first_2s|finale|emotion","hook":"первая фраза","first_2s":"что в первом кадре","finale":"концовка/payoff/CTA","emotion":"shock|curiosity|flex|calm","note":"что именно изменено vs база (кратко)"}]. Только JSON, без преамбулы.`;
  const user = `База (зашедший ролик): «${base}». Товар: ${name || article || "—"}${article ? ` (арт. ${article})` : ""}.${format ? ` Формат: ${format}.` : ""} Сделай ${count} вариаций, меняя по одному рычагу за раз.`;

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 2200, system: sys, messages: [{ role: "user", content: user }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ");
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) return NextResponse.json({ error: "пустой ответ", raw: txt.slice(0, 150) }, { status: 502 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let variations: any[] = [];
    try { variations = JSON.parse(m[0]); } catch { return NextResponse.json({ error: "невалидный JSON" }, { status: 502 }); }
    variations = variations
      .filter((v) => v && (v.hook || v.first_2s || v.finale))
      .map((v) => ({ lever: ["hook", "first_2s", "finale", "emotion"].includes(v.lever) ? v.lever : "hook", hook: String(v.hook || base), first_2s: String(v.first_2s || ""), finale: String(v.finale || ""), emotion: String(v.emotion || ""), note: String(v.note || "") }))
      .slice(0, count);
    return NextResponse.json({ base, product: name || article, count: variations.length, variations });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
}
