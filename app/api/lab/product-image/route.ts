import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Резолв реального фото товара по артикулу (nm_id из rnp_report → правильный basket через HEAD-пробу).
// Нужно для товаров, которых нет в sku-list (imgByArt пуст) — иначе карусель не собирается («нет фото товара»).
export async function GET(req: NextRequest) {
  const art = (req.nextUrl.searchParams.get("art") || "").trim();
  if (!art) return NextResponse.json({ error: "нужен ?art=" }, { status: 400 });
  try {
    const { getSupabaseAdmin } = await import("@/lib/supabaseAdmin");
    const { loadRnpReportRows } = await import("@/lib/rnp/rpcLoaders");
    const { getWbCardImage } = await import("@/lib/wb/cardImage");
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "supabase нет" }, { status: 500 });
    const data = await loadRnpReportRows<any>(db, null, { label: "Фото товара WB: товары" });

    const row = data.find((r) => r.article === art);
    if (!row?.nm_id) return NextResponse.json({ image_url: "" });
    const img = await getWbCardImage(Number(row.nm_id));
    return NextResponse.json({ image_url: img || "", nm_id: row.nm_id });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 150) }, { status: 502 });
  }
}
