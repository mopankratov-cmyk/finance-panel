import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchReportRows } from "@/lib/opiu/reportRows";
import { fetchProductCosts, matchesArticlePrefix } from "@/lib/opiu/loadMonth";
import { buildMarginByBarcode, type OrdersSummary } from "@/lib/opiu/marginByBarcode";
import { loadReadyFunnelFacts } from "@/lib/opiu/loadFunnelOrders";
import { fetchPaidStorageByArticle } from "@/lib/opiu/paidStorage";
import { OPIU_BRANDS, resolveOpiuBrand } from "@/lib/opiu/constants";
import { isValidDateParam } from "@/lib/opiu/weeks";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function resolveBrandId(request: NextRequest): string | undefined {
  const brand = request.nextUrl.searchParams.get("brand");
  return brand && OPIU_BRANDS.some((b) => b.id === brand) ? brand : undefined;
}

/**
 * Расход на рекламу за период по nm_id — для колонки «Реклама» (справочно,
 * не вычитается из маржи). Источник — wb_advert_spend_history («История
 * затрат» WB, adv/v1/upd, реальные списания с баланса), та же методология,
 * что и «ВБ продвижение» в гугл-таблице (СУММЕСЛИМН по вкладке
 * «Продвижение», которая сама заполняется этим же отчётом WB).
 *
 * Строка этого отчёта не несёт nm_id — только campaign_name ("Кампания" в
 * личном кабинете WB), в котором WB/продавец кладёт nm_id последним числом
 * в названии (сверено на всех 25 кампаниях кабинета — без исключений).
 * Тот же приём, что уже используется в adsSpendBySource.ts для суб-брендов
 * (там — по вхождению префикса артикула; тут нужен точный nm_id, поэтому
 * регэксп по последнему числу, не префикс).
 *
 * wb_advert_nm_daily (прежний источник, fullstats) смешивает баланс и
 * бонусы и был случайно занижен из-за неполного покрытия по некоторым
 * SKU — проверено построчно: для TT04101 новый источник (988 ₽) и старый
 * (1001,7 ₽) почти совпали, а для TT04102 оба независимо дали ~0 — не
 * баг, кампании этого товара реально не крутились с начала августа.
 */
async function fetchAdSpendByNmId(
  cabinetId: string,
  dateFrom: string,
  dateTo: string,
): Promise<Map<number, number>> {
  const db = getSupabaseAdmin();
  const map = new Map<number, number>();
  if (!db) return map;
  const { data, error } = await db
    .from("wb_advert_spend_history")
    .select("campaign_name, payment_type, amount")
    .eq("cabinet_id", cabinetId)
    .gte("date", dateFrom)
    .lte("date", dateTo);
  if (error) {
    console.error("[opiu margin] ad spend read:", error.message);
    return map;
  }
  for (const row of data ?? []) {
    const paymentType = String(row.payment_type ?? "").toLowerCase();
    const isBonus = paymentType.includes("бонус") || paymentType.includes("кэшбэк") || paymentType.includes("кешбэк");
    if (isBonus) continue;
    const match = String(row.campaign_name ?? "").match(/(\d{6,})\s*$/);
    if (!match) continue;
    const nmId = Number(match[1]);
    if (!Number.isFinite(nmId)) continue;
    map.set(nmId, (map.get(nmId) ?? 0) + Number(row.amount ?? 0));
  }
  return map;
}

/**
 * nm_id этого суб-бренда — Воронка не хранит артикул, только nm_id, поэтому
 * для кабинетов, разделённых по префиксу артикула (Norvia/Heaton/Riobox),
 * whitelist считаем по сырым wb_orders (там supplier_article есть). Тот же
 * приём, что и brandNmIdWhitelist в loadMonth.ts.
 */
async function fetchBrandNmIdWhitelist(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  cabinetId: string,
  dateFrom: string,
  dateTo: string,
  articlePrefixes: string[],
): Promise<Set<number>> {
  const rows = await loadAllSupabasePages<{ nm_id: number; supplier_article: string | null }>(
    async (from, to) => {
      const result = await db
        .from("wb_orders")
        .select("nm_id, supplier_article")
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
    { maxPages: 300, label: "Маржа по артикулам: nm_id суб-бренда" },
  );
  const whitelist = new Set<number>();
  for (const row of rows) {
    if (!matchesArticlePrefix(row.supplier_article, articlePrefixes)) continue;
    const nmId = Number(row.nm_id);
    if (Number.isFinite(nmId) && nmId > 0) whitelist.add(nmId);
  }
  return whitelist;
}

/**
 * Заказы за период по nm_id — как в столбце «Заказы» гугл-таблицы (и как в
 * официальной выгрузке WB «Аналитика → Воронка продаж»). Источник —
 * wb_funnel_daily (уже синкается для ОПиУ), не сырые wb_orders: сырые заказы
 * недосчитывают на ходовых SKU (сверка на TT04102: wb_orders дал 245, а
 * Воронка/эталонная таблица/выгрузка WB — 290, ровно как в файле от 24.09).
 * TT04101 совпадал и по wb_orders (16), поэтому расхождение раньше не
 * бросалось в глаза — оно проявляется только на высоком объёме заказов.
 *
 * «Отказы» сюда НЕ входят — у Воронки нет числа отмен по дням, только
 * orders/orders_sum. Настоящая формула «Отказов» в таблице — отдельная,
 * count(bonus_type_name = "От клиента при отмене") по финотчёту, она в
 * buildMarginByBarcode (isClientCancelRow).
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

  const [facts, whitelist] = await Promise.all([
    loadReadyFunnelFacts(db, cabinetId, dateFrom, dateTo),
    articlePrefixes?.length
      ? fetchBrandNmIdWhitelist(db, cabinetId, dateFrom, dateTo, articlePrefixes)
      : Promise.resolve<Set<number> | null>(null),
  ]);

  for (const fact of facts) {
    if (whitelist && !whitelist.has(fact.nmId)) continue;
    const entry = map.get(fact.nmId) ?? { ordersQty: 0, ordersRub: 0 };
    entry.ordersQty += Number(fact.orders) || 0;
    entry.ordersRub += Number(fact.ordersSum) || 0;
    map.set(fact.nmId, entry);
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
    const [reportRows, costs, adSpendByNmId, ordersByNmId, paidStorageByArticle] = await Promise.all([
      fetchReportRows(dateFrom, dateTo, "sale", brand.cabinetId),
      fetchProductCosts(brand),
      fetchAdSpendByNmId(brand.cabinetId, dateFrom, dateTo),
      fetchOrdersByNmId(brand.cabinetId, dateFrom, dateTo, brand.articlePrefixes),
      fetchPaidStorageByArticle(brand.cabinetId, dateFrom, dateTo, brand.articlePrefixes),
    ]);

    const scopedRows = brand.articlePrefixes?.length
      ? reportRows.filter((row) => matchesArticlePrefix(row.sa_name, brand.articlePrefixes))
      : reportRows;

    const { rows, unattributedRows } = buildMarginByBarcode(
      scopedRows,
      costs,
      adSpendByNmId,
      ordersByNmId,
      paidStorageByArticle,
    );

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
