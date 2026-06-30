import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { buildProductTwin } from "@/lib/factory/productTwinBuild";
import { getBestProductTwinAsset, getLatestProductTwinByArticle } from "@/lib/factory/productTwinStore";
import { buildProductBrollPlan, type ProductBrollRecipe } from "@/lib/factory/productBrollBatch";
import { archiveFactoryVideosToYandex } from "@/lib/factory/yandexArchive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const P0_CASES = [
  {
    article: "TT04102",
    product: "green water blaster",
    category: "toy",
    disk_path: "/МАША/УЗИ зеленый/NEW светлая/2.png",
    recipe: "toy_action" as ProductBrollRecipe,
  },
  {
    article: "YYS0101",
    product: "YOYO SPF50 sunscreen cream",
    category: "cosmetics",
    disk_path: "/МАША/Крем-молочко YOYO/1.png",
    recipe: "skincare_ritual" as ProductBrollRecipe,
  },
];

export async function GET(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const sp = req.nextUrl.searchParams;
    const apply = sp.get("apply") === "1";
    const build = sp.get("build") === "1";
    const count = Math.max(1, Math.min(5, Number(sp.get("count") || 2)));

    const cases = [];
    for (const item of P0_CASES) {
      const existing = await getLatestProductTwinByArticle(db, item.article);
      const built = build || !existing ? await buildProductTwin(item, db) : null;
      const twin = built?.ok ? built.twin : existing;
      const picked = twin ? await getBestProductTwinAsset(db, { twinId: twin.twinId, useCase: "broll" }) : null;
      const variants = twin ? buildProductBrollPlan({ article: item.article, product: item.product, recipe: item.recipe, count, model: "kling" }) : [];
      cases.push({
        article: item.article,
        product: item.product,
        recipe: item.recipe,
        built: built ? built.ok : false,
        build_error: built && !built.ok ? built.error : null,
        twin_id: twin?.twinId || null,
        twin_status: twin?.status || null,
        asset_id: picked?.asset.assetId || null,
        asset_kind: picked?.asset.kind || null,
        asset_quality: picked?.asset.qualityScore ?? null,
        asset_risk: picked?.asset.risk || null,
        broll_dry_run: variants.map((v) => ({ id: v.id, label: v.label, model: v.model, duration: v.duration })),
      });
    }

    const archive = await archiveFactoryVideosToYandex(db, { apply, limit: 10, includeArchived: false });
    return NextResponse.json({
      ok: cases.every((c) => c.twin_id && c.asset_id),
      mode: build ? "build_and_check" : "check_existing",
      apply_archive: apply,
      cases,
      yandex_archive: archive,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "product-twin smoke crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

