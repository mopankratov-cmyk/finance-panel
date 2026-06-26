import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { detectBrand } from "@/lib/factory/brandProfiles";
import { specFor, accentFor, fitHeadline, DEFAULT_STATIC_FORMAT, type StaticFormat } from "@/lib/factory/staticCanon";
import { remotionSubmit, remotionReady } from "@/lib/factory/remotionRender";
import { classifyAssets, pickImage, type DiskAsset } from "@/lib/factory/assetBind";
import { logGeneration } from "@/lib/factory/genHistory";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── ЛИНИЯ СТАТИКИ завода (новая ветка рядом с видео-рилсами): «одно намерение → N экспортов». ──
// Резолвит фото товара (prepared>wb по артикулу) + бренд + акцент → рендерит StaticV1 (renderStill→PNG) на Remotion-VM.
// Канон/правила — lib/factory/staticCanon.ts; спека — docs/factory-pin-canon.md. БЕЗ fal (код-рендер).
//
// POST { article, niche?, format?(card_3x4|pin_2x3|ig_4x5), archetype?, headline, subhead?, bullets?, price?,
//        oldPrice?, badge?, brand?, proof?, productImage?, productImages?, objective?(reach|saves) }
//   → { ok, task_id, format, archetype, image_used }   (статус опрашивать на render-service /status/:id)
//
// Backlog линии статики живёт в docs/factory-pin-canon.md. Этот route остаётся узким submit-only
// контуром и не расширяет MVP-видео pipeline.
export async function POST(req: NextRequest) {
  try {
    if (!remotionReady()) return NextResponse.json({ error: "REMOTION_RENDER_URL не задан — статика рендерится на Remotion-VM (renderStill)" }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const article: string = (body.article || "").toString().trim();
    const format: StaticFormat = (["card_3x4", "pin_2x3", "ig_4x5", "ig_carousel"].includes(body.format) ? body.format : DEFAULT_STATIC_FORMAT) as StaticFormat;
    const archetype: string = (body.archetype || "headline_hero").toString();
    const headlineRaw: string = (body.headline || "").toString().trim();
    if (!headlineRaw) return NextResponse.json({ error: "нужен headline (хук-строка)" }, { status: 400 });

    // фото товара: явное → иначе резолв по артикулу (prepared лучше WB-инфографики)
    let productImage: string = (body.productImage || "").toString().trim();
    let productImages: string[] = Array.isArray(body.productImages) ? body.productImages : [];
    if (!productImage && article) {
      try {
        const db = getSupabaseAdmin();
        if (db) {
          // ВЕСЬ наш контент по артикулу (не только wb-карточки): приоритет prepared > РЕАЛЬНАЯ СЪЁМКА (design/norvia) > wb —
          // тот же classifyAssets/pickImage, что у рилсов (реальное фото модели/студии качественнее WB-инфографики).
          const { data } = await db.from("content_assets").select("disk,kind,url")
            .eq("article", article).eq("kind", "image").not("url", "is", null).limit(60);
          const pool = classifyAssets((data as DiskAsset[] | null) || []);
          const ordered = [...(pool.preparedImages || []), ...pool.realImages, ...pool.wbImages];
          productImage = pickImage(pool, 0) || "";
          if (!productImages.length) productImages = ordered.slice(0, 4);
        }
      } catch { /* без фото → плейсхолдер в StaticV1 */ }
    }

    const brand: string = (body.brand || detectBrand(article, headlineRaw) || "").toString();
    const objective: "reach" | "saves" = body.objective === "saves" ? "saves" : "reach";
    const accent: string = (body.accent || accentFor(objective, 0)).toString();

    const inputProps: Record<string, unknown> = {
      format, archetype,
      productImage: productImage || undefined,
      productImages: productImages.length ? productImages : undefined,
      headline: fitHeadline(headlineRaw),
      subhead: body.subhead || undefined,
      bullets: Array.isArray(body.bullets) ? body.bullets.slice(0, 5) : undefined,
      price: body.price || undefined,
      oldPrice: body.oldPrice || undefined,
      badge: body.badge || undefined,
      brand: brand || undefined,
      proof: body.proof || undefined,
      bg: body.bg || undefined,
      accent,
    };

    const id = await remotionSubmit("StaticV1", inputProps, 1, { still: true });
    if (!id) return NextResponse.json({ error: "render-service не принял задачу (URL/токен/недоступен)" }, { status: 502 });
    const spec = specFor(format);
    await logGeneration({
      tool: "remotion",
      engine: "remotion",
      node_type: "static_post",
      prompt: headlineRaw,
      params: { task_id: id, format, archetype, size: `${spec.w}x${spec.h}`, image_used: productImage || "placeholder" },
      status: "submitted",
      source: "static_generate",
      reason: "static_render_submitted",
      article: article || null,
      niche: (body.niche || "").toString().trim() || null,
    });
    return NextResponse.json({ ok: true, task_id: id, format, archetype, size: `${spec.w}x${spec.h}`, platform: spec.platform, image_used: productImage || "placeholder" });
  } catch (e) {
    return NextResponse.json({ error: "static-generate crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
