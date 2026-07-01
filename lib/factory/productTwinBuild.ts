import { diskById } from "@/lib/factory/contentDisks";
import { buildProductCleanPrompt, imageBufferToDataUrl } from "@/lib/factory/productCleanSource";
import { fetchWithRetry, runNanoBananaEdit } from "@/lib/factory/falImageEdit";
import {
  buildProductPromptLibrary,
  buildTwinId,
  createTwinAsset,
  normalizeTwinCategory,
  type ProductTwin,
  type ProductTwinAsset,
} from "@/lib/factory/productTwin";
import {
  buildTwinImageVariants,
  downloadImageBuffer,
  getLatestProductTwinByArticle,
  persistProductTwin,
  uploadTwinAsset,
} from "@/lib/factory/productTwinStore";
import { focusProductSourceImage } from "./productSourceCrop";
import { yaDownloadHref } from "@/lib/yandex/disk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pickProductSource } from "./productSourcePicker";
import { buildProductTwinPreparationPlan } from "./productTwinPrepPlan";

export interface ProductTwinBuildInput {
  article: string;
  product?: string;
  category?: string;
  disk?: string;
  disk_path?: string;
  diskPath?: string;
  image_url?: string;
  imageUrl?: string;
  image_data_url?: string;
  imageDataUrl?: string;
  clean_prompt?: string;
  cleanPrompt?: string;
  twin_id?: string;
  twinId?: string;
  force?: boolean;
  rebuild?: boolean;
  min_quality?: number;
  minQuality?: number;
}

function cleanText(value: unknown, max = 1200): string {
  return String(value || "").trim().slice(0, max);
}

function cleanLongText(value: unknown, max = 20_000_000): string {
  return String(value || "").trim().slice(0, max);
}

