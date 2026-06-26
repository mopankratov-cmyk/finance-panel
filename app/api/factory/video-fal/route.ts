import { NextRequest, NextResponse } from "next/server";
import { falVideoSubmit, FAL_VIDEO_MODELS, type FalVideoModel } from "@/lib/factory/falVideo";
import { rehostImageForFal } from "@/lib/factory/rehostImage";
import { buildMotionPrompt, categoryFor } from "@/lib/factory/editPrompts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Премиум image-to-video (Kling/Seedance через FAL): реальное фото товара → динамичное видео 9:16.
// Preservation-first промпт держит форму/лейбл товара. Async: возвращает task_id, статус опрашивать.
export async function POST(req: NextRequest) {
  try {
  if (!process.env.FAL_KEY) return NextResponse.json({ error:"FAL_KEY не настроен" }, { status: 500 });
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

        const row = (data as any[] | null)?.find((r) => r.article === body.sku_art);
        if (row?.nm_id) imageUrl = (await getWbCardImage(Number(row.nm_id))) || "";
      }
    } catch { /* без фото — ошибка ниже */ }
  }
  if (!imageUrl) return NextResponse.json({ error:"Нет фото товара (передай image_url или артикул с данными)" }, { status: 400 });

  // товар + категория (через тот же detectBrand) → motion-скелет канона (ОДИН camera move под форму товара)
  const product = (body.product_name || body.sku_art || "товар").toString().slice(0, 120);
  const category = categoryFor((body.sku_art || "").toString(), (body.product_name || "").toString());
  const skeleton = buildMotionPrompt({ category, product });

  // ПРОМПТ — приоритет: выученный/улучшенный (body.prompt) > Claude пишет ПОВЕРХ скелета > скелет-fallback.
  // motion-only: НЕ описываем внешность/свет/цвет (они уже в кадре — дубль = competing instructions → дрейф).
  const TEMPLATE = motion
    ? `${motion} The product stays exactly as in the photo — no shape change, no morphing, crisp edges.${brief ? ` Mood: ${brief}.` : ""}`
    : `${skeleton}${brief ? ` Mood: ${brief}.` : ""}`;
  let prompt = (body.prompt || "").toString().trim();
  let promptBy: "выученный/готовый" | "ИИ" | "шаблон" = "выученный/готовый";
  if (!prompt) {
    // Claude-промпт-инженер: первичный motion-промпт под конкретный товар/идею
    promptBy = "шаблон";
    try {
      const { createClaudeClient } = await import("@/lib/agent/client");
      const client = await createClaudeClient();
      if (client) {
        // грудинг на реальных съёмках: рецепт ниши из niche_visual_profiles + петля обучения (winners/анти-паттерны)
        let recipe = "";
        try {
          const { nicheFor } = await import("@/lib/factory/contentDisks");
          const { getSupabaseAdmin } = await import("@/lib/supabaseAdmin");
          const niche = nicheFor(product, (body.sku_art || "").toString());
          const db = getSupabaseAdmin();
          if (niche && db) {
            const { data } = await db.from("niche_visual_profiles").select("profile").eq("niche", niche).maybeSingle();

            const p = (data?.profile || null) as any;
            // полный экспертный грундинг ниши как КОНТЕКСТ для выбора движения; system запрещает переписывать
            // внешность/свет/цвет в сам motion-промпт (motion-only) — так грундинг и канон не конфликтуют.
            if (p) recipe = `\nСТИЛЬ НАШИХ РЕАЛЬНЫХ СЪЁМОК (ниша ${niche}) — следуй ЭСТЕТИКЕ для выбора камеры/движения, но НЕ переписывай внешность/свет/цвет в motion-промпт: framing=${p.framing||""}; camera=${p.camera||""}; light=${p.lighting||""}; action=${p.model_action||""}; palette=${p.palette||""}; mood=${p.mood||""}. DO: ${(p.do||[]).join("; ")}. DONT: ${(p.dont||[]).join("; ")}.${p.motion_prompt ? ` Опорная фраза движения: ${p.motion_prompt}` : ""}`;
          }
        } catch { /* профиля нет — пишем без грудинга */ }
        const sys = `Ты видео-промпт-инженер для ${model} image-to-video (товар на WB). Тебе дан СКЕЛЕТ — пиши ПОВЕРХ него, не с нуля, сохранив его camera-move и preservation-клозет. Промпт = MOTION-СКРИПТ, НЕ описание сцены: стартовый кадр уже несёт внешность/свет/цвет/текст — НЕ повторяй их (это competing instructions → дрейф/морфинг). Только: микро-движение субъекта + ОДИН camera move + темп. Камера-инструкция в НАЧАЛЕ. ОДИН мув (стек orbit+zoom+pan = jitter и деформация лейбла); для товара не совмещай движение КАМЕРЫ и ОБЪЕКТА — выбери одно. Форма товара: жёсткая/простая (флакон, сумка) — мягкий камера-мув ок; детальная/сложная (игрушки, техника) — движение МИНИМАЛЬНОЕ (static + лёгкий push-in). ОБЯЗАТЕЛЬНО короткий preservation-клозет: «product stable and intact, no shape change, crisp edges». Лаконично, ~15-25 слов. Если задан первый кадр — начни движение с него. Верни ТОЛЬКО английский промпт, без преамбулы.`;
        const res = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 350, temperature: 0.4, system: sys, messages: [{ role: "user", content: `Товар: ${product}. Идея/настроение: ${brief || "показать товар эффектно"}.${shot_visual ? ` Первый кадр (из сценария): ${shot_visual}.` : ""}\nСКЕЛЕТ (пиши поверх, сохрани camera-move и preservation): ${skeleton}${recipe}` }] });

        const t = (res.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim().replace(/^["«]|["»]$/g, "");
        if (t) { prompt = t; promptBy = "ИИ"; }
      }
    } catch { /* fallback ниже */ }
    if (!prompt) prompt = TEMPLATE;
  }

  // WB-CDN флэйкит на серверной загрузке fal ("file_download") → рехостим фото товара в наш бакет (надёжно).
  // Best-effort: при сбое вернётся исходный url. Тот же фикс, что в nodeEngine.submitNode (этот путь — автопилот/legacy-UI).
  const srcImg = await rehostImageForFal(imageUrl);
  const token = await falVideoSubmit(model, srcImg, prompt, { duration: body.duration === "10" ? "10" : "5" });
  if (!token) return NextResponse.json({ error:"FAL не принял задачу (ключ/баланс/модель)" }, { status: 502 });
  return NextResponse.json({ task_id: "fv." + token, model, image_url: imageUrl, prompt_used: prompt, prompt_by: promptBy });
  } catch (e) {
    return NextResponse.json({
      error: "video-fal crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}
