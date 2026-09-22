import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchReportRows } from "@/lib/opiu/reportRows";
import { fetchProductCosts, matchesArticlePrefix } from "@/lib/opiu/loadMonth";
import { buildMarginByBarcode, type OrdersSummary } from "@/lib/opiu/marginByBarcode";
import { orderRub } from "@/lib/opiu/metrics";
import { OPIU_BRANDS, resolveOpiuBrand } from "@/lib/opiu/constants";
import { isValidDateParam } from "@/lib/opiu/weeks";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function resolveBrandId(request: NextRequest): string | undefined {
  const brand = request.nextUrl.searchParams.get("brand");
  return brand && OPIU_BRANDS.some((b) => b.id === brand) ? brand : undefined;
}

/** Расход на рекламу за период по nm_id — для колонки «Реклама» (справочно, не вычитается из маржи). */
async function fetchAdSpendByNmId(
  cabinetId: string,
  dateFrom: string,
  dateTo: string,
): Promise<Map<number, number>> {
  const db = getSupabaseAdmin();
  const map = new Map<number, number>();
  if (!db) return map;
  const { data, error } = await db
    .from("wb_advert_nm_daily")
    .select("nm_id, spent")
    .eq("cabinet_id", cabinetId)
    .gte("date", dateFrom)
    .lte("date", dateTo);
  if (error) {
    console.error("[opiu margin] ad spend read:", error.message);
    return map;
  }
  for (const row of data ?? []) {
    const nmId = Number(row.nm_id);
    if (!Number.isFinite(nmId)) continue;
    map.set(nmId, (map.get(nmId) ?? 0) + Number(row.spent ?? 0));
  }
  return map;
}

/**
 * Заказы/Отказы за период по nm_id — как в столбцах «Заказы»/«Отказы» гугл-
 * таблицы. Читаем wb_orders НАПРЯМУЮ (не через fetchOrders/Воронку из ОПиУ):
 * там для «Заказы» нужна ВАЛОВАЯ сумма (включая отменённые), а для «Отказы» —
 * отдельный счётчик is_cancel, а Воронка (wb_funnel_daily) отмену не хранит
 * вовсе и подменяет сырые строки синтетическими без признака отмены — метод
 * fetchOrders для этой пары чисел не подходит. articlePrefixes фильтруем по
 * supplier_article — то же поле, что и раньше в fetchOrders для суб-брендов.
 */
async function fetchOrdersByNmId(
  cabinetId: string,
  dateFrom: string,
  dateTo: string,
  articlePrefixes?: string[],
): Promise<Map<number, OrdersSummary>> {
  const db = getSupabaseAdmin();
  const map = new Map<number, OrdersSummary>();
  if (!db) return map;

  const rows = await loadAllSupabasePages<{
    nm_id: number;
    supplier_article: string | null;
    total_price: number | null;
    discount_percent: number | null;
    finished_price: number | null;
    price_with_disc: number | null;
    is_cancel: boolean | null;
  }>(
    async (from, to) => {
      const result = await db
        .from("wb_orders")
        .select("nm_id, supplier_article, total_price, discount_percent, finished_price, price_with_disc, is_cancel")
        .eq("cabinet_id", cabinetId)
        .gte("date", dateFrom)
        .lte("date", `${dateTo}T23:59:59.999Z`)
        .order("id", { ascending: true })
        .range(from, to);
      return {
        data: result.data,
        error: result.error ? { message: result.error.message } : null,
      };
    },
    { maxPages: 300, label: "Маржа по артикулам: заказы WB" },
  );

  for (const row of rows) {
    if (articlePrefixes?.length && !matchesArticlePrefix(row.supplier_article, articlePrefixes)) continue;
    const nmId = Number(row.nm_id);
    if (!Number.isFinite(nmId) || nmId <= 0) continue;
    const entry = map.get(nmId) ?? { ordersQty: 0, ordersRub: 0, cancelQty: 0 };
    entry.ordersQty += 1;
    entry.ordersRub += orderRub({
      totalPrice: row.total_price ?? undefined,
      discountPercent: row.discount_percent ?? undefined,
      finishedPrice: row.finished_price ?? undefined,
      priceWithDisc: row.price_with_disc ?? undefined,
    });
    if (row.is_cancel) entry.cancelQty += 1;
    map.set(nmId, entry);
  }
  return map;
}

export async function GET(request: NextRequest) {
  const dateFrom = request.nextUrl.searchParams.get("dateFrom") ?? "";
  const dateTo = request.nextUrl.searchParams.get("dateTo") ?? "";
  if (!isValidDateParam(dateFrom) || !isValidDateParam(dateTo) || dateFrom > dateTo) {
    return NextResponse.json({ error: "Некорректный диапазон дат" }, { status: 400 });
  }
  const brand = resolveOpiuBrand(resolveBrandId(request));

  try {
    const [reportRows, costs, adSpendByNmId, ordersByNmId] = await Promise.all([
      fetchReportRows(dateFrom, dateTo, "sale", brand.cabinetId),
      fetchProductCosts(brand),
      fetchAdSpendByNmId(brand.cabinetId, dateFrom, dateTo),
      fetchOrdersByNmId(brand.cabinetId, dateFrom, dateTo, brand.articlePrefixes),
    ]);

    const scopedRows = brand.articlePrefixes?.length
      ? reportRows.filter((row) => matchesArticlePrefix(row.sa_name, brand.articlePrefixes))
      : reportRows;

    const { rows, unattributedRows } = buildMarginByBarcode(scopedRows, costs, adSpendByNmId, ordersByNmId);

    return NextResponse.json({
      rows,
      period: { dateFrom, dateTo },
      brand: brand.id,
      meta: {
        reportRows: scopedRows.length,
        skuCount: rows.length,
        costsKnown: costs.length,
        unattributedRows,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Ошибка загрузки маржи по артикулам";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
