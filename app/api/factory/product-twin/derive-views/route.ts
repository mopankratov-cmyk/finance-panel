import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { runNanoBananaEdit } from "@/lib/factory/falImageEdit";
import { getLatestProductTwinByArticle, getProductTwinById } from "@/lib/factory/productTwinStore";
import { pickBestTwinAsset } from "@/lib/factory/productTwin";
import { archiveExternalMediaToYandex } from "@/lib/factory/yandexArchive";
import { rehostImageForFal } from "@/lib/factory/rehostImage";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function cleanText(value: unknown, max = 200): string {
  return String(value || "").trim().slice(0, max);
}

function cleanList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 20);
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20);
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const twinId = cleanText(body.twin_id || body.twinId, 140);
    const article = cleanText(body.article, 80);
    const generate = body.generate === true || body.submit === true;
    const allowSynthetic = body.allow_synthetic === true || body.allowSynthetic === true;
    const limit = Math.max(1, Math.min(generate ? 5 : 30, Number(body.limit || (generate ? 2 : 12)) || (generate ? 2 : 12)));
    const viewIds = new Set(cleanList(body.view_ids || body.viewIds));
    const twin = twinId ? await getProductTwinById(db, twinId) : article ? await getLatestProductTwinByArticle(db, article) : null;
    if (!twin) return NextResponse.json({ ok: false, error: "twin не найден" }, { status: 404 });
    const plan = twin.preparationPlan;
    if (!plan) return NextResponse.json({ ok: false, error: "у twin нет preparation_plan; rebuild twin first" }, { status: 400 });
    const source = pickBestTwinAsset(twin.assets, "hero") || pickBestTwinAsset(twin.assets, "broll") || twin.assets[0];
    if (!source?.url) return NextResponse.json({ ok: false, error: "нет source asset для derive" }, { status: 400 });

    const views = plan.canonicalViews
      .filter((view) => view.purpose !== "clean")
      .filter((view) => allowSynthetic || view.truth !== "synthetic_candidate")
      .filter((view) => !viewIds.size || viewIds.has(view.id))
      .slice(0, limit);
    if (!generate) {
      return NextResponse.json({
        ok: true,
        mode: "dry_run",
        generate_hint: "POST again with generate:true to create derived view assets and archive them to Yandex Disk",
        twin_id: twin.twinId,
        article: twin.article,
        source_asset_id: source.assetId,
        source_url: source.url,
        views,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!process.env.FAL_KEY && !process.env.FAL_BILLING_KEY) return NextResponse.json({ ok: false, error: "FAL_KEY не настроен" }, { status: 500 });
    const falSourceImage = await rehostImageForFal(source.url);

    const generated = [];
    for (const view of views) {
      const edit = await runNanoBananaEdit({
        image: falSourceImage,
        prompt: [
          view.prompt,
          twin.promptLibrary?.preserve_identity || "",
          twin.promptLibrary?.negative_identity ? `Avoid: ${twin.promptLibrary.negative_identity}.` : "",
          "No captions, no text overlays outside the real product, no extra products. Preserve product identity.",
        ].filter(Boolean).join(" "),
      });
      if (!edit.ok) {
        generated.push({ view_id: view.id, ok: false, error: edit.error, response_url: edit.responseUrl || null });
        continue;
      }
      const archived = await archiveExternalMediaToYandex({
        sourceUrl: edit.imageUrl,
        kind: "image",
        article: twin.article,
        niche: twin.category,
        name: `${twin.twinId}-${view.id}`,
        subdir: "product-twin",
        folderSegments: [twin.article, twin.twinId, "views"],
      });
      const url = archived.yandex_url || edit.imageUrl;
      const path = archived.yandex_path || null;
      const row = {
        disk: "product_twin",
        path: path || `product-twins/${twin.article}/${twin.twinId}/views/${view.id}.png`,
        name: `${twin.article} · twin view · ${view.id}`.slice(0, 120),
        kind: "image",
        niche: twin.category,
        article: twin.article,
        color: null,
        url,
        analyzed: true,
        analysis: {
          product_twin: {
            twin_id: twin.twinId,
            article: twin.article,
            product_name: twin.productName,
            category: twin.category,
            source_kind: "derived_view",
            source_path: twin.sourcePath || null,
            status: "ready",
            canonical_asset_id: twin.canonicalAssetId,
            quality_score: twin.qualityScore,
            prompt_library: twin.promptLibrary,
            preparation_plan: twin.preparationPlan,
          },
          product_twin_view_asset: {
            view_id: view.id,
            label: view.label,
            purpose: view.purpose,
            truth: view.truth,
            source_asset_id: source.assetId,
            prompt_used: view.prompt,
            yandex_archive: archived,
          },
        },
      };
      const { error } = await db.from("content_assets").insert(row);
      generated.push({
        view_id: view.id,
        ok: !error,
        url,
        preview_url: edit.imageUrl,
        path,
        archive_status: archived.status,
        error: error?.message || archived.error || null,
      });
    }

    return NextResponse.json({
      ok: generated.every((item) => item.ok),
      mode: "generate_views",
      twin_id: twin.twinId,
      article: twin.article,
      source_asset_id: source.assetId,
      generated,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "product-twin/derive-views crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
