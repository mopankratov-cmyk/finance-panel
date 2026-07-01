import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getProductTwinViewAssets } from "@/lib/factory/productTwinStore";
import { productTwinAssetPreviewUrl } from "@/lib/factory/productTwinPreview";

export const dynamic = "force-dynamic";

function cleanText(value: unknown, max = 160): string {
  return String(value || "").trim().slice(0, max);
}

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const article = cleanText(req.nextUrl.searchParams.get("article"), 80);
    const twinId = cleanText(req.nextUrl.searchParams.get("twin_id") || req.nextUrl.searchParams.get("twinId"), 140);
    const viewId = cleanText(req.nextUrl.searchParams.get("view_id") || req.nextUrl.searchParams.get("viewId"), 80);
    const limit = Math.max(1, Math.min(300, Number(req.nextUrl.searchParams.get("limit") || 120) || 120));
    if (!article && !twinId) return NextResponse.json({ ok: false, error: "нужен article или twin_id" }, { status: 400 });
    const views = await getProductTwinViewAssets(db, { article, twinId, viewId, limit });
    return NextResponse.json({
      ok: true,
      count: views.length,
      views: views.map((view) => ({
        ...view,
        preview_url: productTwinAssetPreviewUrl(view.url),
        previewUrl: productTwinAssetPreviewUrl(view.url),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "product-twin/views crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
