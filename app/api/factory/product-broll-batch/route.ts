import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { prepareProductImage } from "@/lib/factory/sourcePrep";
import { rehostImageForFal } from "@/lib/factory/rehostImage";
import { buildProductBrollPlan, type ProductBrollRecipe } from "@/lib/factory/productBrollBatch";
import { buildProductCleanPrompt, imageBufferToDataUrl } from "@/lib/factory/productCleanSource";
import { diskById } from "@/lib/factory/contentDisks";
import { fetchWithRetry, runNanoBananaEdit } from "@/lib/factory/falImageEdit";
import { getBestProductTwinAsset, getLatestProductTwinByArticle, getProductTwinViewAssets } from "@/lib/factory/productTwinStore";
import { productTwinAssetPreviewUrl } from "@/lib/factory/productTwinPreview";
import { falVideoSubmitDetailed, FAL_VIDEO_MODELS, type FalVideoModel } from "@/lib/factory/falVideo";
import { yaDownloadHref } from "@/lib/yandex/disk";
import { type ProductCategory } from "@/lib/factory/editPrompts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface AssetRow {
  url: string;
  niche?: string | null;
  analysis?: { source_url?: string } | null;
}

function cleanText(value: unknown, max = 160): string {
  return String(value || "").trim().slice(0, max);
}

function cleanLongText(value: unknown, max = 20_000_000): string {
  return String(value || "").trim().slice(0, max);
}

function cleanModel(value: unknown): FalVideoModel {
  const raw = cleanText(value, 40);
  return raw in FAL_VIDEO_MODELS ? raw as FalVideoModel : "kling";
}

async function latestPrepared(article: string): Promise<AssetRow | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("content_assets")
    .select("url,niche,analysis")
    .eq("article", article)
    .eq("disk", "prepared")
    .eq("kind", "image")
    .not("url", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data as AssetRow[] | null) || [])[0] || null;
}

async function firstWbImage(article: string): Promise<AssetRow | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("content_assets")
    .select("url,niche,analysis")
    .eq("article", article)
    .eq("disk", "wb")
    .eq("kind", "image")
    .not("url", "is", null)
    .limit(1);
  return ((data as AssetRow[] | null) || [])[0] || null;
}

async function resolveSourceImage(input: { article: string; product?: string; scene?: string; niche?: string; prepare: boolean; imageUrl?: string }) {
  const direct = cleanText(input.imageUrl, 1200);
  if (direct) return { imageUrl: direct, imageKind: "direct", niche: input.niche };

  const prepared = await latestPrepared(input.article);
  if (prepared?.url) return { imageUrl: prepared.url, imageKind: "prepared", niche: input.niche || prepared.niche || undefined };

  const wb = await firstWbImage(input.article);
  if (!wb?.url) return { error: `нет prepared/WB-фото для ${input.article}` };
  if (!input.prepare) return { imageUrl: wb.url, imageKind: "wb", niche: input.niche || wb.niche || undefined, warning: "prepared кадра нет; передай prepare:true для source-prep перед генерацией" };

  const prep = await prepareProductImage(wb.url, { article: input.article, niche: input.niche || wb.niche || undefined, product: input.product, scene: input.scene });
  if (!prep.ok || (!prep.stagedUrl && !prep.cleanUrl)) return { error: prep.error || "source-prep не дал image_url" };
  return { imageUrl: prep.stagedUrl || prep.cleanUrl, imageKind: prep.stagedUrl ? "prepared_staged" : "prepared_clean", niche: input.niche || wb.niche || undefined };
}

async function resolveCleanInput(input: {
  article: string;
  product?: string;
  scene?: string;
  niche?: string;
  prepare: boolean;
  imageUrl?: string;
  imageDataUrl?: string;
  diskPath?: string;
  disk?: string;
}): Promise<{ image: string; imageUrl?: string; imageKind: string; sourcePath?: string; niche?: string; warning?: string } | { error: string }> {
  if (input.imageDataUrl?.startsWith("data:image/")) return { image: input.imageDataUrl, imageKind: "data_url", niche: input.niche };
  if (input.imageUrl) return { image: input.imageUrl, imageUrl: input.imageUrl, imageKind: "direct", niche: input.niche };

  if (input.diskPath) {
    const disk = diskById(input.disk || "design");
    if (!disk) return { error: "неизвестный disk" };
    const href = await yaDownloadHref(input.diskPath, disk.key);
    if (!href) return { error: `не удалось получить download href для ${input.diskPath}` };
    const img = await fetchWithRetry(href, { cache: "no-store" }, 5);
    if (!img.ok) return { error: `download ${img.status}` };
    const contentType = img.headers.get("content-type") || "image/png";
    const buf = Buffer.from(await img.arrayBuffer());
    if (!buf.length) return { error: "пустой image buffer" };
    return { image: imageBufferToDataUrl(buf, contentType), imageKind: "disk_path", sourcePath: input.diskPath, niche: input.niche };
  }

  const source = await resolveSourceImage({
    article: input.article,
    product: input.product,
    scene: input.scene,
    niche: input.niche,
    prepare: input.prepare,
  });
  if (source.error || !source.imageUrl) return { error: source.error || "нет image_url" };
  return {
    image: source.imageUrl,
    imageUrl: source.imageUrl,
    imageKind: source.imageKind,
    niche: source.niche,
    warning: source.warning,
  };
}

