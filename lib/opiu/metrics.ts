import type { WbAdStat, WbOrder, WbReportRow } from "@/lib/wb/types";
import type { MonthWeek } from "./weeks";

export interface ProductCostRow {
  article: string;
  wb_barcode: string | null;
  cost_rub: number;
}

export interface WeekRawMetrics {
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

function orderDate(row: WbOrder): string {
  return String(row.date ?? "").slice(0, 10);
}

function isSale(row: WbReportRow): boolean {
  const t = String(row.doc_type_name ?? row.supplier_oper_name ?? "").toLowerCase();
  return t.includes("продаж") || t.includes("sale");
}

function orderRub(row: WbOrder): number {
  const price = num(row.totalPrice);
  const discount = num(row.discountPercent);
  const beforeSpp = Math.abs(price * (1 - discount / 100));
  if (beforeSpp > 0) return beforeSpp;
  return Math.abs(num(row.finishedPrice));
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
  orders: WbOrder[],
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
