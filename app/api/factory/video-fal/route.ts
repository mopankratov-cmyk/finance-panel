import { NextRequest, NextResponse } from "next/server";
import { falVideoSubmit, FAL_VIDEO_MODELS, type FalVideoModel } from "@/lib/factory/falVideo";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Премиум image-to-video (Kling/Seedance через FAL): реальное фото товара → динамичное видео 9:16.
// Preservation-first промпт держит форму/лейбл товара. Async: возвращает task_id, статус опрашивать.
export async function POST(req: NextRequest) {
  if (!process.env.FAL_KEY) return NextResponse.json({ detail: "FAL_KEY не настроен" }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  // диагностика FAL: сырой ответ (статус 401=ключ, 402/403=баланс/доступ, 422=модель)
  if (body.debug === "fal") {
    const { falSubmitRaw } = await import("@/lib/factory/falVideo");
    const raw = await falSubmitRaw("seedance", "https://basket-36.wbbasket.ru/vol7691/part769167/769167956/images/big/1.webp", "test");
    return NextResponse.json({ debug_fal: raw });
  }
  const model: FalVideoModel = (body.model in FAL_VIDEO_MODELS ? body.model : "kling") as FalVideoModel;
  const brief: string = (body.brief || body.hook || "").toString().trim();
  const motion: string = (body.motion || "").toString().trim();
  // первый кадр из сценария — выравниваем промпт видео со стори-бордом
  const shot_visual: string = (body.shot_visual || "").toString().trim().slice(0, 200);

  // источник фото: прямой URL или резолв по артикулу (реальный, с HEAD-пробой баскета)
  let imageUrl: string = (body.image_url || "").toString().trim();
  if (!imageUrl && body.sku_art) {
    try {
      const { getSupabaseAdmin } = await import("@/lib/supabaseAdmin");
      const { getWbCardImage } = await import("@/lib/wb/cardImage");
      const db = getSupabaseAdmin();
      if (db) {
        const { data } = await db.rpc("rnp_report");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = (data as any[] | null)?.find((r) => r.article === body.sku_art);
        if (row?.nm_id) imageUrl = (await getWbCardImage(Number(row.nm_id))) || "";
      }
    } catch { /* без фото — ошибка ниже */ }
  }
  if (!imageUrl) return NextResponse.json({ detail: "Нет фото товара (передай image_url или артикул с данными)" }, { status: 400 });

  // ПРОМПТ — приоритет: выученный/улучшенный (body.prompt) > Claude пишет под товар > шаблон-fallback
  const TEMPLATE = `Keep the product EXACTLY as in the photo — identical shape, proportions, label, logo, colors; do NOT morph, deform, or replace it. ${motion || "Subtle cinematic camera motion: slow push-in with gentle parallax, soft studio light, the product stays centered, crisp and fully intact."}${brief ? ` Mood: ${brief}.` : ""}`;
  let prompt = (body.prompt || "").toString().trim();
  let promptBy: "выученный/готовый" | "ИИ" | "шаблон" = "выученный/готовый";
  if (!prompt) {
    // Claude-промпт-инженер: первичный motion-промпт под конкретный товар/идею
    promptBy = "шаблон";
    try {
      const { createClaudeClient } = await import("@/lib/agent/client");
      const client = await createClaudeClient();
      if (client) {
        const product = (body.product_name || body.sku_art || "товар").toString().slice(0, 120);
        // грудинг на реальных съёмках: рецепт ниши из niche_visual_profiles
        let recipe = "";
        try {
          const { nicheFor } = await import("@/lib/factory/contentDisks");
          const { getSupabaseAdmin } = await import("@/lib/supabaseAdmin");
          const niche = nicheFor(product, (body.sku_art || "").toString());
          const db = getSupabaseAdmin();
          if (niche && db) {
            const { data } = await db.from("niche_visual_profiles").select("profile").eq("niche", niche).maybeSingle();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const p = (data?.profile || null) as any;
            if (p) recipe = `\nСТИЛЬ НАШИХ РЕАЛЬНЫХ СЪЁМОК (ниша ${niche}) — следуй ему: framing=${p.framing||""}; camera=${p.camera||""}; light=${p.lighting||""}; action=${p.model_action||""}; palette=${p.palette||""}; mood=${p.mood||""}. DO: ${(p.do||[]).join("; ")}. DONT: ${(p.dont||[]).join("; ")}.${p.motion_prompt ? ` Опорная фраза: ${p.motion_prompt}` : ""}`;
          }
        } catch { /* профиля нет — пишем без грудинга */ }
        const sys = `Ты видео-промпт-инженер для ${model} image-to-video (товар на WB). Напиши ОДИН английский motion-промпт. Учти ФОРМУ товара: жёсткая/простая (флакон, сумка) — можно мягкое движение камеры; детальная/сложная (игрушки, техника с мелкими частями) — движение МИНИМАЛЬНОЕ, чтобы не исказить. ОБЯЗАТЕЛЬНО preservation: keep product EXACT shape/label/proportions, no morphing/deformation/cap separation. Явно включи в промпт: «product stable and intact throughout, no shape change, crisp edges». Если дан СТИЛЬ НАШИХ СЪЁМОК — повтори его эстетику. Если задан первый кадр — начни движение именно с него. Подбери движение под идею. Верни ТОЛЬКО английский промпт, без преамбулы.`;
        const res = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 350, system: sys, messages: [{ role: "user", content: `Товар: ${product}. Идея/настроение: ${brief || "показать товар эффектно"}.${shot_visual ? ` Первый кадр (из сценария): ${shot_visual}.` : ""}${recipe}` }] });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim().replace(/^["«]|["»]$/g, "");
        if (t) { prompt = t; promptBy = "ИИ"; }
      }
    } catch { /* fallback ниже */ }
    if (!prompt) prompt = TEMPLATE;
  }

  const token = await falVideoSubmit(model, imageUrl, prompt, { duration: body.duration === "10" ? "10" : "5" });
  if (!token) return NextResponse.json({ detail: "FAL не принял задачу (ключ/баланс/модель)" }, { status: 502 });
  return NextResponse.json({ task_id: "fv." + token, model, image_url: imageUrl, prompt_used: prompt, prompt_by: promptBy });
}