async function resolveInputImage(body: ProductTwinBuildInput): Promise<{ image: string; sourceKind: string; sourcePath?: string; sourceUrl?: string; sourcePicked?: boolean; focusStrategy?: string } | { error: string }> {
  const category = normalizeTwinCategory(body.category, cleanText(body.article, 80), cleanText(body.product, 160));
  const directData = cleanLongText(body.image_data_url || body.imageDataUrl);
  if (directData.startsWith("data:image/")) return { image: directData, sourceKind: "data_url" };

  const directUrl = cleanText(body.image_url || body.imageUrl, 4000);
  if (/^https?:\/\//i.test(directUrl)) return { image: directUrl, sourceKind: "image_url", sourceUrl: directUrl };

  let diskPath = cleanText(body.disk_path || body.diskPath, 1200);
  let diskId = cleanText(body.disk || "design", 80);
  let sourcePicked = false;
  if (!diskPath) {
    const picked = await pickProductSource({ article: cleanText(body.article, 80), product: cleanText(body.product, 160) });
    if (picked) {
      diskPath = picked.path;
      diskId = picked.disk;
      sourcePicked = true;
    }
  }
  if (!diskPath) return { error: "нужен image_url, image_data_url или disk_path" };
  const disk = diskById(diskId);
  if (!disk) return { error: "неизвестный disk" };
  const href = await yaDownloadHref(diskPath, disk.key);
  if (!href) return { error: `не удалось получить download href для ${diskPath}` };
  const img = await fetchWithRetry(href, { cache: "no-store" }, 5);
  if (!img.ok) return { error: `download ${img.status}` };
  const contentType = img.headers.get("content-type") || "image/png";
  const buf = Buffer.from(await img.arrayBuffer());
  if (!buf.length) return { error: "пустой image buffer" };
  const focused = await focusProductSourceImage({ buffer: buf, contentType, category, article: cleanText(body.article, 80) });
  return {
    image: imageBufferToDataUrl(focused.buffer, focused.contentType),
    sourceKind: focused.applied ? (sourcePicked ? "picked_disk_path_focus_crop" : "disk_path_focus_crop") : sourcePicked ? "picked_disk_path" : "disk_path",
    sourcePath: diskPath,
    sourcePicked,
    focusStrategy: focused.applied ? focused.strategy : undefined,
  };
}

export async function buildProductTwin(input: ProductTwinBuildInput, db: SupabaseClient): Promise<{
  ok: true;
  twin: ProductTwin;
  cleanUrl: string;
  sourceKind: string;
  sourcePath?: string;
} | { ok: false; error: string; status?: number; responseUrl?: string }> {
  const article = cleanText(input.article, 80);
  if (!article) return { ok: false, error: "нужен article", status: 400 };
  if (!process.env.FAL_KEY && !process.env.FAL_BILLING_KEY) return { ok: false, error: "FAL_KEY не настроен", status: 500 };

  const product = cleanText(input.product || article, 160);
  const category = normalizeTwinCategory(input.category, article, product);
  const force = input.force === true || input.rebuild === true;
  const minQuality = Math.max(0, Math.min(1, Number(input.min_quality ?? input.minQuality ?? 0.68) || 0.68));
  const explicitTwinId = cleanText(input.twin_id || input.twinId, 120);
  let existing: ProductTwin | null = null;
  if (!explicitTwinId) {
    existing = await getLatestProductTwinByArticle(db, article);
  }
  if (!force && existing) {
    const hasServicePack = existing ? ["object_mask", "alpha", "depth_map", "segmentation"].every((kind) => existing.assets.some((asset) => asset.kind === kind)) : false;
    const hasBroll = existing ? existing.assets.some((asset) => asset.brollReady) : false;
    if (existing && existing.status === "ready" && existing.qualityScore >= minQuality && hasBroll && hasServicePack) {
      return {
        ok: true,
        twin: existing,
        cleanUrl: existing.assets.find((asset) => asset.kind === "clean_png")?.url || existing.assets[0]?.url || "",
        sourceKind: "reused_product_twin",
        sourcePath: existing.sourcePath,
      };
    }
  }
  const resolved = await resolveInputImage(input);
  if ("error" in resolved) return { ok: false, error: resolved.error, status: 400 };

  const cleanCategory = category === "other" ? undefined : category;
  const cleanPrompt = cleanText(input.clean_prompt || input.cleanPrompt, 8000) || buildProductCleanPrompt({ article, product, category: cleanCategory });
  const twinId = explicitTwinId || buildTwinId({
    article,
    source: resolved.sourcePath || resolved.sourceUrl || resolved.sourceKind,
    version: existing || force ? `rebuild-${Date.now()}` : "v0",
  });
  const promptLibrary = buildProductPromptLibrary({ article, product, category, cleanPrompt });
  const preparationPlan = buildProductTwinPreparationPlan({ article, product, category });

  const clean = await runNanoBananaEdit({ image: resolved.image, prompt: cleanPrompt });
  if (!clean.ok) return { ok: false, error: clean.error, responseUrl: clean.responseUrl, status: clean.responseUrl ? 504 : 502 };

  const downloaded = await downloadImageBuffer(clean.imageUrl);
  if (!downloaded.ok) return { ok: false, error: `clean download failed: ${downloaded.error}`, status: 502 };
  const variants = await buildTwinImageVariants({ cleanBuffer: downloaded.buffer, article, twinId, category });

  const assets: ProductTwinAsset[] = [];
  for (const variant of variants) {
    const uploaded = await uploadTwinAsset(db, { article, twinId, kind: variant.kind, buffer: variant.buffer, contentType: variant.contentType });
    if ("error" in uploaded) return { ok: false, error: `upload ${variant.kind}: ${uploaded.error}`, status: 502 };
    const serviceAsset = ["object_mask", "alpha", "depth_map", "segmentation"].includes(variant.kind);
    assets.push(createTwinAsset({
      twinId,
      article,
      kind: variant.kind,
      url: uploaded.url,
      path: uploaded.path,
      truthLevel: variant.kind === "clean_png" || variant.kind === "upscaled" ? "truthful" : "derived",
      qualityScore: variant.quality.qualityScore,
      qualityDetails: {
        sharpness_score: variant.quality.sharpnessScore,
        exposure_score: variant.quality.exposureScore,
        composition_score: variant.quality.compositionScore,
        object_coverage: variant.quality.objectCoverage,
        label_detail_score: variant.quality.labelDetailScore,
        background_cleanliness: variant.quality.backgroundCleanliness,
        identity_risk: variant.quality.identityRisk,
        reject_reasons: variant.quality.rejectReasons,
        ...(variant.metrics || {}),
      },
      risk: variant.quality.identityRisk,
      sourceKind: variant.kind === "clean_png" ? "fal_clean" : "sharp_derived",
      brollReady: serviceAsset ? false : variant.quality.brollReady,
      heroReady: serviceAsset ? false : variant.quality.heroReady,
      ugcReady: serviceAsset ? false : variant.quality.brollReady && ["shadow_bg", "clean_png"].includes(variant.kind),
      marketplaceSafe: serviceAsset ? false : variant.quality.marketplaceSafe,
      adsSafe: serviceAsset ? false : variant.quality.adsSafe,
    }));
  }

  const saved = await persistProductTwin(db, {
    twinId,
    article,
    productName: product,
    category,
    sourceKind: resolved.sourceKind,
    sourcePath: resolved.sourcePath,
    sourceUrl: resolved.sourceUrl,
    promptLibrary,
    preparationPlan,
    assets,
  });
  if (!saved.ok) return { ok: false, error: saved.error, status: 500 };
  return { ok: true, twin: saved.twin, cleanUrl: clean.imageUrl, sourceKind: resolved.sourceKind, sourcePath: resolved.sourcePath };
}
