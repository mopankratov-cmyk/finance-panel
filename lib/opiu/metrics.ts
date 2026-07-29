import type { WbAdStat, WbOrder, WbReportRow } from "@/lib/wb/types";
import type { MonthWeek } from "./weeks";

export interface OpiuOrder extends WbOrder {
  nmId?: number;
  ordersCount?: number;
  /** Сохранённая сумма заказов до СПП, уже агрегированная по SKU/дню. */
  totalPriceDiscount?: number;
}

export interface FunnelOrderFact {
  cabinetId: string;
  date: string;
  nmId: number;
  orders: unknown;
  ordersSum: unknown;
}

export interface ProductCostRow {
  article: string;
  wb_barcode: string | null;
  cost_rub: number;
}

export interface WeekRawMetrics {
  orders: number;
  ordersRub: number;
  revenue: number;
  cogs: number;
  commission: number;
  logistics: number;
  otherDeductions: number;
  adsSpend: number;
  warehousePackaging: number;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

/** Дата операции в финотчёте WB (rr_dt — основное поле отчёта) */
function rowDate(row: WbReportRow): string {
  return String(row.rr_dt ?? row.sale_dt ?? row.order_dt ?? row.create_dt ?? "").slice(
    0,
    10,
  );
}

function orderDate(row: OpiuOrder): string {
  return String(row.date ?? "").slice(0, 10);
}

function isSale(row: WbReportRow): boolean {
  const t = String(row.doc_type_name ?? row.supplier_oper_name ?? "").toLowerCase();
  return t.includes("продаж") || t.includes("sale");
}

function orderRub(row: OpiuOrder): number {
  if (row.totalPriceDiscount !== undefined) {
    return Math.abs(num(row.totalPriceDiscount));
  }
  const directBeforeSpp = Math.abs(num(row.priceWithDisc));
  if (directBeforeSpp > 0) return directBeforeSpp;
  const price = num(row.totalPrice);
  const discount = num(row.discountPercent);
  const beforeSpp = Math.abs(price * (1 - discount / 100));
  if (beforeSpp > 0) return beforeSpp;
  return Math.abs(num(row.finishedPrice));
}

const CANONICAL_UNSIGNED_INTEGER = /^(?:0|[1-9]\d*)$/;
const CANONICAL_UNSIGNED_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function parseOrders(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && CANONICAL_UNSIGNED_INTEGER.test(value)
      ? Number(value)
      : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseOrdersSum(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && CANONICAL_UNSIGNED_DECIMAL.test(value)
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function orderKey(date: string, nmId: number): string {
  return `${date.slice(0, 10)}\u0000${nmId}`;
}

export function overlayFunnelOrders(
  orders: OpiuOrder[],
  funnelFacts: FunnelOrderFact[],
  expectedCabinetId: string,
): OpiuOrder[] {
  const grouped = new Map<string, {
    date: string;
    nmId: number;
    ordersCount: number;
    totalPriceDiscount: number;
    valid: boolean;
  }>();

  for (const fact of funnelFacts) {
    if (fact.cabinetId !== expectedCabinetId) continue;
    const date = String(fact.date ?? "").slice(0, 10);
    const nmId = Number(fact.nmId);
    if (!date || !Number.isFinite(nmId)) continue;
    const key = orderKey(date, nmId);
    const current = grouped.get(key) ?? {
      date,
      nmId,
      ordersCount: 0,
      totalPriceDiscount: 0,
      valid: true,
    };
    const ordersCount = parseOrders(fact.orders);
    const totalPriceDiscount = parseOrdersSum(fact.ordersSum);
    if (ordersCount === null || totalPriceDiscount === null) {
      current.valid = false;
    } else {
      current.ordersCount += ordersCount;
      current.totalPriceDiscount += totalPriceDiscount;
    }
    grouped.set(key, current);
  }

  const covered = new Set(
    [...grouped.entries()]
      .filter(([, fact]) => fact.valid)
      .map(([key]) => key),
  );
  const fallback = orders.filter((row) => {
    const date = orderDate(row);
    const nmId = Number(row.nmId);
    return !date || !Number.isFinite(nmId) || !covered.has(orderKey(date, nmId));
  });
  const synthetic = [...grouped.values()]
    .filter((fact) => fact.valid)
    .map(({ date, nmId, ordersCount, totalPriceDiscount }) => ({
      date,
      nmId,
      ordersCount,
      totalPriceDiscount,
    }));

  return [...fallback, ...synthetic];
}

function revenueRub(row: WbReportRow): number {
  if (!isSale(row)) return 0;
  const amount = num(row.retail_amount);
  if (amount) return amount;
  return num(row.retail_price_withdisc_rub) * Math.abs(num(row.quantity) || 1);
}

/** Суммируем со знаком: возвраты уменьшают удержания */
function expenseRub(value: unknown): number {
  return num(value);
}

function buildCostLookup(costs: ProductCostRow[]): {
  byArticle: Map<string, number>;
  byBarcode: Map<string, number>;
} {
  const byArticle = new Map<string, number>();
  const byBarcode = new Map<string, number>();
  for (const c of costs) {
    byArticle.set(c.article.trim().toUpperCase(), c.cost_rub);
    if (c.wb_barcode) byBarcode.set(c.wb_barcode, c.cost_rub);
  }
  return { byArticle, byBarcode };
}

function unitCost(
  row: WbReportRow,
  lookup: ReturnType<typeof buildCostLookup>,
): number {
  const article = String(row.sa_name ?? "").trim().toUpperCase();
  const barcode = String(row.barcode ?? "");
  return lookup.byArticle.get(article) ?? lookup.byBarcode.get(barcode) ?? 0;
}

function cogsForSales(
  sales: WbReportRow[],
  lookup: ReturnType<typeof buildCostLookup>,
): number {
  return sales.filter(isSale).reduce((sum, row) => {
    const qty = Math.abs(num(row.quantity) || 1);
    return sum + unitCost(row, lookup) * qty;
  }, 0);
}

function adsSpendInRange(adStats: WbAdStat[], from: string, to: string): number {
  let total = 0;
  for (const stat of adStats) {
    if (stat.days?.length) {
      for (const day of stat.days) {
        const d = String(day.date ?? "").slice(0, 10);
        if (d && inRange(d, from, to)) total += num(day.sum);
      }
    } else {
      total += num(stat.sum);
    }
  }
  return total;
}

export function aggregateWeek(
  week: MonthWeek,
  sales: WbReportRow[],
  orders: OpiuOrder[],
  adStats: WbAdStat[],
  costLookup: ReturnType<typeof buildCostLookup>,
  warehousePackaging: number,
): WeekRawMetrics {
  const { rangeFrom, rangeTo } = week;

  const weekOrders = orders.filter(
    (o) => !o.isCancel && inRange(orderDate(o), rangeFrom, rangeTo),
  );
  const weekSales = sales.filter((r) => inRange(rowDate(r), rangeFrom, rangeTo));
  const saleRows = weekSales.filter(isSale);

  return {
    orders: weekOrders.reduce((sum, order) => sum + (order.ordersCount ?? 1), 0),
    ordersRub: weekOrders.reduce((s, o) => s + orderRub(o), 0),
    revenue: saleRows.reduce((s, r) => s + revenueRub(r), 0),
    cogs: cogsForSales(weekSales, costLookup),
    commission: weekSales.reduce((s, r) => s + expenseRub(r.ppvz_sales_commission), 0),
    logistics: weekSales.reduce(
      (s, r) => s + expenseRub(r.delivery_rub) + expenseRub(r.rebill_logistic_cost),
      0,
    ),
    otherDeductions: weekSales.reduce(
      (s, r) =>
        s +
        expenseRub(r.penalty) +
        expenseRub(r.deduction) +
        expenseRub(r.additional_payment) +
        expenseRub(r.storage_fee) +
        expenseRub(r.acceptance) +
        expenseRub(r.acquiring_fee),
      0,
    ),
    adsSpend: adsSpendInRange(adStats, rangeFrom, rangeTo),
    warehousePackaging,
  };
}

export function sumWeeks(weeks: WeekRawMetrics[]): WeekRawMetrics {
  return weeks.reduce(
    (acc, w) => ({
      orders: acc.orders + w.orders,
      ordersRub: acc.ordersRub + w.ordersRub,
      revenue: acc.revenue + w.revenue,
      cogs: acc.cogs + w.cogs,
      commission: acc.commission + w.commission,
      logistics: acc.logistics + w.logistics,
      otherDeductions: acc.otherDeductions + w.otherDeductions,
      adsSpend: acc.adsSpend + w.adsSpend,
      warehousePackaging: acc.warehousePackaging + w.warehousePackaging,
    }),
    {
      orders: 0,
      ordersRub: 0,
      revenue: 0,
      cogs: 0,
      commission: 0,
      logistics: 0,
      otherDeductions: 0,
      adsSpend: 0,
      warehousePackaging: 0,
    },
  );
}
