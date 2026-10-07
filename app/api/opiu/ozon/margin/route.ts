import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getServerSession } from "@/lib/auth/server";
import { isValidDateParam } from "@/lib/opiu/weeks";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { getOzonCabinetScope } from "@/lib/ozon/cabinet";
import { ozonImages } from "@/lib/ozon/api";
import { normalizeOzonCostArticle } from "@/lib/ozon/costs";
import { readCachedAccrualTypeNames } from "@/lib/ozon/accrualTypesCache";
import { buildOzonOpiuReport } from "@/lib/ozon/opiuOzonReport";
import { buildOzonMarginCheck } from "@/lib/ozon/marginCheck";
import {
  buildOzonMarginBySku,
  totalOzonMargin,
  type OzonMarginAccrualRow,
  type OzonSkuCost,
} from "@/lib/ozon/marginBySku";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;

  const dateFrom = request.nextUrl.searchParams.get("dateFrom") ?? "";
  const dateTo = request.nextUrl.searchParams.get("dateTo") ?? "";
  if (!isValidDateParam(dateFrom) || !isValidDateParam(dateTo) || dateFrom > dateTo) {
    return NextResponse.json({ error: "Некорректный диапазон дат" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });

  // Кабинеты — только доступные этой сессии (как в «Себестоимости»).
  const scope = await getOzonCabinetScope("all");
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: 502 });
  const requested = new Set(request.nextUrl.searchParams.getAll("cabinetId").filter(Boolean));
  const cabinets = scope.scope.cabinets.filter((c) => requested.size === 0 || requested.has(c.id));
  if (!cabinets.length) {
    return NextResponse.json({ error: "Нет доступных кабинетов Ozon" }, { status: 200 });
  }
  const cabinetIds = cabinets.map((c) => c.id);

  const session = await getServerSession();
  const organizationId = session?.organization_id ?? null;

  try {
    const [accrualRows, costRows, catalogs] = await Promise.all([
      // Supabase молча режет выборку на 1000 строк — читаем все страницы (docs/PROJECT-KNOWLEDGE.md §4).
      loadAllSupabasePages(
        async (from, to) => {
          const result = await db
            .from("ozon_accrual_rows")
            .select("cabinet_id, accrual_id, sku, accrued_category, type_id, amount, quantity, extra")
            .in("cabinet_id", cabinetIds)
            .gte("date", dateFrom)
            .lte("date", dateTo)
            .order("cabinet_id", { ascending: true })
            .order("accrual_id", { ascending: true })
            .order("sku", { ascending: true })
            .order("type_id", { ascending: true })
            .range(from, to);
          return { data: result.data, error: result.error };
        },
        { label: "ozon_accrual_rows", concurrency: 4 },
      ),
      loadAllSupabasePages(
        async (from, to) => {
          const query = db
            .from("product_costs")
            .select("article, cost_rub, warehouse_expenses")
            .order("article", { ascending: true })
            .range(from, to);
          const result = organizationId ? await query.eq("organization_id", organizationId) : await query;
          return { data: result.data, error: result.error };
        },
        { label: "product_costs" },
      ),
      Promise.all(cabinets.map((c) => ozonImages(c.creds))),
    ]);

    // Ozon SKU id → артикул (offer_id) из каталога кабинетов. Себестоимость —
    // только для артикулов, которые есть в каталоге Ozon (источник «Ozon»).
    const skuToOffer = new Map<string, string>();
    for (const catalog of catalogs) for (const [sku, offer] of Object.entries(catalog.skuToOffer)) skuToOffer.set(sku, offer);
    const catalogIncomplete = catalogs.some((c) => !c.ok);

    const costByArticle = new Map<string, { cost: number; warehouse: number }>();
    for (const r of costRows) {
      costByArticle.set(normalizeOzonCostArticle(r.article), {
        cost: Number(r.cost_rub) || 0,
        warehouse: Number(r.warehouse_expenses) || 0,
      });
    }
    const costBySku = new Map<string, OzonSkuCost>();
    for (const [sku, offer] of skuToOffer) {
      const found = costByArticle.get(normalizeOzonCostArticle(offer));
      costBySku.set(sku, { article: offer, cost: found?.cost ?? 0, warehouse: found?.warehouse ?? 0 });
    }

    const rows: OzonMarginAccrualRow[] = accrualRows.map((r) => ({
      // ID начисления уникален только внутри кабинета.
      accrual_id: `${r.cabinet_id}:${r.accrual_id}`,
      sku: String(r.sku),
      type_id: Number(r.type_id),
      accrued_category: String(r.accrued_category),
      amount: Number(r.amount),
      quantity: r.quantity === null ? null : Number(r.quantity),
      extra: (r.extra ?? null) as { sale_amount?: number } | null,
    }));

    const result = buildOzonMarginBySku({ accrualRows: rows, costBySku });
    const totals = totalOzonMargin(result.rows);
    // Те же начисления, что в «Финансовом отчёте Ozon»: по нему сверяем итоги колонок.
    const typeNames = await readCachedAccrualTypeNames(db);
    const report = buildOzonOpiuReport({ accrualRows: rows, postings: [], typeNames });
    return NextResponse.json({
      rows: result.rows,
      totals,
      check: buildOzonMarginCheck(totals, report, rows),
      missingCost: result.missingCost,
      period: { dateFrom, dateTo },
      meta: { accrualRows: rows.length, skuCount: result.rows.length, catalogIncomplete },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