// P0 Repeatable B-roll Machine:
// POST { article, product?, count?=10, recipe?="skincare_ritual", model?="kling", prepare?=false, clean_first?=false, submit?=false }
// default submit=false: возвращает план без списания FAL. submit=true сабмитит N image-to-video задач.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const article = cleanText(body.article || body.sku_art, 80);
    if (!article) return NextResponse.json({ ok: false, error: "нужен article" }, { status: 400 });

    const product = cleanText(body.product || body.product_name || article, 120);
    const count = Math.max(1, Math.min(20, Number(body.count) || 10));
    const model = cleanModel(body.model);
    const recipe = (cleanText(body.recipe, 40) || "skincare_ritual") as ProductBrollRecipe;
    const submit = body.submit === true;
    const prepare = body.prepare === true;
    const cleanFirst = body.clean_first === true || body.cleanFirst === true;
    const imageUrl = cleanText(body.image_url || body.imageUrl, 1200) || undefined;
    const twinId = cleanText(body.twin_id || body.twinId, 140) || undefined;
    const imageDataUrl = cleanLongText(body.image_data_url || body.imageDataUrl);
    const diskPath = cleanText(body.disk_path || body.diskPath, 1200) || undefined;
    const disk = cleanText(body.disk || "design", 80) || "design";
    const scene = cleanText(body.scene, 240) || undefined;
    const niche = cleanText(body.niche, 80) || undefined;
    const category = (cleanText(body.category, 40) || undefined) as ProductCategory | undefined;
    const cleanPrompt = cleanText(body.clean_prompt || body.cleanPrompt, 8000);
    const directSourceProvided = Boolean(twinId || imageUrl || imageDataUrl || diskPath);
    if (!directSourceProvided && !getSupabaseAdmin()) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    if (!cleanFirst && (imageDataUrl || diskPath)) return NextResponse.json({ ok: false, error: "image_data_url/disk_path требуют clean_first:true, чтобы получить публичный clean_url для video API" }, { status: 400 });

    let source: {
      imageUrl: string;
      imageKind?: string;
      niche?: string;
      warning?: string;
      originalKind?: string;
      originalPath?: string;
      cleanPromptUsed?: string;
      cleanResponseUrl?: string;
      twinId?: string;
      assetId?: string;
      viewId?: string;
      viewPurpose?: string;
    };
    const db = getSupabaseAdmin();
    const sourceViewId = cleanText(body.view_id || body.viewId || body.source_view_id || body.sourceViewId, 80);
    const useDerivedView = sourceViewId || body.use_derived_view === true || body.useDerivedView === true;
    if (useDerivedView) {
      if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
      const viewAssets = await getProductTwinViewAssets(db, {
        article,
        twinId,
        viewId: sourceViewId || undefined,
        limit: 80,
      });
      const pickedView = viewAssets[0] || null;
      if (!pickedView) return NextResponse.json({ ok: false, error: sourceViewId ? `derived view ${sourceViewId} не найден` : "derived view для article/twin не найден" }, { status: 404 });
      source = {
        imageUrl: pickedView.url,
        imageKind: "product_twin_view",
        niche: pickedView.category,
        twinId: pickedView.twinId,
        assetId: pickedView.sourceAssetId,
        viewId: pickedView.viewId,
        viewPurpose: pickedView.purpose,
      };
    } else if (twinId) {
      if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
      const picked = await getBestProductTwinAsset(db, { twinId, useCase: "broll" });
      if (!picked) return NextResponse.json({ ok: false, error: `twin ${twinId} не найден или нет broll_ready asset` }, { status: 404 });
      source = {
        imageUrl: picked.asset.url,
        imageKind: "product_twin",
        niche: picked.twin.category,
        twinId: picked.twin.twinId,
        assetId: picked.asset.assetId,
      };
    } else if (!imageUrl && !imageDataUrl && !diskPath && !cleanFirst) {
      if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
      const existingTwin = await getLatestProductTwinByArticle(db, article);
      const picked = existingTwin ? await getBestProductTwinAsset(db, { twinId: existingTwin.twinId, useCase: "broll" }) : null;
      if (picked) {
        source = {
          imageUrl: picked.asset.url,
          imageKind: "product_twin_latest",
          niche: picked.twin.category,
          twinId: picked.twin.twinId,
          assetId: picked.asset.assetId,
        };
      } else {
        const resolved = await resolveSourceImage({ article, product, scene, niche, prepare, imageUrl });
        if (resolved.error || !resolved.imageUrl) return NextResponse.json({ ok: false, error: resolved.error || "нет image_url" }, { status: 400 });
        source = {
          imageUrl: resolved.imageUrl,
          imageKind: resolved.imageKind,
          niche: resolved.niche,
          warning: resolved.warning || "product_twin not found; fell back to prepared/WB source",
        };
      }
    } else if (cleanFirst) {
      const raw = await resolveCleanInput({ article, product, scene, niche, prepare, imageUrl, imageDataUrl, diskPath, disk });
      if ("error" in raw) return NextResponse.json({ ok: false, error: raw.error }, { status: 400 });
      const prompt = cleanPrompt || buildProductCleanPrompt({ article, product, category });
      const clean = await runNanoBananaEdit({ image: raw.image, prompt });
      if (!clean.ok) return NextResponse.json({ ok: false, error: clean.error, response_url: clean.responseUrl }, { status: clean.responseUrl ? 504 : 502 });
      source = {
        imageUrl: clean.imageUrl,
        imageKind: "clean_source",
        niche: raw.niche,
        warning: raw.warning,
        originalKind: raw.imageKind,
        originalPath: raw.sourcePath,
        cleanPromptUsed: prompt,
        cleanResponseUrl: clean.responseUrl,
      };
    } else {
      const resolved = await resolveSourceImage({ article, product, scene, niche, prepare, imageUrl });
      if (resolved.error || !resolved.imageUrl) return NextResponse.json({ ok: false, error: resolved.error || "нет image_url" }, { status: 400 });
      source = {
        imageUrl: resolved.imageUrl,
        imageKind: resolved.imageKind,
        niche: resolved.niche,
        warning: resolved.warning,
      };
    }

    const variants = buildProductBrollPlan({ article, product, recipe, count, model });
    if (!submit) {
      return NextResponse.json({
        ok: true,
        mode: "dry_run",
        article,
        product,
        recipe,
        model,
        source_image: source.imageUrl,
        source_preview_url: productTwinAssetPreviewUrl(source.imageUrl),
        source_kind: source.imageKind,
        twin_id: source.twinId || null,
        asset_id: source.assetId || null,
        view_id: source.viewId || null,
        view_purpose: source.viewPurpose || null,
        original_source_kind: source.originalKind || null,
        original_source_path: source.originalPath || null,
        clean_source: cleanFirst ? {
          clean_url: source.imageUrl,
          prompt_used: source.cleanPromptUsed,
          response_url: source.cleanResponseUrl,
        } : null,
        warning: source.warning,
        variants,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    if (!process.env.FAL_KEY && !process.env.FAL_BILLING_KEY) return NextResponse.json({ ok: false, error: "FAL_KEY не настроен" }, { status: 500 });
    const falImage = await rehostImageForFal(source.imageUrl);
    const jobs = await Promise.all(variants.map(async (variant) => {
      const res = await falVideoSubmitDetailed(variant.model, falImage, variant.prompt, { duration: variant.duration });
      return {
        id: variant.id,
        label: variant.label,
        model: variant.model,
        prompt_used: variant.prompt,
        twin_id: source.twinId || null,
        asset_id: source.assetId || null,
        view_id: source.viewId || null,
        task_id: res.token ? `fv.${res.token}` : null,
        ok: Boolean(res.token),
        error: res.token ? null : res.reason || "fal submit failed",
        detail: res.detail || null,
      };
    }));

    return NextResponse.json({
      ok: true,
      mode: "submitted",
      article,
      product,
      recipe,
      source_image: source.imageUrl,
      source_preview_url: productTwinAssetPreviewUrl(source.imageUrl),
      source_kind: source.imageKind,
      twin_id: source.twinId || null,
      asset_id: source.assetId || null,
      view_id: source.viewId || null,
      view_purpose: source.viewPurpose || null,
      original_source_kind: source.originalKind || null,
      original_source_path: source.originalPath || null,
      clean_source: cleanFirst ? {
        clean_url: source.imageUrl,
        prompt_used: source.cleanPromptUsed,
        response_url: source.cleanResponseUrl,
      } : null,
      submitted: jobs.filter((j) => j.ok).length,
      failed: jobs.filter((j) => !j.ok).length,
      jobs,
      status_route: "/api/factory/video-fal-status/{task_id}",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "product-broll-batch crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
