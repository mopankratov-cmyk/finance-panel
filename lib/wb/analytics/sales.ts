import { addDays, dateRangeDays, toISODate } from "@/lib/analytics/format";
import type { WbOrder, WbReportRow } from "@/lib/wb/types";

export interface DateRange {
  from: string;
  to: string;
}

export function getPreviousRange(range: DateRange): DateRange {
  const from = new Date(range.from);
  const to = new Date(range.to);
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return { from: toISODate(prevFrom), to: toISODate(prevTo) };
}

function rowDate(row: WbReportRow): string {
  const dt = row.sale_dt ?? row.order_dt ?? row.create_dt ?? "";
  return dt.slice(0, 10);
}

function isSale(row: WbReportRow): boolean {
  const t = (row.doc_type_name ?? row.supplier_oper_name ?? "").toLowerCase();
  return t.includes("продаж") || t.includes("sale");
}

function isReturn(row: WbReportRow): boolean {
  const t = (row.doc_type_name ?? row.supplier_oper_name ?? "").toLowerCase();
  return t.includes("возврат") || t.includes("return");
}

function inRange(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

function filterRows(rows: WbReportRow[], range: DateRange): WbReportRow[] {
  return rows.filter((r) => inRange(rowDate(r), range));
}

function filterOrders(orders: WbOrder[], range: DateRange): WbOrder[] {
  return orders.filter((o) => {
    const d = (o.date ?? "").slice(0, 10);
    return d && inRange(d, range) && !o.isCancel;
  });
}

export interface ExecutiveSummary {
  revenue: number;
  orders: number;
  sales: number;
  buyoutPct: number;
  avgCheck: number;
  returnsQty: number;
  returnsSum: number;
  prev: {
    revenue: number;
    orders: number;
    sales: number;
    avgCheck: number;
    returnsQty: number;
    returnsSum: number;
  };
}

export function computeExecutiveSummary(
  rows: WbReportRow[],
  orders: WbOrder[],
  range: DateRange,
  prevRange: DateRange,
): ExecutiveSummary {
  const curRows = filterRows(rows, range);
  const prevRows = filterRows(rows, prevRange);
  const curOrders = filterOrders(orders, range);
  const prevOrders = filterOrders(orders, prevRange);

  const salesRows = curRows.filter(isSale);
  const prevSalesRows = prevRows.filter(isSale);
  const returnRows = curRows.filter(isReturn);

  const revenue = salesRows.reduce((s, r) => s + (r.ppvz_for_pay ?? r.retail_amount ?? 0), 0);
  const prevRevenue = prevSalesRows.reduce(
    (s, r) => s + (r.ppvz_for_pay ?? r.retail_amount ?? 0),
    0,
  );

  const sales = salesRows.reduce((s, r) => s + Math.abs(r.quantity ?? 0), 0);
  const prevSales = prevSalesRows.reduce((s, r) => s + Math.abs(r.quantity ?? 0), 0);

  const orderCount = curOrders.length || salesRows.length;
  const prevOrderCount = prevOrders.length || prevSalesRows.length;

  const returnsQty = returnRows.reduce((s, r) => s + Math.abs(r.quantity ?? 0), 0);
  const returnsSum = returnRows.reduce(
    (s, r) => s + Math.abs(r.ppvz_for_pay ?? r.retail_amount ?? 0),
    0,
  );
  const prevReturnsQty = prevRows.filter(isReturn).reduce((s, r) => s + Math.abs(r.quantity ?? 0), 0);
  const prevReturnsSum = prevRows
    .filter(isReturn)
    .reduce((s, r) => s + Math.abs(r.ppvz_for_pay ?? r.retail_amount ?? 0), 0);

  const buyoutPct = orderCount > 0 ? (sales / orderCount) * 100 : 0;
  const avgCheck = sales > 0 ? revenue / sales : 0;
  const prevAvgCheck = prevSales > 0 ? prevRevenue / prevSales : 0;

  return {
    revenue,
    orders: orderCount,
    sales,
    buyoutPct,
    avgCheck,
    returnsQty,
    returnsSum,
    prev: {
      revenue: prevRevenue,
      orders: prevOrderCount,
      sales: prevSales,
      avgCheck: prevAvgCheck,
      returnsQty: prevReturnsQty,
      returnsSum: prevReturnsSum,
    },
  };
}

export interface DailyPoint {
  date: string;
  revenue: number;
  orders: number;
  sales: number;
  buyoutPct: number;
  isWeekend: boolean;
}

export function computeDailyDynamics(
  rows: WbReportRow[],
  orders: WbOrder[],
  range: DateRange,
): DailyPoint[] {
  const days = dateRangeDays(range.from, range.to);
  const curOrders = filterOrders(orders, range);
  const curRows = filterRows(rows, range);

  return days.map((date) => {
    const dayOrders = curOrders.filter((o) => (o.date ?? "").slice(0, 10) === date);
    const daySales = curRows.filter((r) => isSale(r) && rowDate(r) === date);
    const sales = daySales.reduce((s, r) => s + Math.abs(r.quantity ?? 0), 0);
    const revenue = daySales.reduce((s, r) => s + (r.ppvz_for_pay ?? r.retail_amount ?? 0), 0);
    const orderCount = dayOrders.length || daySales.length;
    const dow = new Date(date).getDay();
    return {
      date,
      revenue,
      orders: orderCount,
      sales,
      buyoutPct: orderCount > 0 ? (sales / orderCount) * 100 : 0,
      isWeekend: dow === 0 || dow === 6,
    };
  });
}

export interface NicheRow {
  subject: string;
  revenue: number;
  orders: number;
  sales: number;
  returns: number;
  buyoutPct: number;
  commission: number;
  logistics: number;
  forPay: number;
  marginPct: number;
  trend: number[];
}

export function computeNiches(rows: WbReportRow[], range: DateRange): NicheRow[] {
  const cur = filterRows(rows, range);
  const map = new Map<string, NicheRow>();

  for (const r of cur) {
    const subject = r.subject_name ?? "Без категории";
    const existing = map.get(subject) ?? {
      subject,
      revenue: 0,
      orders: 0,
      sales: 0,
      returns: 0,
      buyoutPct: 0,
      commission: 0,
      logistics: 0,
      forPay: 0,
      marginPct: 0,
      trend: [],
    };

    const qty = Math.abs(r.quantity ?? 0);
    const amount = r.retail_amount ?? 0;
    const forPay = r.ppvz_for_pay ?? 0;
    const commission = r.ppvz_sales_commission ?? 0;
    const logistics = r.delivery_rub ?? 0;

    if (isSale(r)) {
      existing.sales += qty;
      existing.revenue += amount;
      existing.forPay += forPay;
      existing.commission += Math.abs(commission);
      existing.logistics += Math.abs(logistics);
      existing.orders += 1;
    } else if (isReturn(r)) {
      existing.returns += qty;
    }

    map.set(subject, existing);
  }

  const result = Array.from(map.values());
  const totalRev = result.reduce((s, n) => s + n.revenue, 0) || 1;

  for (const n of result) {
    n.buyoutPct = n.orders > 0 ? (n.sales / n.orders) * 100 : 0;
    n.marginPct = n.revenue > 0 ? (n.forPay / n.revenue) * 100 : 0;
    n.trend = computeNicheTrend(cur, n.subject);
    void totalRev;
  }

  return result.sort((a, b) => b.revenue - a.revenue);
}

function computeNicheTrend(rows: WbReportRow[], subject: string): number[] {
  const last7 = rows
    .filter((r) => isSale(r) && r.subject_name === subject)
    .reduce(
      (acc, r) => {
        const d = rowDate(r);
        acc[d] = (acc[d] ?? 0) + (r.ppvz_for_pay ?? r.retail_amount ?? 0);
        return acc;
      },
      {} as Record<string, number>,
    );
  return Object.values(last7).slice(-7);
}

export interface ArticleRow {
  nmId: number;
  article: string;
  name: string;
  brand: string;
  revenue: number;
  orders: number;
  sales: number;
  returns: number;
  buyoutPct: number;
  commission: number;
  logistics: number;
  forPay: number;
  cost: number;
  profit: number;
  marginPct: number;
  roiPct: number;
  abc: "A" | "B" | "C";
}

export function computeArticles(
  rows: WbReportRow[],
  range: DateRange,
  costs: Record<number, number>,
): ArticleRow[] {
  const cur = filterRows(rows, range);
  const map = new Map<number, ArticleRow>();

  for (const r of cur) {
    const nmId = r.nm_id ?? 0;
    if (!nmId) continue;

    const existing = map.get(nmId) ?? {
      nmId,
      article: r.sa_name ?? String(nmId),
      name: r.subject_name ?? r.sa_name ?? String(nmId),
      brand: r.brand_name ?? "—",
      revenue: 0,
      orders: 0,
      sales: 0,
      returns: 0,
      buyoutPct: 0,
      commission: 0,
      logistics: 0,
      forPay: 0,
      cost: costs[nmId] ?? 0,
      profit: 0,
      marginPct: 0,
      roiPct: 0,
      abc: "C" as const,
    };

    if (isSale(r)) {
      existing.sales += Math.abs(r.quantity ?? 0);
      existing.revenue += r.retail_amount ?? 0;
      existing.forPay += r.ppvz_for_pay ?? 0;
      existing.commission += Math.abs(r.ppvz_sales_commission ?? 0);
      existing.logistics += Math.abs(r.delivery_rub ?? 0);
      existing.orders += 1;
    } else if (isReturn(r)) {
      existing.returns += Math.abs(r.quantity ?? 0);
    }

    map.set(nmId, existing);
  }

  const articles = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);

  let cumulative = 0;
  const totalRev = articles.reduce((s, a) => s + a.revenue, 0) || 1;

  for (const a of articles) {
    a.buyoutPct = a.orders > 0 ? (a.sales / a.orders) * 100 : 0;
    const totalCost = a.cost * a.sales;
    a.profit = a.forPay - totalCost;
    a.marginPct = a.revenue > 0 ? (a.profit / a.revenue) * 100 : 0;
    a.roiPct = totalCost > 0 ? (a.profit / totalCost) * 100 : 0;
    cumulative += a.revenue;
    const share = cumulative / totalRev;
    if (share <= 0.8) a.abc = "A";
    else if (share <= 0.95) a.abc = "B";
    else a.abc = "C";
  }

  return articles;
}

