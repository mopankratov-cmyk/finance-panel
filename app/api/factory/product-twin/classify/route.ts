import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { classifyProductTwin } from "@/lib/factory/productTwinClassification";
import { getLatestProductTwinByArticle, getProductTwinById } from "@/lib/factory/productTwinStore";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const twinId = req.nextUrl.searchParams.get("twin_id") || "";
    const article = req.nextUrl.searchParams.get("article") || "";
    const twin = twinId
      ? await getProductTwinById(db, twinId)
      : article
        ? await getLatestProductTwinByArticle(db, article)
        : null;
    if (!twin) return NextResponse.json({ ok: false, error: "twin не найден; передай twin_id или article" }, { status: 404 });
    return NextResponse.json({
      ok: true,
      classification: classifyProductTwin(twin),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "product-twin/classify crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
