import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { buildProductTwinBestOfN } from "@/lib/factory/productTwinBestOfN";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const result = await buildProductTwinBestOfN(body, db);
    if (!result.ok) return NextResponse.json(result, { status: 400, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({
      ok: true,
      article: result.article,
      product: result.product,
      attempts_requested: result.attemptsRequested,
      attempts: result.attempts,
      winner_reason: result.winnerReason,
      winner: result.winner ? {
        twin_id: result.winner.twinId,
        status: result.winner.status,
        quality_score: result.winner.qualityScore,
        source_kind: result.winner.sourceKind,
        source_path: result.winner.sourcePath || null,
        canonical_asset_id: result.winner.canonicalAssetId,
        broll_ready_assets: result.winner.assets.filter((asset) => asset.brollReady).length,
        hero_ready_assets: result.winner.assets.filter((asset) => asset.heroReady).length,
        preparation_plan: result.winner.preparationPlan || null,
        yandex_assets: result.winner.assets.map((asset) => ({
          asset_id: asset.assetId,
          kind: asset.kind,
          url: asset.url,
          path: asset.path || null,
          broll_ready: asset.brollReady,
          hero_ready: asset.heroReady,
          quality_score: asset.qualityScore,
        })),
      } : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "product-twin/best-of-n crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
