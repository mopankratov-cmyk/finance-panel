import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadFactoryQualityDiagnostics } from "@/lib/factory/qualityDiagnostics";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен", diagnostics: null }, { status: 500 });
    const sp = req.nextUrl.searchParams;
    const hours = Math.max(1, Math.min(24 * 30, Number(sp.get("hours")) || 72));
    const niche = (sp.get("niche") || "").trim() || null;
    const diagnostics = await loadFactoryQualityDiagnostics(db, { hours, niche });
    return NextResponse.json({
      ok: true,
      headline: "factory_quality_diagnostics",
      diagnostics,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      headline: "factory_quality_diagnostics",
      diagnostics: null,
      error: "quality-diagnostics crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