export interface ReturnRow {
  nmId: number;
  article: string;
  returns: number;
  returnPct: number;
  loss: number;
}

export function computeReturns(rows: WbReportRow[], range: DateRange): ReturnRow[] {
  const cur = filterRows(rows, range);
  const map = new Map<number, ReturnRow>();

  for (const r of cur) {
    const nmId = r.nm_id ?? 0;
    if (!nmId) continue;
    const existing = map.get(nmId) ?? {
      nmId,
      article: r.sa_name ?? String(nmId),
      returns: 0,
      returnPct: 0,
      loss: 0,
    };
    if (isReturn(r)) {
      existing.returns += Math.abs(r.quantity ?? 0);
      existing.loss += Math.abs(r.ppvz_for_pay ?? r.retail_amount ?? 0);
    }
    map.set(nmId, existing);
  }

  const salesByNm = new Map<number, number>();
  for (const r of cur.filter(isSale)) {
    const id = r.nm_id ?? 0;
    salesByNm.set(id, (salesByNm.get(id) ?? 0) + Math.abs(r.quantity ?? 0));
  }

  return Array.from(map.values())
    .map((row) => {
      const sales = salesByNm.get(row.nmId) ?? 0;
      row.returnPct = sales + row.returns > 0 ? (row.returns / (sales + row.returns)) * 100 : 0;
      return row;
    })
    .sort((a, b) => b.returns - a.returns);
}

