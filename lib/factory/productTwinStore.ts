import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTwinAsset,
  pickBestTwinAsset,
  type ProductPromptLibrary,
  type ProductTwin,
  type ProductTwinAsset,
  type ProductTwinAssetDraft,
  type ProductTwinCategory,
  type ProductTwinPreparationPlan,
  type ProductTwinUseCase,
} from "./productTwin";
import { hasYandexDiskToken, uploadFactoryBufferToYandex } from "./yandexArchive";
import { assessProductTwinImage, type ProductTwinQualityResult } from "./productTwinQuality";

const BUCKET = "factory-media";
const DISK = "product_twin";

interface ContentAssetRow {
  id?: string;
  url?: string | null;
  path?: string | null;
  kind?: string | null;
  article?: string | null;
  niche?: string | null;
  analysis?: Record<string, unknown> | null;
  created_at?: string | null;
}

export async function downloadImageBuffer(url: string): Promise<{ ok: true; buffer: Buffer; contentType: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { ok: false, error: `download ${res.status}` };
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) return { ok: false, error: "empty image buffer" };
    return { ok: true, buffer, contentType: res.headers.get("content-type") || "image/png" };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e).slice(0, 160) };
  }
}

export async function buildTwinImageVariants(input: {
  cleanBuffer: Buffer;
  article: string;
  twinId: string;
  category?: ProductTwinCategory;
}): Promise<{ kind: ProductTwinAssetDraft["kind"]; buffer: Buffer; contentType: string; quality: ProductTwinQualityResult; metrics?: Record<string, unknown> }[]> {
  const normalized = await sharp(input.cleanBuffer)
    .resize(1400, 1400, { fit: "inside", withoutEnlargement: false, background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();

  const white = await sharp({
    create: { width: 1600, height: 1600, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  }).composite([{ input: normalized, gravity: "center" }]).png().toBuffer();

  const gray = await sharp({
    create: { width: 1600, height: 1600, channels: 4, background: { r: 238, g: 240, b: 242, alpha: 1 } },
  }).composite([{ input: normalized, gravity: "center" }]).png().toBuffer();

  const resized = await sharp(normalized).resize(1120, 1120, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const shadowSvg = Buffer.from(`<svg width="1600" height="1600" xmlns="http://www.w3.org/2000/svg"><ellipse cx="800" cy="1288" rx="360" ry="52" fill="rgba(15,23,42,0.20)"/></svg>`);
  const shadow = await sharp({
    create: { width: 1600, height: 1600, channels: 4, background: { r: 247, g: 248, b: 250, alpha: 1 } },
  }).composite([{ input: shadowSvg }, { input: resized, gravity: "center" }]).png().toBuffer();

  const upscaled = await sharp(input.cleanBuffer).resize(2200, 2200, { fit: "inside", withoutEnlargement: false }).sharpen().png().toBuffer();
  const mask = await buildObjectMask(normalized);
  const alpha = await buildAlphaMap(normalized);
  const depth = await buildDepthMap(mask.buffer);
  const segmentation = await buildSegmentationMap(mask.buffer);

  const raw = [
    { kind: "clean_png" as const, buffer: normalized, contentType: "image/png" },
    { kind: "white_bg" as const, buffer: white, contentType: "image/png" },
    { kind: "gray_bg" as const, buffer: gray, contentType: "image/png" },
    { kind: "shadow_bg" as const, buffer: shadow, contentType: "image/png" },
    { kind: "upscaled" as const, buffer: upscaled, contentType: "image/png" },
    { kind: "object_mask" as const, buffer: mask.buffer, contentType: "image/png", metrics: { object_coverage: mask.coverage } },
    { kind: "alpha" as const, buffer: alpha.buffer, contentType: "image/png", metrics: { alpha_coverage: alpha.coverage } },
    { kind: "depth_map" as const, buffer: depth.buffer, contentType: "image/png", metrics: { depth_strategy: depth.strategy, object_coverage: mask.coverage } },
    { kind: "segmentation" as const, buffer: segmentation.buffer, contentType: "image/png", metrics: { segments: segmentation.segments, object_coverage: mask.coverage } },
  ];
  return Promise.all(raw.map(async (item) => ({
    ...item,
    quality: await assessProductTwinImage({ buffer: item.buffer, kind: item.kind, category: input.category || "other" }),
  })));
}

async function buildObjectMask(input: Buffer): Promise<{ buffer: Buffer; coverage: number }> {
  const rgba = await sharp(input)
    .resize(1400, 1400, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const data = rgba.data as Buffer;
  const { width, height } = rgba.info;
  const corner = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [data[i] || 255, data[i + 1] || 255, data[i + 2] || 255];
  };
  const samples = [
    corner(0, 0),
    corner(Math.max(0, width - 1), 0),
    corner(0, Math.max(0, height - 1)),
    corner(Math.max(0, width - 1), Math.max(0, height - 1)),
  ];
  const bg = [0, 1, 2].map((ch) => Math.round(samples.reduce((sum, sample) => sum + sample[ch], 0) / samples.length));
  const mask = Buffer.alloc(width * height);
  let foreground = 0;
  let alphaForeground = 0;
  for (let p = 0, m = 0; p < data.length; p += 4, m++) {
    const alpha = data[p + 3] || 0;
    if (alpha > 24) alphaForeground++;
    const dist = Math.abs((data[p] || 0) - bg[0]) + Math.abs((data[p + 1] || 0) - bg[1]) + Math.abs((data[p + 2] || 0) - bg[2]);
    const isForeground = alpha > 24 && (alpha < 245 || dist > 42);
    mask[m] = isForeground ? 255 : 0;
    if (isForeground) foreground++;
  }
  if (alphaForeground / Math.max(1, width * height) < 0.96 && foreground < alphaForeground * 0.2) {
    for (let p = 0, m = 0; p < data.length; p += 4, m++) mask[m] = (data[p + 3] || 0) > 24 ? 255 : 0;
    foreground = alphaForeground;
  }
  const buffer = await sharp(mask, { raw: { width, height, channels: 1 } }).png().toBuffer();
  return { buffer, coverage: Math.round((foreground / Math.max(1, width * height)) * 1000) / 1000 };
}

async function buildAlphaMap(input: Buffer): Promise<{ buffer: Buffer; coverage: number }> {
  const rgba = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const data = rgba.data as Buffer;
  const { width, height } = rgba.info;
  const alpha = Buffer.alloc(width * height);
  let foreground = 0;
  for (let p = 0, a = 0; p < data.length; p += 4, a++) {
    alpha[a] = data[p + 3] || 0;
    if (alpha[a] > 24) foreground++;
  }
  const buffer = await sharp(alpha, { raw: { width, height, channels: 1 } }).png().toBuffer();
  return { buffer, coverage: Math.round((foreground / Math.max(1, width * height)) * 1000) / 1000 };
}

async function buildSegmentationMap(maskPng: Buffer): Promise<{ buffer: Buffer; segments: string[] }> {
  const mask = await sharp(maskPng).greyscale().raw().toBuffer({ resolveWithObject: true });
  const data = mask.data as Buffer;
  const { width, height } = mask.info;
  const rgb = Buffer.alloc(width * height * 3);
  for (let m = 0, p = 0; m < data.length; m++, p += 3) {
    const foreground = (data[m] || 0) > 127;
    rgb[p] = foreground ? 34 : 15;
    rgb[p + 1] = foreground ? 197 : 23;
    rgb[p + 2] = foreground ? 94 : 42;
  }
  const buffer = await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return { buffer, segments: ["background", "product"] };
}

async function buildDepthMap(maskPng: Buffer): Promise<{ buffer: Buffer; strategy: string }> {
  const mask = await sharp(maskPng).greyscale().raw().toBuffer({ resolveWithObject: true });
  const data = mask.data as Buffer;
  const { width, height } = mask.info;
  const depth = Buffer.alloc(width * height);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy) || 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if ((data[i] || 0) <= 127) {
        depth[i] = 12;
        continue;
      }
      const dist = Math.sqrt(Math.pow(x - cx, 2) + Math.pow(y - cy, 2)) / maxDist;
      depth[i] = Math.max(32, Math.min(230, Math.round(230 - dist * 128)));
    }
  }
  const buffer = await sharp(depth, { raw: { width, height, channels: 1 } }).blur(5).png().toBuffer();
  return { buffer, strategy: "mask_radial_v0" };
}

export async function uploadTwinAsset(db: SupabaseClient, input: {
  article: string;
  twinId: string;
  kind: ProductTwinAssetDraft["kind"];
  buffer: Buffer;
  contentType?: string;
}): Promise<{ url: string; path: string; storage: "yandex_disk" | "supabase" } | { error: string }> {
  const hash = createHash("sha1").update(input.buffer).digest("hex").slice(0, 16);
  if (hasYandexDiskToken()) {
    const yandex = await uploadFactoryBufferToYandex({
      buffer: input.buffer,
      contentType: input.contentType || "image/png",
      kind: "image",
      article: input.article,
      name: `${input.twinId}-${input.kind}`,
      subdir: "product-twin",
      folderSegments: [input.article, input.twinId],
      ext: "png",
    });
    if (yandex.status === "uploaded" && yandex.yandex_path) {
      return { url: yandex.yandex_url || `yandex-disk:${yandex.yandex_path}`, path: yandex.yandex_path, storage: "yandex_disk" };
    }
    console.warn(`[productTwinStore] Yandex upload failed for ${input.article}/${input.kind}: ${yandex.error || yandex.status}; falling back to Supabase storage`);
  }
  const path = `product-twins/${input.article}/${input.twinId}/${input.kind}-${hash}.png`;
  const { error } = await db.storage.from(BUCKET).upload(path, input.buffer, {
    contentType: input.contentType || "image/png",
    upsert: true,
    cacheControl: "31536000",
  });
  if (error) return { error: error.message };
  const url = db.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl || "";
  if (!url) return { error: "publicUrl missing" };
  return { url, path, storage: "supabase" };
}

export async function persistProductTwin(db: SupabaseClient, input: {
  twinId: string;
  article: string;
  productName: string;
  category: ProductTwinCategory;
  sourceKind: string;
  sourcePath?: string;
  sourceUrl?: string;
  promptLibrary: ProductPromptLibrary;
  preparationPlan?: ProductTwinPreparationPlan;
  assets: ProductTwinAsset[];
}): Promise<{ ok: true; twin: ProductTwin } | { ok: false; error: string }> {
  const createdAt = new Date().toISOString();
  const canonical = pickBestTwinAsset(input.assets, "broll") || input.assets[0];
  if (!canonical) return { ok: false, error: "нет assets для twin" };

  const twin: ProductTwin = {
    twinId: input.twinId,
    article: input.article,
    productName: input.productName,
    category: input.category,
    status: "ready",
    qualityScore: Math.max(...input.assets.map((a) => a.qualityScore)),
    canonicalAssetId: canonical.assetId,
    sourceKind: input.sourceKind,
    sourcePath: input.sourcePath,
    promptLibrary: input.promptLibrary,
    preparationPlan: input.preparationPlan,
    assets: input.assets,
    createdAt,
  };

  const rows = input.assets.map((asset) => ({
    disk: DISK,
    path: asset.path || `product-twins/${input.article}/${input.twinId}/${asset.kind}.png`,
    name: `${input.article} · twin · ${asset.kind}`.slice(0, 120),
    kind: "image",
    niche: input.category,
    article: input.article,
    color: null,
    url: asset.url,
    analyzed: true,
    analysis: {
      product_twin: {
        twin_id: input.twinId,
        article: input.article,
        product_name: input.productName,
        category: input.category,
        source_kind: input.sourceKind,
        source_path: input.sourcePath || null,
        source_url: input.sourceUrl || null,
        status: "ready",
        canonical_asset_id: twin.canonicalAssetId,
        quality_score: twin.qualityScore,
        prompt_library: input.promptLibrary,
        preparation_plan: input.preparationPlan || null,
      },
      product_twin_asset: {
        asset_id: asset.assetId,
        kind: asset.kind,
        truth_level: asset.truthLevel,
        quality_score: asset.qualityScore,
        quality_details: asset.qualityDetails || null,
        hero_ready: asset.heroReady,
        broll_ready: asset.brollReady,
        ugc_ready: asset.ugcReady,
        marketplace_safe: asset.marketplaceSafe,
        ads_safe: asset.adsSafe,
        risk: asset.risk,
        source_kind: asset.sourceKind || null,
      },
    },
  }));

  const { error } = await db.from("content_assets").insert(rows);
  if (error) return { ok: false, error: error.message };
  return { ok: true, twin };
}

function rowToAsset(row: ContentAssetRow): ProductTwinAsset | null {
  const tw = row.analysis?.product_twin as Record<string, unknown> | undefined;
  const a = row.analysis?.product_twin_asset as Record<string, unknown> | undefined;
  const twinId = String(tw?.twin_id || "");
  const article = String(tw?.article || row.article || "");
  const kind = String(a?.kind || "") as ProductTwinAssetDraft["kind"];
  const url = String(row.url || "");
  if (!twinId || !article || !kind || !url) return null;
  return createTwinAsset({
    twinId,
    article,
    kind,
    url,
    path: row.path || undefined,
    truthLevel: String(a?.truth_level || "derived") as ProductTwinAsset["truthLevel"],
    qualityScore: Number(a?.quality_score) || 0,
    qualityDetails: (a?.quality_details && typeof a.quality_details === "object" ? a.quality_details : undefined) as Record<string, unknown> | undefined,
    heroReady: Boolean(a?.hero_ready),
    brollReady: Boolean(a?.broll_ready),
    ugcReady: Boolean(a?.ugc_ready),
    marketplaceSafe: Boolean(a?.marketplace_safe),
    adsSafe: Boolean(a?.ads_safe),
    risk: String(a?.risk || "low") as ProductTwinAsset["risk"],
    sourceKind: String(a?.source_kind || "") || undefined,
  });
}

function rowsToTwin(rows: ContentAssetRow[]): ProductTwin | null {
  const assets = rows.map(rowToAsset).filter(Boolean) as ProductTwinAsset[];
  if (!assets.length) return null;
  const first = rows.find((r) => r.analysis?.product_twin)?.analysis?.product_twin as Record<string, unknown>;
  const twinId = String(first?.twin_id || assets[0].twinId);
  const promptLibrary = (first?.prompt_library || {}) as ProductPromptLibrary;
  const preparationPlan = (first?.preparation_plan && typeof first.preparation_plan === "object" ? first.preparation_plan : undefined) as ProductTwinPreparationPlan | undefined;
  return {
    twinId,
    article: String(first?.article || assets[0].article),
    productName: String(first?.product_name || assets[0].article),
    category: String(first?.category || "other") as ProductTwinCategory,
    status: String(first?.status || "ready") as ProductTwin["status"],
    qualityScore: Number(first?.quality_score) || Math.max(...assets.map((a) => a.qualityScore)),
    canonicalAssetId: String(first?.canonical_asset_id || assets[0].assetId),
    sourceKind: String(first?.source_kind || ""),
    sourcePath: String(first?.source_path || "") || undefined,
    promptLibrary,
    preparationPlan,
    assets,
    createdAt: String(rows[0]?.created_at || ""),
  };
}

export async function getProductTwinById(db: SupabaseClient, twinId: string): Promise<ProductTwin | null> {
  const { data } = await db.from("content_assets")
    .select("id,url,path,kind,article,niche,analysis,created_at")
    .eq("disk", DISK)
    .contains("analysis", { product_twin: { twin_id: twinId } })
    .not("url", "is", null)
    .order("created_at", { ascending: false })
    .limit(80);
  return rowsToTwin((data as ContentAssetRow[] | null) || []);
}

export async function getLatestProductTwinByArticle(db: SupabaseClient, article: string): Promise<ProductTwin | null> {
  const { data } = await db.from("content_assets")
    .select("id,url,path,kind,article,niche,analysis,created_at")
    .eq("disk", DISK)
    .eq("article", article)
    .not("url", "is", null)
    .order("created_at", { ascending: false })
    .limit(80);
  const rows = ((data as ContentAssetRow[] | null) || []);
  const latestId = rows.map((r) => (r.analysis?.product_twin as Record<string, unknown> | undefined)?.twin_id).find(Boolean);
  return latestId ? rowsToTwin(rows.filter((r) => (r.analysis?.product_twin as Record<string, unknown> | undefined)?.twin_id === latestId)) : null;
}

export async function getBestProductTwinAsset(db: SupabaseClient, input: { twinId?: string; article?: string; useCase: ProductTwinUseCase }): Promise<{ twin: ProductTwin; asset: ProductTwinAsset } | null> {
  const twin = input.twinId ? await getProductTwinById(db, input.twinId) : input.article ? await getLatestProductTwinByArticle(db, input.article) : null;
  if (!twin) return null;
  const asset = pickBestTwinAsset(twin.assets, input.useCase);
  return asset ? { twin, asset } : null;
}
