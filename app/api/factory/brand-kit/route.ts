import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { detectBrand, listBrands } from "@/lib/factory/brandProfiles";
import { resolveBrandKit } from "@/lib/factory/brandKit";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

// V24 · бренд-кит CRUD. Всегда JSON, soft-degrade.
//   GET ?article=&name=   → { brand, kit }            — кит для товара (detectBrand)
//   GET ?list=1           → { brands:[{brand, has_kit, kit}] } — все известные бренды + их киты
//   POST { brand, voice_id?, persona_id?, visual_style?, music_url?, caption_font?, caption_color?,
//          caption_highlight?, cta?, ban_words?[], hashtags?[], niche?, notes? } → upsert по brand

const STR_FIELDS = ["niche", "voice_id", "persona_id", "visual_style", "music_url", "caption_font", "caption_color", "caption_highlight", "cta", "notes"] as const;

export async function GET(req: NextRequest) {
  try {
  const db = getSupabaseAdmin();
  const sp = req.nextUrl.searchParams;
  const emptyBrands = () => listBrands().map((b) => ({ brand: b, has_kit: false, kit: null }));
  if (!db) {
    if (sp.get("list")) return NextResponse.json({ ok: true, brands: emptyBrands(), warning: "Supabase не настроен — бренд-киты временно пустые" }, { headers: { "Cache-Control": "no-store" } });
    const article = sp.get("article") || "";
    const name = sp.get("name") || "";
    return NextResponse.json({ ok: true, brand: detectBrand(article, name) || null, kit: null, warning: "Supabase не настроен — бренд-кит временно пустой" }, { headers: { "Cache-Control": "no-store" } });
  }

  if (sp.get("list")) {
    let rows: Record<string, unknown>[] = [];
    try { const { data } = await db.from("brand_kits").select("*"); rows = (data as Record<string, unknown>[]) || []; }
    catch { return NextResponse.json({ ok: true, brands: emptyBrands(), warning: "миграция brand_kits не применена" }, { headers: { "Cache-Control": "no-store" } }); }
    const byBrand = new Map(rows.map((r) => [String(r.brand), r]));
    const brands = listBrands().map((b) => ({ brand: b, has_kit: byBrand.has(b), kit: byBrand.get(b) || null }));
    // + киты для брендов вне статичного списка (вдруг завели вручную)
    for (const r of rows) if (!brands.find((x) => x.brand === r.brand)) brands.push({ brand: String(r.brand), has_kit: true, kit: r });
    return NextResponse.json({ ok: true, brands });
  }

  const article = sp.get("article") || "";
  const name = sp.get("name") || "";
  const brand = detectBrand(article, name);
  const kit = await resolveBrandKit(db, article, name);
  return NextResponse.json({ ok: true, brand: brand || null, kit });
  } catch (e) {
    return NextResponse.json({
      ok: true,
      partial: true,
      brand: null,
      kit: null,
      warning: "чтение бренд-кита упало: " + String((e as Error)?.message || e).slice(0, 160),
    }, { headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(req: NextRequest) {
  try {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
  const b = await req.json().catch(() => ({}));
  const brand = (b.brand || "").toString().trim();
  if (!brand) return NextResponse.json({ ok: false, error: "нужен brand" }, { status: 400 });

  const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
  const COLOR_FIELDS = new Set(["caption_color", "caption_highlight"]);
  const patch: Record<string, unknown> = { brand, updated_at: new Date().toISOString() };
  for (const f of STR_FIELDS) {
    if (b[f] === undefined) continue;
    const v = b[f] === null ? null : String(b[f]).trim().slice(0, 600);
    if (v && COLOR_FIELDS.has(f) && !HEX.test(v)) continue; // мусорный цвет не пишем (защита движков от 422)
    patch[f] = v || null;
  }
  if (!patch.niche && b.article) patch.niche = nicheFromArticle(String(b.article), ""); // name=product, не brand (иначе ENOUGH→default)
  if (Array.isArray(b.ban_words)) patch.ban_words = b.ban_words.map((x: unknown) => String(x || "").trim()).filter(Boolean).slice(0, 40);
  if (Array.isArray(b.hashtags)) patch.hashtags = b.hashtags.map((x: unknown) => String(x || "").trim().replace(/^#+/, "#")).filter((x: string) => x.length > 1).slice(0, 30);

  try {
    const { error } = await db.from("brand_kits").upsert(patch, { onConflict: "brand" });
    if (error) return NextResponse.json({ ok: false, error: error.message, hint: "миграция 20260622_brand_kits применена?" }, { status: 500 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 });
  }
  return NextResponse.json({ ok: true, brand });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "сохранение бренд-кита упало: " + String((e as Error)?.message || e).slice(0, 160),
    }, { status: 500 });
  }
}
