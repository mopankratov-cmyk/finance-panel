import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { buildProductTwin } from "@/lib/factory/productTwinBuild";
import { buildProductTwinBestOfN } from "@/lib/factory/productTwinBestOfN";
import { buildProductTwinInventory } from "@/lib/factory/productTwinInventory";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function cleanArticles(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 50);
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 50);
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const build = body.build === true || body.submit === true || body.apply === true;
    const bestOfN = body.best_of_n === true || body.bestOfN === true;
    const attempts = Math.max(1, Math.min(5, Number(body.attempts || 3) || 3));
    const limit = Math.max(1, Math.min(build ? 10 : 100, Number(body.limit || (build ? 3 : 30)) || (build ? 3 : 30)));
    const articles = cleanArticles(body.articles);
    const inventory = await buildProductTwinInventory({
      articles: articles.length ? articles : undefined,
      limit,
      candidateLimit: Math.max(attempts, 6),
      probeLimit: Math.max(attempts, 8),
    });

    if (!build) {
      return NextResponse.json({
        ok: true,
        mode: "dry_run",
        build_hint: "POST again with build:true to create Product Twins and upload assets to Yandex Disk",
        best_of_n: bestOfN,
        attempts,
        items: inventory.map((item) => ({
          article: item.article,
          product: item.product,
          category: item.category,
          best_source: item.candidates[0] || null,
          readiness: item.readiness,
          source_pack_readiness: item.sourcePackReadiness,
          missing_required_views: item.missingRequiredViews,
        })),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });

    const results = [];
    for (const item of inventory) {
      if (!item.candidates[0]) {
        results.push({ article: item.article, ok: false, error: "no source candidate" });
        continue;
      }
      if (bestOfN) {
        const result = await buildProductTwinBestOfN({
          article: item.article,
          product: item.product,
          category: item.category,
          attempts,
        }, db);
        results.push({
          article: item.article,
          ok: result.ok,
          mode: "best_of_n",
          attempts: result.attempts,
          winner_twin_id: result.winner?.twinId || null,
          winner_quality: result.winner?.qualityScore ?? null,
          source_path: result.winner?.sourcePath || null,
          error: result.error || null,
        });
        continue;
      }
      const candidate = item.candidates[0];
      const built = await buildProductTwin({
        article: item.article,
        product: item.product,
        category: item.category,
        disk: candidate.disk,
        disk_path: candidate.path,
        rebuild: true,
      }, db);
      results.push({
        article: item.article,
        ok: built.ok,
        mode: "single_best_source",
        twin_id: built.ok ? built.twin.twinId : null,
        quality: built.ok ? built.twin.qualityScore : null,
        source_path: built.ok ? built.twin.sourcePath || null : candidate.path,
        yandex_asset_paths: built.ok ? built.twin.assets.map((asset) => asset.path).filter(Boolean) : [],
        error: built.ok ? null : built.error,
      });
    }

    return NextResponse.json({
      ok: results.every((item) => item.ok),
      mode: bestOfN ? "build_best_of_n" : "build_single_best_source",
      count: results.length,
      results,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "product-twin/batch-build crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
