import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { detectBrand } from "@/lib/factory/brandProfiles";
import { specFor, accentFor, fitHeadline, type StaticFormat } from "@/lib/factory/staticCanon";
import { remotionSubmit, remotionReady } from "@/lib/factory/remotionRender";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ── ЛИНИЯ СТАТИКИ завода (новая ветка рядом с видео-рилсами): «одно намерение → N экспортов». ──
// Резолвит фото товара (prepared>wb по артикулу) + бренд + акцент → рендерит StaticV1 (renderStill→PNG) на Remotion-VM.
// Канон/правила — lib/factory/staticCanon.ts; спека — docs/factory-pin-canon.md. БЕЗ fal (код-рендер).
//
// POST { article, niche?, format?(pin_2x3|card_3x4|ig_4x5), archetype?, headline, subhead?, bullets?, price?,
//        oldPrice?, badge?, brand?, proof?, productImage?, productImages?, objective?(reach|saves) }
//   → { ok, task_id, format, archetype, image_used }   (статус опрашивать на render-service /status/:id)
//
// TODO (помощнице, см. docs/factory-pin-canon.md):
//  · поллинг render-status + банк PNG в content_assets(kind='image', analysis:{format,archetype,platform,seo}) — переиспользовать паттерн gen-save slides;
//  · невидимый SEO-слой (title keyword-first / desc 220-232 / alt) из листинга MPStats;
//  · fresh-variant multiplier (N вариантов на SKU: архетип×угол×кроп) + perceptual-hash дедуп;
//  · карусель ig_carousel (рендер N слайдов как N стиллов: hook→value→CTA);
//  · кнопка «Сделать пины» в студии; per-niche роутинг архетипов (расширить detectBrand→archetype);
//  · продукт-кадр через Nano edit (sourcePrep) под пин-кроп, когда баланс fal будет (сейчас prepared/wb).
export async function POST(req: NextRequest) {
  if (!remotionReady()) return NextResponse.json({ error: "REMOTION_RENDER_URL не задан — статика рендерится на Remotion-VM (renderStill)" }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const article: string = (body.article || "").toString().trim();
  const format: StaticFormat = (["pin_2x3", "card_3x4", "ig_4x5", "ig_carousel"].includes(body.format) ? body.format : "pin_2x3") as StaticFormat;
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
        const { data } = await db.from("content_assets").select("url,disk")
          .eq("article", article).eq("kind", "image").in("disk", ["prepared", "wb"]).not("url", "is", null).limit(8);
        const rows = (data as { url: string; disk: string }[] | null) || [];
        const prepared = rows.filter((r) => r.disk === "prepared").map((r) => r.url);
        const wb = rows.filter((r) => r.disk === "wb").map((r) => r.url);
        const pool = prepared.length ? prepared : wb;
        productImage = pool[0] || "";
        if (!productImages.length) productImages = pool.slice(0, 4);
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
  return NextResponse.json({ ok: true, task_id: id, format, archetype, size: `${spec.w}x${spec.h}`, platform: spec.platform, image_used: productImage || "placeholder" });
}
