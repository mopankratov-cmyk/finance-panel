import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { recolorTwinFromBase, retouchTwin } from "@/lib/factory/twinRecolor";
import { productTwinAssetPreviewUrl } from "@/lib/factory/productTwinPreview";
import { WB_SELLER_CATALOG, catalogEntryForArticle } from "@/lib/factory/wbSellerCatalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Перекраска эталонного твина в цвет(а). Геометрия наследуется от базы — только цвет меняется.
// POST { base_article, target_article, color }  — один цвет;
// POST { base_article, all_colors_of_model: true } — все цвета модели base_article из WB-каталога.
export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));

    // Ретушь: убрать вшитый артефакт (рукавный шильдик, утяжка) или добавить деталь по референсу.
    // POST { retouch: true, article, instructions: ["sleeve_patch", ...], reference_image_urls?: [...] }
    if (body.retouch === true) {
      const article = String(body.article || "").trim();
      const instructions = Array.isArray(body.instructions) ? body.instructions.map((s: unknown) => String(s || "").trim()).filter(Boolean) : [];
      if (!article || !instructions.length) return NextResponse.json({ ok: false, error: "нужны article и instructions[]" }, { status: 400 });
      const catEntry = catalogEntryForArticle(article);
      const product = String(body.product || (catEntry ? `${catEntry.category === "Ветровки" ? "ветровка" : "куртка"} NORVIA ${catEntry.color.split(";")[0]}` : `изделие ${article}`)).trim();
      const referenceImageUrls = Array.isArray(body.reference_image_urls) ? body.reference_image_urls.map((s: unknown) => String(s || "").trim()).filter(Boolean) : [];
      const r = await retouchTwin(db, { article, twinId: String(body.twin_id || body.twinId || "").trim() || undefined, product, instructions, referenceImageUrls });
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status || 500 });
      return NextResponse.json({
        ok: true, mode: "retouch", article, instructions,
        twin_id: r.twin.twinId,
        preview_url: productTwinAssetPreviewUrl(r.twin.assets.find((a) => a.kind === "upscaled")?.url || r.twin.assets[0]?.url),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const baseArticle = String(body.base_article || body.baseArticle || "").trim();
    const baseTwinId = String(body.base_twin_id || body.baseTwinId || "").trim();
    if (!baseArticle && !baseTwinId) return NextResponse.json({ ok: false, error: "нужен base_article или base_twin_id" }, { status: 400 });

    // Батч: все цвета модели эталона.
    if (body.all_colors_of_model === true) {
      const baseEntry = catalogEntryForArticle(baseArticle);
      if (!baseEntry) return NextResponse.json({ ok: false, error: `${baseArticle} нет в WB-каталоге` }, { status: 404 });
      const siblings = WB_SELLER_CATALOG.filter((e) => e.model === baseEntry.model && e.article !== baseArticle);
      const results: Array<Record<string, unknown>> = [];
      for (const sib of siblings) {
        const product = `${baseEntry.category === "Ветровки" ? "ветровка" : "куртка"} NORVIA ${sib.color.split(";")[0]}`;
        const r = await recolorTwinFromBase(db, { baseArticle, baseTwinId: baseTwinId || undefined, targetArticle: sib.article, product, color: sib.color });
        results.push(r.ok
          ? { article: sib.article, ok: true, twin_id: r.twin.twinId, preview_url: productTwinAssetPreviewUrl(r.twin.assets.find((a) => a.kind === "upscaled")?.url || r.twin.assets[0]?.url) }
          : { article: sib.article, ok: false, error: r.error });
      }
      return NextResponse.json({
        ok: results.every((x) => x.ok),
        mode: "all_colors",
        base: baseArticle,
        model: baseEntry.model,
        recolored: results.filter((x) => x.ok).length,
        failed: results.filter((x) => !x.ok).length,
        results,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    // Один цвет.
    const targetArticle = String(body.target_article || body.targetArticle || "").trim();
    const color = String(body.color || "").trim();
    if (!targetArticle || !color) return NextResponse.json({ ok: false, error: "нужны target_article и color" }, { status: 400 });
    const catEntry = catalogEntryForArticle(targetArticle);
    const product = String(body.product || (catEntry ? `${catEntry.category === "Ветровки" ? "ветровка" : "куртка"} NORVIA ${color}` : `изделие ${color}`)).trim();
    const r = await recolorTwinFromBase(db, { baseArticle: baseArticle || undefined, baseTwinId: baseTwinId || undefined, targetArticle, product, color });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status || 500 });
    return NextResponse.json({
      ok: true,
      mode: "single",
      target: targetArticle,
      color,
      twin_id: r.twin.twinId,
      source_kind: r.twin.sourceKind,
      preview_url: productTwinAssetPreviewUrl(r.twin.assets.find((a) => a.kind === "upscaled")?.url || r.twin.assets[0]?.url),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "product-twin/recolor crash: " + String((e as Error)?.message || e).slice(0, 200) }, { status: 500 });
  }
}
