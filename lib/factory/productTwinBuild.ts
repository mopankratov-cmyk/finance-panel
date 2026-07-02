import sharp from "sharp";
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
  setProductTwinIdentityVerdict,
  uploadTwinAsset,
} from "@/lib/factory/productTwinStore";
import { focusProductSourceImage } from "./productSourceCrop";
import { checkTwinIdentity, type TwinIdentityCheckResult } from "./productTwinIdentityCheck";
import { isBannedTwinSourceName, twinSourceForArticle } from "./twinSourceManifest";
import { contentFolderForSku } from "./wbSellerCatalog";
import { wbCardPhotoUrls } from "./wbCardPhotos";
import { screenTwinSourceCandidate } from "./twinSourceScreen";
import { yaCollectImages, yaDownloadHref } from "@/lib/yandex/disk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pickProductSourceCandidates } from "./productSourcePicker";
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

  const article = cleanText(body.article, 80);
  const product = cleanText(body.product, 160);
  let diskPath = cleanText(body.disk_path || body.diskPath, 1200);
  let diskId = cleanText(body.disk || "design", 80);
  let sourcePicked = false;
  let sourceKindOverride = "";
  const screenNotes: string[] = [];

  // 1) Манифест исходников (визуальный аудит 2026-07-02): проверенный глазами чистый кадр
  //    в приоритете над любыми эвристиками. blocked = чистого кадра в съёмке нет вообще.
  if (!diskPath) {
    const manifest = twinSourceForArticle(article);
    if (manifest?.blocked) return { error: `у ${article} нет чистого исходника для твина: ${manifest.note}` };
    if (manifest) {
      const disk = diskById(manifest.disk);
      if (disk) {
        for (const candidate of [manifest.path, ...(manifest.fallbacks || [])]) {
          const href = await yaDownloadHref(candidate, disk.key);
          if (href) {
            diskPath = candidate;
            diskId = manifest.disk;
            sourceKindOverride = "manifest_source";
            break;
          }
        }
      }
    }
  }

  // 1.5) Фото карточки WB по артикулу (публичный CDN): АРТИКУЛ-ТОЧНЫЙ источник для любого
  //      каталожного SKU. Каждый URL привязан к конкретному цвету — «какой это товар» не угадываем.
  //      Кандидаты (обложка → края → середина) проходят vision-скрин; первый чистый перёд — источник.
  if (!diskPath) {
    const wbUrls = wbCardPhotoUrls(article, 8);
    for (const url of wbUrls) {
      const probe = await fetchWithRetry(url, { cache: "no-store" }, 3);
      if (!probe.ok) continue;
      const raw = Buffer.from(await probe.arrayBuffer());
      if (!raw.length) continue;
      // WB отдаёт webp — приводим к png для nano-banana/sharp-совместимости.
      const png = await sharp(raw).png().toBuffer().catch(() => null);
      if (!png) continue;
      const screen = await screenTwinSourceCandidate({ buffer: png, article, product, category });
      if (screen.ran && !screen.ok) {
        screenNotes.push(`${url.split("/").slice(-1)[0]}: ${screen.reasons.join("; ") || "отклонён скрином"}`);
        continue;
      }
      if (screen.ran && screen.role && !["front", "three_quarter", "on_model"].includes(screen.role)) {
        screenNotes.push(`${url.split("/").slice(-1)[0]}: ракурс ${screen.role} — не перёд`);
        continue;
      }
      const focused = await focusProductSourceImage({ buffer: png, contentType: "image/png", category, article });
      return {
        image: imageBufferToDataUrl(focused.buffer, focused.contentType),
        sourceKind: focused.applied ? "wb_card_photo_focus_crop" : "wb_card_photo",
        sourceUrl: url,
        focusStrategy: focused.applied ? focused.strategy : undefined,
      };
    }
    // Ни одна WB-карточка не прошла скрин — НЕ ошибка: проваливаемся к съёмочной папке/пикеру.
    // screenNotes копятся и попадут в финальную диагностику, если и остальные источники пусты.
  }

  // 2) Полный SKU из WB-каталога (например NV-08-48 капучино): кандидаты — сырые кадры
  //    из съёмочной папки его цвета, каждый через vision-скрин.
  if (!diskPath) {
    const catalogFolder = contentFolderForSku(article);
    if (catalogFolder && "pending" in catalogFolder) return { error: `у ${article} нет контента: ${catalogFolder.pending}` };
    if (catalogFolder) {
      const disk = diskById(catalogFolder.disk);
      if (disk) {
        const images = (await yaCollectImages(catalogFolder.prefix, 1, disk.key))
          .filter((item) => /^IMG_\d+/i.test(item.name) && !isBannedTwinSourceName(article, item.path))
          .sort((a, b) => a.name.localeCompare(b.name));
        // Перёд обычно в середине серии съёмки — начинаем с середины, максимум 5 попыток.
        const ordered = [...images.slice(Math.floor(images.length / 2)), ...images.slice(0, Math.floor(images.length / 2))].slice(0, 5);
        for (const item of ordered) {
          const href = await yaDownloadHref(item.path, disk.key);
          if (!href) continue;
          const probe = await fetchWithRetry(href, { cache: "no-store" }, 3);
          if (!probe.ok) continue;
          const probeBuf = Buffer.from(await probe.arrayBuffer());
          if (!probeBuf.length) continue;
          const screen = await screenTwinSourceCandidate({ buffer: probeBuf, article, product, category });
          if (screen.ran && !screen.ok) {
            screenNotes.push(`${item.name}: ${screen.reasons.join("; ") || "отклонён скрином"}`);
            continue;
          }
          if (screen.ran && screen.role && !["front", "three_quarter", "on_model"].includes(screen.role)) {
            screenNotes.push(`${item.name}: ракурс ${screen.role} — не перёд`);
            continue;
          }
          diskPath = item.path;
          diskId = catalogFolder.disk;
          sourceKindOverride = "catalog_color_folder";
          break;
        }
        if (!diskPath) return { error: `в папке ${catalogFolder.prefix} не найден чистый перёд: ${screenNotes.join(" · ") || "нет кандидатов"}`.slice(0, 600) };
      }
    }
  }

  // 3) Слепой пикер — последний fallback, каждый кандидат проходит vision-скрин
  //    (вшитый текст / перекрытый товар / подозрение на AI-рендер отклоняются).
  if (!diskPath) {
    const candidates = (await pickProductSourceCandidates({ article, product, limit: 4, probeLimit: 12 }))
      .filter((candidate) => !isBannedTwinSourceName(article, candidate.path));
    for (const candidate of candidates) {
      const disk = diskById(candidate.disk);
      if (!disk) continue;
      const href = await yaDownloadHref(candidate.path, disk.key);
      if (!href) continue;
      const probe = await fetchWithRetry(href, { cache: "no-store" }, 3);
      if (!probe.ok) continue;
      const probeBuf = Buffer.from(await probe.arrayBuffer());
      if (!probeBuf.length) continue;
      const screen = await screenTwinSourceCandidate({ buffer: probeBuf, article, product, category });
      if (screen.ran && !screen.ok) {
        screenNotes.push(`${candidate.path.split("/").pop()}: ${screen.reasons.join("; ") || "отклонён скрином"}`);
        continue;
      }
      diskPath = candidate.path;
      diskId = candidate.disk;
      sourcePicked = true;
      break;
    }
    if (!diskPath && screenNotes.length) {
      return { error: `все кандидаты пикера отклонены vision-скрином: ${screenNotes.join(" · ")}`.slice(0, 600) };
    }
  }

  if (!diskPath) return { error: "нужен image_url, image_data_url или disk_path" };
  const disk = diskById(diskId);
  if (!disk) return { error: "неизвестный disk" };
  if (isBannedTwinSourceName(article, diskPath)) return { error: `исходник ${diskPath} запрещён манифестом (AI-рендер/карточка)` };
  const href = await yaDownloadHref(diskPath, disk.key);
  if (!href) return { error: `не удалось получить download href для ${diskPath}` };
  const img = await fetchWithRetry(href, { cache: "no-store" }, 5);
  if (!img.ok) return { error: `download ${img.status}` };
  const contentType = img.headers.get("content-type") || "image/png";
  const buf = Buffer.from(await img.arrayBuffer());
  if (!buf.length) return { error: "пустой image buffer" };
  const focused = await focusProductSourceImage({ buffer: buf, contentType, category, article });
  return {
    image: imageBufferToDataUrl(focused.buffer, focused.contentType),
    sourceKind: sourceKindOverride
      || (focused.applied ? (sourcePicked ? "picked_disk_path_focus_crop" : "disk_path_focus_crop") : sourcePicked ? "picked_disk_path" : "disk_path"),
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
  identityCheck?: TwinIdentityCheckResult;
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

  // Identity-сверка «оригинал vs твин» сразу после сохранения: вердикт пишется в базу,
  // fail-твин мгновенно блокируется гейтом getBestProductTwinAsset (b-roll уходит на реальные фото).
  let identityCheck: TwinIdentityCheckResult = { ran: false, reasons: [], error: "исходник для сверки недоступен" };
  const sourceBuffer = await resolveSourceBufferForIdentity(resolved.image);
  if (sourceBuffer) {
    identityCheck = await checkTwinIdentity({ sourceBuffer, twinBuffer: downloaded.buffer, article, product, category });
    if (identityCheck.ran && identityCheck.verdict) {
      await setProductTwinIdentityVerdict(db, {
        twinId,
        verdict: identityCheck.verdict,
        reasons: identityCheck.reasons,
        source: "build_auto_check",
      });
    }
  }

  return { ok: true, twin: saved.twin, cleanUrl: clean.imageUrl, sourceKind: resolved.sourceKind, sourcePath: resolved.sourcePath, identityCheck };
}

async function resolveSourceBufferForIdentity(image: string): Promise<Buffer | null> {
  if (image.startsWith("data:image/")) {
    const base64 = image.split(",")[1] || "";
    return base64 ? Buffer.from(base64, "base64") : null;
  }
  if (/^https?:\/\//i.test(image)) {
    const downloaded = await downloadImageBuffer(image);
    return downloaded.ok ? downloaded.buffer : null;
  }
  return null;
}
