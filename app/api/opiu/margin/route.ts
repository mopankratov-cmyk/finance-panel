import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchReportRows } from "@/lib/opiu/reportRows";
import { fetchProductCosts, matchesArticlePrefix } from "@/lib/opiu/loadMonth";
import { buildMarginByBarcode } from "@/lib/opiu/marginByBarcode";
import { OPIU_BRANDS, resolveOpiuBrand } from "@/lib/opiu/constants";
import { isValidDateParam } from "@/lib/opiu/weeks";

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

export async function GET(request: NextRequest) {
  const dateFrom = request.nextUrl.searchParams.get("dateFrom") ?? "";
  const dateTo = request.nextUrl.searchParams.get("dateTo") ?? "";
  if (!isValidDateParam(dateFrom) || !isValidDateParam(dateTo) || dateFrom > dateTo) {
    return NextResponse.json({ error: "Некорректный диапазон дат" }, { status: 400 });
  }
  const brand = resolveOpiuBrand(resolveBrandId(request));

  try {
    const [reportRows, costs, adSpendByNmId] = await Promise.all([
      fetchReportRows(dateFrom, dateTo, "sale", brand.cabinetId),
      fetchProductCosts(brand),
      fetchAdSpendByNmId(brand.cabinetId, dateFrom, dateTo),
    ]);

    const scopedRows = brand.articlePrefixes?.length
      ? reportRows.filter((row) => matchesArticlePrefix(row.sa_name, brand.articlePrefixes))
      : reportRows;

    const { rows, unattributedRows } = buildMarginByBarcode(scopedRows, costs, adSpendByNmId);

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
