import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { OPIU_ENTITY } from "@/lib/opiu/constants";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { mergeCostCatalog, type MarketplaceCostProduct } from "@/lib/costs/catalog";
import { getActiveWbCabinets } from "@/lib/wb/cabinetTokens";
import { describeOzonScope, getOzonCabinetScope } from "@/lib/ozon/cabinet";
import { loadCachedOzonCockpit } from "@/lib/ozon/cockpitCache";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET — список себестоимостей. POST — upsert по артикулу.
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ rows: [] });
  const q = (new URL(request.url).searchParams.get("q") || "").toLowerCase().trim();
  const [{ data, error }, wbCabinets, ozonScope] = await Promise.all([
    db.from("product_costs").select("article, name, cost_rub, brand, category").order("article"),
    getActiveWbCabinets(),
    getOzonCabinetScope("all"),
  ]);
  if (error) return NextResponse.json({ rows: [], error: error.message });
  const products: MarketplaceCostProduct[] = [];
  const warnings: string[] = [];

  const wbCabinetIds = wbCabinets.map((cabinet) => cabinet.id);
  if (wbCabinetIds.length) {
    try {
      const scopeRows = await loadAllSupabasePages<{ article: string | null; brand: string | null }>(
        (from, to) => db
          .from("wb_cabinet_product_scope")
          .select("article, brand")
          .in("cabinet_id", wbCabinetIds)
          .not("article", "is", null)
          .order("article", { ascending: true })
          .range(from, to),
        { maxPages: 100, label: "Каталог себестоимости WB" },
      );
      for (const row of scopeRows) {
        if (row.article?.trim()) products.push({
          article: row.article,
          name: row.article,
          brand: row.brand,
          source: "WB",
        });
      }
    } catch (cause) {
      warnings.push(cause instanceof Error ? cause.message : "Каталог WB временно недоступен");
    }
  }

  if (ozonScope.ok) {
    try {
      const snapshot = await loadCachedOzonCockpit({
        view: "economy",
        scope: describeOzonScope(ozonScope.scope),
        days: 14,
        taxPct: 7,
      });
      const ozonRows = Array.isArray((snapshot as { rows?: unknown }).rows)
        ? (snapshot as { rows: Array<Record<string, unknown>> }).rows
        : [];
      for (const row of ozonRows) {
        const offerId = String(row.offerId ?? "").trim();
        if (!offerId) continue;
        products.push({
          article: offerId,
          name: String(row.name ?? offerId),
          source: "Ozon",
          resolvedCostRub: Number(row.cost ?? 0),
          resolvedFrom: Number(row.cost ?? 0) > 0 ? "Сопоставлено в Ozon" : null,
        });
      }
    } catch (cause) {
      warnings.push(`Каталог Ozon: ${cause instanceof Error ? cause.message : "временно недоступен"}`);
    }
  } else {
    warnings.push(`Каталог Ozon: ${ozonScope.error}`);
  }

  const catalog = mergeCostCatalog(data ?? [], products);
  let rows = catalog.rows;
  if (q) rows = rows.filter((r) => r.article.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  return NextResponse.json({
    rows,
    count: catalog.count,
    filled: catalog.filled,
    missing: catalog.missing,
    warnings,
  });
}

export async function POST(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const b = (await request.json().catch(() => ({}))) as { article?: string; cost_rub?: number; name?: string; category?: string };
  const article = (b.article || "").trim();
  if (!article) return NextResponse.json({ error: "Укажите артикул" }, { status: 400 });
  const cost = Number(b.cost_rub) || 0;

  const { data: existing } = await db.from("product_costs").select("article").eq("article", article).maybeSingle();
  let error;
  if (existing) {
    const patch: Record<string, unknown> = { cost_rub: cost };
    if (b.name) patch.name = b.name.trim();
    if (b.category !== undefined) patch.category = b.category.trim() || null;
    ({ error } = await db.from("product_costs").update(patch).eq("article", article));
  } else {
    ({ error } = await db.from("product_costs").insert({ article, cost_rub: cost, name: (b.name || "").trim() || article, category: (b.category || "").trim() || null, entity: OPIU_ENTITY }));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
