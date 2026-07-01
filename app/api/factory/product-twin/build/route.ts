import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildProductTwin } from "@/lib/factory/productTwinBuild";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const built = await buildProductTwin(body, db);
    if (!built.ok) return NextResponse.json({ ok: false, error: built.error, response_url: built.responseUrl }, { status: built.status || 500 });

    return NextResponse.json({
      ok: true,
      twin_id: built.twin.twinId,
      article: built.twin.article,
      product: built.twin.productName,
      category: built.twin.category,
      status: built.twin.status,
      quality_score: built.twin.qualityScore,
      canonical_asset_id: built.twin.canonicalAssetId,
      source_kind: built.sourceKind,
      reused: built.sourceKind === "reused_product_twin",
      source_path: built.sourcePath || null,
      clean_url: built.cleanUrl,
      assets: built.twin.assets.map((a) => ({
        asset_id: a.assetId,
        kind: a.kind,
        url: a.url,
        quality_score: a.qualityScore,
        quality_details: a.qualityDetails || null,
        broll_ready: a.brollReady,
        hero_ready: a.heroReady,
        marketplace_safe: a.marketplaceSafe,
      })),
      prompt_library: built.twin.promptLibrary,
      preparation_plan: built.twin.preparationPlan || null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "product-twin/build crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
