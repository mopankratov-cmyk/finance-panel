import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isAuthorizedReelsBrainJobRequest } from "@/lib/factory/reelsBrainJobAuth";
import { apparelSourcePackRows, buildApparelSourcePack } from "@/lib/factory/apparelSourcePack";
import { bagSourcePackRows, buildBagSourcePack } from "@/lib/factory/bagSourcePack";
import { normalizeTwinCategory } from "@/lib/factory/productTwin";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function cleanText(value: unknown, max = 240): string {
  return String(value || "").trim().slice(0, max);
}

function sourcePackItems(body: Record<string, unknown>): { article: string; product: string }[] {
  if (Array.isArray(body.items)) {
    return body.items.map((item) => {
      const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const article = cleanText(row.article, 80);
      return { article, product: cleanText(row.product || row.name || article, 240) };
    }).filter((item) => item.article).slice(0, 50);
  }
  if (Array.isArray(body.articles)) {
    return body.articles.map((article) => {
      const clean = cleanText(article, 80);
      return { article: clean, product: clean };
    }).filter((item) => item.article).slice(0, 50);
  }
  const article = cleanText(body.article, 80);
  const product = cleanText(body.product || article, 240);
  return article ? [{ article, product }] : [];
}

async function buildSourcePack(item: { article: string; product: string }) {
  const category = normalizeTwinCategory(undefined, item.article, item.product);
  if (category === "bag") {
    const pack = await buildBagSourcePack(item);
    if ("error" in pack) return { error: pack.error };
    return { pack, rows: bagSourcePackRows(pack), missingRoles: pack.missingRoles };
  }
  const pack = await buildApparelSourcePack(item);
  if ("error" in pack) return { error: pack.error };
  return { pack, rows: apparelSourcePackRows(pack), missingRoles: pack.missingRoles };
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorizedReelsBrainJobRequest(req))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const apply = body.apply === true || body.submit === true;
    const items = sourcePackItems(body);
    if (!items.length) return NextResponse.json({ ok: false, error: "нужен article или articles/items" }, { status: 400 });
    const results = [];
    const allRows = [];
    for (const item of items) {
      const built = await buildSourcePack(item);
      if ("error" in built) {
        results.push({ article: item.article, product: item.product, ok: false, error: built.error });
        continue;
      }
      const { pack, rows, missingRoles } = built;
      allRows.push(...rows);
      results.push({
        article: pack.article,
        product: pack.product,
        category: pack.category,
        ok: missingRoles.length === 0,
        missing_roles: missingRoles,
        rows: rows.length,
        pack,
      });
    }

    if (!apply) {
      return NextResponse.json({
        ok: results.every((result) => result.ok),
        mode: "dry_run",
        apply_hint: "POST again with apply:true to write product_truth rows into content_assets.",
        count: results.length,
        pack: results.length === 1 && results[0].ok ? results[0].pack : undefined,
        results,
        rows: allRows.map((row) => ({ disk: row.disk, path: row.path, name: row.name, role: row.analysis.product_source_pack.role, source_path: row.analysis.product_source_pack.source_path })),
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" }, { status: 500 });
    if (!allRows.length) return NextResponse.json({ ok: false, error: "нет строк source-pack для записи", results }, { status: 400 });
    const { error } = await db.from("content_assets").upsert(allRows, { onConflict: "disk,path", ignoreDuplicates: false });
    if (error) return NextResponse.json({ ok: false, error: error.message, results }, { status: 500 });

    return NextResponse.json({
      ok: results.every((result) => result.ok),
      mode: "apply",
      count: results.length,
      inserted: allRows.length,
      pack: results.length === 1 && results[0].ok ? results[0].pack : undefined,
      results,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: "product-twin/source-pack crash: " + String((e as Error)?.message || e).slice(0, 180),
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
