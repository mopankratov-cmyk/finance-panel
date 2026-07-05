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
    "Also recolor any visible interior lining fabric (inside the hood, inside the collar) to this SAME new colour — no contrasting lining, the inside must match the outside.",
    "Keep EVERYTHING else pixel-identical: the exact silhouette, garment length, cut, hood/collar, zipper and buttons, pockets, seams, stitching, drawcord, cuffs, hardware colour, belt/tie if present, proportions, fabric texture and folds, camera angle, pose, background and lighting.",
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

// ── Ретушь твина: точечная правка (убрать вшитый рукавный шильдик, утяжку и т.п.) ──
// Правка не трогает геометрию/цвет — только удаляет ошибочно дорисованную деталь.
// Результат сохраняется как новый твин ТОГО ЖЕ артикула (становится latest).

export const RETOUCH_PRESETS: Record<string, string> = {
  sleeve_patch: "remove the small rectangular badge, patch or logo tag on the sleeve (it is an AI artifact, not a real part of the garment)",
  sleeve_toggle: "remove the elastic drawcord toggle/cord-lock on the lower sleeve",
  chest_patch: "remove any invented badge or patch on the chest that is not part of the real product",
  hood: "remove the hood — this garment has a collar, not a hood",
};

export function buildRetouchPrompt(product: string, instructions: string[], hasReferenceImage?: boolean): string {
  const edits = instructions.filter(Boolean).join("; ");
  return [
    `Edit this clean product photo of ${product} (the FIRST image). ${edits}.`,
    hasReferenceImage
      ? "The SECOND image is a reference showing the exact detail/construction to copy — match its style, proportions and placement precisely, adapted to this garment's own fabric colour and camera angle. Do not copy the reference image's background, garment colour, or anything else besides the specific detail described above."
      : "",
    "Keep EVERYTHING else pixel-identical: exact silhouette, garment length, cut, color, hood/collar, zipper, buttons, pockets, seams, stitching, cuffs, hardware, proportions, fabric texture, camera angle, background and lighting.",
    "Only add/remove/fix the named detail; do not restyle, recolor, resize or add anything else.",
    "Photorealistic, same clean studio packshot, vertical 9:16, sharp fabric detail.",
  ].filter(Boolean).join(" ");
}

export async function retouchTwin(db: SupabaseClient, input: {
  article: string;
  twinId?: string;
  product: string;
  instructions: string[];          // готовые фразы или ключи RETOUCH_PRESETS
  referenceImageUrls?: string[];   // опционально: доп. референс-фото (напр. деталь от Андрея)
}): Promise<{ ok: true; twin: ProductTwin; previewUrlSource: string } | { ok: false; error: string; status?: number }> {
  const article = String(input.article || "").trim();
  if (!article) return { ok: false, error: "нужен article", status: 400 };
  if (!input.instructions?.length) return { ok: false, error: "нужны instructions (что убрать)", status: 400 };
  if (!process.env.FAL_KEY && !process.env.FAL_BILLING_KEY) return { ok: false, error: "FAL_KEY не настроен", status: 500 };

  const base = await getBestProductTwinAsset(db, {
    twinId: input.twinId,
    article: input.twinId ? undefined : article,
    useCase: "hero",
    allowFailedIdentity: true,
  });
  if (!base) return { ok: false, error: `твин для ${article} не найден`, status: 404 };

  const resolved = input.instructions.map((i) => RETOUCH_PRESETS[i] || i);
  const category = normalizeTwinCategory("apparel", article, input.product);
  const publicBase = await rehostImageForFal(base.asset.url);
  const referenceImages = (input.referenceImageUrls || []).filter(Boolean);
  const prompt = buildRetouchPrompt(input.product, resolved, referenceImages.length > 0);
  const edited = await runNanoBananaEdit({ image: publicBase, referenceImages, prompt });
  if (!edited.ok) return { ok: false, error: edited.error, status: edited.responseUrl ? 504 : 502 };

  const downloaded = await downloadImageBuffer(edited.imageUrl);
  if (!downloaded.ok) return { ok: false, error: `retouch download failed: ${downloaded.error}`, status: 502 };

  const twinId = buildTwinId({ article, source: `retouch:${base.twin.twinId}`, version: `retouch-${Date.now()}` });
  const variants = await buildTwinImageVariants({ cleanBuffer: downloaded.buffer, article, twinId, category });
  const serviceKinds = new Set(["object_mask", "alpha", "depth_map", "segmentation"]);
  const assets: ProductTwinAsset[] = [];
  for (const variant of variants) {
    const uploaded = await uploadTwinAsset(db, { article, twinId, kind: variant.kind, buffer: variant.buffer, contentType: variant.contentType });
    if ("error" in uploaded) return { ok: false, error: `upload ${variant.kind}: ${uploaded.error}`, status: 502 };
    const service = serviceKinds.has(variant.kind);
    assets.push(createTwinAsset({
      twinId, article, kind: variant.kind, url: uploaded.url, path: uploaded.path,
      truthLevel: variant.kind === "clean_png" || variant.kind === "upscaled" ? "truthful" : "derived",
      qualityScore: variant.quality.qualityScore,
      qualityDetails: { ...(variant.quality.rejectReasons ? { reject_reasons: variant.quality.rejectReasons } : {}), retouched_from: base.twin.twinId, edits: resolved },
      risk: variant.quality.identityRisk,
      sourceKind: "retouch",
      brollReady: service ? false : variant.quality.brollReady,
      heroReady: service ? false : variant.quality.heroReady,
      ugcReady: service ? false : variant.quality.brollReady && ["shadow_bg", "clean_png"].includes(variant.kind),
      marketplaceSafe: service ? false : variant.quality.marketplaceSafe,
      adsSafe: service ? false : variant.quality.adsSafe,
    }));
  }
  const saved = await persistProductTwin(db, {
    twinId, article, productName: input.product, category,
    sourceKind: `retouch_from:${base.twin.twinId}`,
    sourcePath: base.asset.url,
    promptLibrary: buildProductPromptLibrary({ article, product: input.product, category, cleanPrompt: prompt }),
    assets,
  });
  if (!saved.ok) return { ok: false, error: saved.error, status: 500 };
  return { ok: true, twin: saved.twin, previewUrlSource: edited.imageUrl };
}
