import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createClaudeClient } from "@/lib/agent/client";
import { extractJson } from "@/lib/factory/extractJson";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const MODEL = "claude-sonnet-4-6";

// «Обучение» агентов на реальном контенте: Claude-vision разбирает реальные кадры ниши
// → «визуальный рецепт» (как снято) → niche_visual_profiles. Этим грундятся промпт-инженер,
// продюсер, сценарист и ОТК. POST { niche, sample?: number }.
export async function POST(req: NextRequest) {
  try {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const niche: string = (body.niche || "").toString().trim();
  if (!niche) return NextResponse.json({ error: "нужна niche" }, { status: 400 });
  const sample = Math.min(Math.max(Number(body.sample) || 6, 3), 10);

  // рецепт учим по РЕАЛЬНЫМ съёмкам (модель+товар), не по студийным кропам WB
  const { data: assets, error } = await db
    .from("content_assets")
    .select("path,url,color")
    .eq("niche", niche).eq("kind", "image").neq("disk", "wb").not("url", "is", null)
    .limit(sample);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!assets || !assets.length) return NextResponse.json({ error: "нет кадров этой ниши в каталоге (сначала проиндексируй)" }, { status: 404 });

  const origin = new URL(req.url).origin;
  const client = await createClaudeClient();
  if (!client) return NextResponse.json({ error: "ANTHROPIC_API_KEY не настроен" }, { status: 500 });

  const sys = `Ты арт-директор бренда. На входе — реальные кадры профессиональной съёмки одной товарной ниши.
Извлеки ПОВТОРЯЕМЫЙ визуальный рецепт этой съёмки, чтобы потом генерировать видео В ТОМ ЖЕ стиле.
ВАЖНО: каждое значение КОРОТКОЕ (до 12 слов), без длинных перечислений и нумерации. Массивы — максимум 3 пункта.
Верни СТРОГО валидный JSON (с закрывающей скобкой):
{"framing":"кратко как кадрируют","camera":"ракурс/дистанция/движение","lighting":"свет и фон","model_action":"что делает модель с товаром","palette":"доминирующие цвета","props":"реквизит/окружение","mood":"настроение","do":["до 3 пунктов"],"dont":["до 3 пунктов AI-брака"],"motion_prompt":"одна англ. фраза для image-to-video, preservation товара"}. Только JSON, ничего лишнего.`;


  const content: any[] = [{ type: "text", text: `Ниша: ${niche}. Разбери эти ${assets.length} реальных кадра(ов) и выведи рецепт.` }];
  for (const a of assets) content.push({ type: "image", source: { type: "url", url: origin + a.url } });

  try {
    const res = await client.messages.create({ model: MODEL, max_tokens: 2048, system: sys, messages: [{ role: "user", content }] });

    let txt = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
    const profile = extractJson(txt);
    if (!profile) return NextResponse.json({ error: "пустой ответ", raw: txt.slice(0, 150) }, { status: 502 });
    profile.refs = assets.map((a) => a.path);

    const { error: upErr } = await db.from("niche_visual_profiles").upsert(
      { niche, profile, sample_count: assets.length, updated_at: new Date().toISOString() },
      { onConflict: "niche" },
    );
    if (upErr) return NextResponse.json({ error: upErr.message, hint: "миграция применена?" }, { status: 500 });

    // отметим кадры как разобранные
    await db.from("content_assets").update({ analyzed: true }).eq("niche", niche).eq("kind", "image").in("path", assets.map((a) => a.path));

    return NextResponse.json({ ok: true, niche, sample: assets.length, profile });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 502 });
  }
  } catch (e) {
    return NextResponse.json({
      ok: false,
      profile: null,
      error: "сохранение обучения контента упало: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}

// GET ?niche= — текущий визуальный профиль (или все).
export async function GET(req: NextRequest) {
  try {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const niche = new URL(req.url).searchParams.get("niche");
  const q = db.from("niche_visual_profiles").select("niche,profile,sample_count,updated_at");
  const { data, error } = niche ? await q.eq("niche", niche).maybeSingle() : await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profiles: data });
  } catch (e) {
    return NextResponse.json({
      profiles: null,
      error: "чтение обучения контента упало: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}
