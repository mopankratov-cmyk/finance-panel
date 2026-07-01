import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getProductTwinById } from "@/lib/factory/productTwinStore";
import { withProductTwinPreviewUrls } from "@/lib/factory/productTwinPreview";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ twin_id: string }> }) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const { twin_id: twinId } = await ctx.params;
    const twin = await getProductTwinById(db, twinId);
    if (!twin) return NextResponse.json({ ok: false, error: "twin не найден" }, { status: 404 });
    return NextResponse.json({ ok: true, twin: withProductTwinPreviewUrls(twin) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "product-twin GET crash: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