export interface WeeklyCohort {
  week: string;
  label: string;
  revenue: number;
  orders: number;
  wowPct: number;
  topArticle: string;
}

export function computeWeeklyCohort(
  rows: WbReportRow[],
  orders: WbOrder[],
  range: DateRange,
): WeeklyCohort[] {
  const cur = filterRows(rows, range);
  const curOrders = filterOrders(orders, range);
  const weeks = new Map<string, { revenue: number; orders: number; articles: Map<number, number> }>();

  for (const r of cur.filter(isSale)) {
    const d = rowDate(r);
    const weekStart = getWeekStart(d);
    const w = weeks.get(weekStart) ?? { revenue: 0, orders: 0, articles: new Map() };
    w.revenue += r.ppvz_for_pay ?? r.retail_amount ?? 0;
    w.orders += 1;
    const nm = r.nm_id ?? 0;
    w.articles.set(nm, (w.articles.get(nm) ?? 0) + (r.ppvz_for_pay ?? 0));
    weeks.set(weekStart, w);
  }

  for (const o of curOrders) {
    const d = (o.date ?? "").slice(0, 10);
    const weekStart = getWeekStart(d);
    const w = weeks.get(weekStart);
    if (w) w.orders = Math.max(w.orders, curOrders.filter((x) => getWeekStart((x.date ?? "").slice(0, 10)) === weekStart).length);
  }

  const sorted = Array.from(weeks.entries()).sort(([a], [b]) => a.localeCompare(b));
  let prevRevenue = 0;

  return sorted.map(([weekStart, data], i) => {
    const wow = prevRevenue > 0 ? ((data.revenue - prevRevenue) / prevRevenue) * 100 : 0;
    prevRevenue = data.revenue;
    let topArticle = "—";
    let topRev = 0;
    data.articles.forEach((rev, nm) => {
      if (rev > topRev) {
        topRev = rev;
        topArticle = String(nm);
      }
    });
    const end = addDays(new Date(weekStart), 6);
    return {
      week: `W${i + 1}`,
      label: `${weekStart.slice(5).replace("-", ".")}–${toISODate(end).slice(5).replace("-", ".")}`,
      revenue: data.revenue,
      orders: data.orders,
      wowPct: wow,
      topArticle,
    };
  });
}

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return toISODate(d);
}

export function abcInsight(articles: ArticleRow[]): string {
  const aCount = articles.filter((a) => a.abc === "A").length;
  return `${aCount} артикулов категории A генерируют ~80% выручки`;
}
