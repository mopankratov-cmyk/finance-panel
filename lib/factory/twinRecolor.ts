import type { SupabaseClient } from "@supabase/supabase-js";
import { runNanoBananaEdit } from "./falImageEdit";
import { rehostImageForFal } from "./rehostImage";
import {
  buildTwinImageVariants,
  downloadImageBuffer,
  getBestProductTwinAsset,
  persistProductTwin,
  uploadTwinAsset,
} from "./productTwinStore";
import {
  buildProductPromptLibrary,
  buildTwinId,
  createTwinAsset,
  normalizeTwinCategory,
  type ProductTwin,
  type ProductTwinAsset,
} from "./productTwin";

// Перекраска эталонного твина в целевой цвет. Ключевая идея: перекраска НЕ трогает геометрию
// (длину, крой, застёжку, капюшон) — только цвет ткани. Поэтому все цвета одной модели наследуют
// корректную структуру от одного проверенного эталона, а nano-banana не может выдумать парку/патч.

// Якоря цвета WB-палитры NORVIA — имя цвета карточки → hex-ориентир для точной перекраски.
const COLOR_HEX: Record<string, string> = {
  "черный": "#1b1b1d",
  "чёрный": "#1b1b1d",
  "светло-бежевый": "#d9cdb4",
  "бежевый": "#cdb896",
  "серо-бежевый": "#b3a892",
  "светло-зеленый": "#a9bd9f",
  "светло-зелёный": "#a9bd9f",
  "мятный": "#a9bd9f",
  "темно-зеленый": "#3f4a35",
  "тёмно-зелёный": "#3f4a35",
  "хаки": "#4b4d38",
  "голубой": "#a1bad2",
  "светло-синий": "#a9c0d8",
  "синий": "#2f3f5c",
  "темно-синий": "#28324a",
  "тёмно-синий": "#28324a",
  "темно-серый": "#494a4c",
  "тёмно-серый": "#494a4c",
  "бордовый": "#6d2733",
  "шоколадный": "#4a3427",
  "капучино": "#8a6f57",
  "красный": "#9d2f2f",
};

function colorHex(color: string): string | null {
  const key = String(color || "").trim().toLowerCase().split(/[;,]/)[0].trim();
  return COLOR_HEX[key] || null;
}

export function buildRecolorPrompt(product: string, color: string): string {
  const hex = colorHex(color);
  const target = hex ? `${color} (target hex around ${hex})` : color;
  return [
    `Recolor this ${product} to ${target}.`,
    "Change ONLY the fabric colour of the garment to this exact colour across the whole piece (main body, sleeves, hood).",
    "Keep EVERYTHING else pixel-identical: the exact silhouette, garment length, cut, hood/collar, zipper and buttons, pockets, seams, stitching, drawcord, cuffs, hardware colour, proportions, fabric texture and folds, camera angle, pose, background and lighting.",
    "Do NOT restyle, do NOT change the shape, length or construction, do NOT add or remove any detail, badge or patch.",
    "Photorealistic, same clean studio packshot, vertical 9:16, sharp fabric detail.",
  ].join(" ");
}

export async function recolorTwinFromBase(db: SupabaseClient, input: {
  baseArticle?: string;
  baseTwinId?: string;
  targetArticle: string;
  product: string;
  color: string;
}): Promise<{ ok: true; twin: ProductTwin; previewUrlSource: string } | { ok: false; error: string; status?: number }> {
  const targetArticle = String(input.targetArticle || "").trim();
  if (!targetArticle) return { ok: false, error: "нужен targetArticle", status: 400 };
  if (!process.env.FAL_KEY && !process.env.FAL_BILLING_KEY) return { ok: false, error: "FAL_KEY не настроен", status: 500 };

  // Эталон: лучший чистый ассет (hero use-case = full-bleed clean_png/upscaled), allowFailedIdentity —
  // перекрашивать можно и с warn-базы, геометрия у неё уже проверена.
  const base = await getBestProductTwinAsset(db, {
    twinId: input.baseTwinId,
    article: input.baseTwinId ? undefined : input.baseArticle,
    useCase: "hero",
    allowFailedIdentity: true,
  });
  if (!base) return { ok: false, error: "эталонный твин не найден (нужен baseTwinId или baseArticle с готовым твином)", status: 404 };

  const category = normalizeTwinCategory("apparel", targetArticle, input.product);
  const publicBase = await rehostImageForFal(base.asset.url);
  const prompt = buildRecolorPrompt(input.product, input.color);
  const recolored = await runNanoBananaEdit({ image: publicBase, prompt });
  if (!recolored.ok) return { ok: false, error: recolored.error, status: recolored.responseUrl ? 504 : 502 };

  const downloaded = await downloadImageBuffer(recolored.imageUrl);
  if (!downloaded.ok) return { ok: false, error: `recolor download failed: ${downloaded.error}`, status: 502 };

  const twinId = buildTwinId({ article: targetArticle, source: `recolor:${base.twin.twinId}:${input.color}`, version: `recolor-${Date.now()}` });
  const variants = await buildTwinImageVariants({ cleanBuffer: downloaded.buffer, article: targetArticle, twinId, category });

  const serviceKinds = new Set(["object_mask", "alpha", "depth_map", "segmentation"]);
  const assets: ProductTwinAsset[] = [];
  for (const variant of variants) {
    const uploaded = await uploadTwinAsset(db, { article: targetArticle, twinId, kind: variant.kind, buffer: variant.buffer, contentType: variant.contentType });
    if ("error" in uploaded) return { ok: false, error: `upload ${variant.kind}: ${uploaded.error}`, status: 502 };
    const service = serviceKinds.has(variant.kind);
    assets.push(createTwinAsset({
      twinId,
      article: targetArticle,
      kind: variant.kind,
      url: uploaded.url,
      path: uploaded.path,
      truthLevel: variant.kind === "clean_png" || variant.kind === "upscaled" ? "truthful" : "derived",
      qualityScore: variant.quality.qualityScore,
      qualityDetails: { ...(variant.quality.rejectReasons ? { reject_reasons: variant.quality.rejectReasons } : {}), recolored_from: base.twin.twinId, target_color: input.color },
      risk: variant.quality.identityRisk,
      sourceKind: "recolor",
      brollReady: service ? false : variant.quality.brollReady,
      heroReady: service ? false : variant.quality.heroReady,
      ugcReady: service ? false : variant.quality.brollReady && ["shadow_bg", "clean_png"].includes(variant.kind),
      marketplaceSafe: service ? false : variant.quality.marketplaceSafe,
      adsSafe: service ? false : variant.quality.adsSafe,
    }));
  }

  const saved = await persistProductTwin(db, {
    twinId,
    article: targetArticle,
    productName: input.product,
    category,
    sourceKind: `recolor_from:${base.twin.twinId}`,
    sourcePath: base.asset.url,
    promptLibrary: buildProductPromptLibrary({ article: targetArticle, product: input.product, category, cleanPrompt: prompt }),
    assets,
  });
  if (!saved.ok) return { ok: false, error: saved.error, status: 500 };
  return { ok: true, twin: saved.twin, previewUrlSource: recolored.imageUrl };
}
