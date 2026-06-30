import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { diskById } from "@/lib/factory/contentDisks";
import { buildProductCleanPrompt, imageBufferToDataUrl } from "@/lib/factory/productCleanSource";
import { fetchWithRetry, runNanoBananaEdit } from "@/lib/factory/falImageEdit";
import {
  buildProductPromptLibrary,
  buildTwinId,
  createTwinAsset,
  normalizeTwinCategory,
  type ProductTwinAsset,
} from "@/lib/factory/productTwin";
import {
  buildTwinImageVariants,
  downloadImageBuffer,
  persistProductTwin,
  uploadTwinAsset,
} from "@/lib/factory/productTwinStore";
import { yaDownloadHref } from "@/lib/yandex/disk";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function cleanText(value: unknown, max = 1200): string {
  return String(value || "").trim().slice(0, max);
}

function cleanLongText(value: unknown, max = 20_000_000): string {
  return String(value || "").trim().slice(0, max);
}

async function resolveInputImage(body: Record<string, unknown>): Promise<{ image: string; sourceKind: string; sourcePath?: string; sourceUrl?: string } | { error: string }> {
  const directData = cleanLongText(body.image_data_url || body.imageDataUrl);
  if (directData.startsWith("data:image/")) return { image: directData, sourceKind: "data_url" };

  const directUrl = cleanText(body.image_url || body.imageUrl, 4000);
  if (/^https?:\/\//i.test(directUrl)) return { image: directUrl, sourceKind: "image_url", sourceUrl: directUrl };

  const diskPath = cleanText(body.disk_path || body.diskPath, 1200);
  if (!diskPath) return { error: "нужен image_url, image_data_url или disk_path" };
  const disk = diskById(cleanText(body.disk || "design", 80));
  if (!disk) return { error: "неизвестный disk" };
  const href = await yaDownloadHref(diskPath, disk.key);
  if (!href) return { error: `не удалось получить download href для ${diskPath}` };
  const img = await fetchWithRetry(href, { cache: "no-store" }, 5);
  if (!img.ok) return { error: `download ${img.status}` };
  const contentType = img.headers.get("content-type") || "image/png";
  const buf = Buffer.from(await img.arrayBuffer());
  if (!buf.length) return { error: "пустой image buffer" };
  return { image: imageBufferToDataUrl(buf, contentType), sourceKind: "disk_path", sourcePath: diskPath };
}

export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    if (!process.env.FAL_KEY) return NextResponse.json({ ok: false, error: "FAL_KEY не настроен" }, { status: 500 });

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const article = cleanText(body.article || body.sku_art, 80);
    if (!article) return NextResponse.json({ ok: false, error: "нужен article" }, { status: 400 });
    const product = cleanText(body.product || body.product_name || article, 160);
    const category = normalizeTwinCategory(body.category, article, product);
    const resolved = await resolveInputImage(body);
    if ("error" in resolved) return NextResponse.json({ ok: false, error: resolved.error }, { status: 400 });

    const cleanCategory = category === "other" ? undefined : category;
    const cleanPrompt = cleanText(body.clean_prompt || body.cleanPrompt, 8000) || buildProductCleanPrompt({ article, product, category: cleanCategory });
    const twinId = cleanText(body.twin_id || body.twinId, 120) || buildTwinId({ article, source: resolved.sourcePath || resolved.sourceUrl || resolved.sourceKind });
    const promptLibrary = buildProductPromptLibrary({ article, product, category, cleanPrompt });

    const clean = await runNanoBananaEdit({ image: resolved.image, prompt: cleanPrompt });
    if (!clean.ok) return NextResponse.json({ ok: false, error: clean.error, response_url: clean.responseUrl }, { status: clean.responseUrl ? 504 : 502 });

    const downloaded = await downloadImageBuffer(clean.imageUrl);
    if (!downloaded.ok) return NextResponse.json({ ok: false, error: `clean download failed: ${downloaded.error}` }, { status: 502 });
    const variants = await buildTwinImageVariants({ cleanBuffer: downloaded.buffer, article, twinId });

    const assets: ProductTwinAsset[] = [];
    for (const variant of variants) {
      const uploaded = await uploadTwinAsset(db, { article, twinId, kind: variant.kind, buffer: variant.buffer, contentType: variant.contentType });
      if ("error" in uploaded) return NextResponse.json({ ok: false, error: `upload ${variant.kind}: ${uploaded.error}` }, { status: 502 });
      assets.push(createTwinAsset({
        twinId,
        article,
        kind: variant.kind,
        url: uploaded.url,
        path: uploaded.path,
        truthLevel: variant.kind === "clean_png" || variant.kind === "upscaled" ? "truthful" : "derived",
        qualityScore: variant.qualityScore,
        sourceKind: variant.kind === "clean_png" ? "fal_clean" : "sharp_derived",
        brollReady: ["clean_png", "shadow_bg", "white_bg", "upscaled"].includes(variant.kind),
        heroReady: ["shadow_bg", "white_bg", "gray_bg", "upscaled"].includes(variant.kind),
        ugcReady: ["shadow_bg", "clean_png"].includes(variant.kind),
        marketplaceSafe: true,
        adsSafe: true,
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
      assets,
    });
    if (!saved.ok) return NextResponse.json({ ok: false, error: saved.error }, { status: 500 });

    return NextResponse.json({
      ok: true,
      twin_id: saved.twin.twinId,
      article,
      product,
      category,
      status: saved.twin.status,
      quality_score: saved.twin.qualityScore,
      canonical_asset_id: saved.twin.canonicalAssetId,
      source_kind: resolved.sourceKind,
      source_path: resolved.sourcePath || null,
      clean_url: clean.imageUrl,
      assets: saved.twin.assets.map((a) => ({
        asset_id: a.assetId,
        kind: a.kind,
        url: a.url,
        quality_score: a.qualityScore,
        broll_ready: a.brollReady,
        hero_ready: a.heroReady,
        marketplace_safe: a.marketplaceSafe,
      })),
      prompt_library: saved.twin.promptLibrary,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "product-twin/build crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
