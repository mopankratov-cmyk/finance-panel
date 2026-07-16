import type { WbOrder, WbReportRow } from "@/lib/wb/types";
import type { MonthWeek } from "./weeks";
import type { DeliveryCostRow } from "./fetchGoogleCosts";
import type { NmStatRow } from "./fetchNmStats";

export interface AdvertSpendRow {
  date: string;  // YYYY-MM-DD
  sum: number;   // updSum — сумма списания
}

export interface ProductCostRow {
  article: string;
  wb_barcode: string | null;
  cost_rub: number;
  packaging_rub: number;
}

export interface WeekRawMetrics {
  ordersRub: number;
  revenueWithoutSpp: number; // Выручка без СПП (retail_price_withdisc)
  revenue: number;           // Выручка с учётом СПП (retail_amount)
  forPay: number;            // К перечислению продавцу (ppvz_for_pay)
  commission: number;        // Комиссия ВБ = revenueWithoutSpp − forPay
  logistics: number;         // Логистика (delivery_rub)
  cogs: number;              // Себестоимость
  packaging: number;         // Подготовка (упаковка, маркировка, отгрузка)
  penalties: number;         // Штрафы и доплаты (penalty + additional_payment)
  storage: number;           // Хранение (storage_fee)
  otherDeductions: number;   // Прочие удержания (deduction по Удержание, кроме спец. типов)
  subscriptionJem: number;   // Подписка "Джем"
  transitDelivery: number;   // Транзитные поставки
  acceptance: number;        // Платная приёмка
  adsSpend: number;          // ВБ продвижение
  loanTransfer: number;      // Перевод на баланс заёмщика (займ/кредит)
  penaltyLoan: number;       // Пени по займу/кредиту
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

/** Дата продажи — как в «Своде отчёта WB по дате продажи» (sale_dt, не rr_dt) */
function rowDate(row: WbReportRow): string {
  return String(row.sale_dt ?? row.rr_dt ?? row.order_dt ?? row.create_dt ?? "").slice(0, 10);
}

function orderDate(row: WbOrder): string {
  return String(row.date ?? "").slice(0, 10);
}

function docType(row: WbReportRow): "sale" | "return" | "other" {
  const t = String(row.doc_type_name ?? row.supplier_oper_name ?? "").toLowerCase();
  if (t.includes("продаж") || t.includes("sale")) return "sale";
  if (t.includes("возврат") || t.includes("return")) return "return";
  return "other";
}

function isSale(row: WbReportRow): boolean {
  return docType(row) === "sale";
}

// «Воронка продаж» считает заказы по цене со скидкой продавца (priceWithDisc, без WB СПП).
function orderRub(row: WbOrder): number {
  // priceWithDisc возвращается API напрямую и точнее чем totalPrice*(1-disc/100)
  const priceWithDisc = num((row as Record<string, unknown>).priceWithDisc);
  if (priceWithDisc > 0) return Math.abs(priceWithDisc);
  const price = num(row.totalPrice);
  const discount = num(row.discountPercent);
  return Math.abs(price * (1 - discount / 100));
}

function revenueRub(row: WbReportRow): number {
  const type = docType(row);
  if (type === "other") return 0;
  const amount = num(row.retail_amount) || num(row.retail_price_withdisc_rub) * Math.abs(num(row.quantity) || 1);
  return type === "sale" ? amount : -amount;
}

function revenueWithoutSppRub(row: WbReportRow): number {
  const type = docType(row);
  if (type === "other") return 0;
  const amount = num(row.retail_price_withdisc_rub) * Math.abs(num(row.quantity) || 1);
  return type === "sale" ? amount : -amount;
}

function forPayRub(row: WbReportRow): number {
  const type = docType(row);
  if (type === "other") return 0;
  const amount = num(row.ppvz_for_pay);
  return type === "sale" ? amount : -amount;
}

function expenseRub(value: unknown): number {
  return num(value);
}

/** Тип удержания по bonus_type_name */
function bonusType(row: WbReportRow): string {
  return String(row.bonus_type_name ?? "").toLowerCase();
}

function buildCostLookup(costs: ProductCostRow[], deliveryCosts: DeliveryCostRow[]): {
  costByArticle: Map<string, number>;
  costByBarcode: Map<string, number>;
  packByArticle: Map<string, number>;
  packByBarcode: Map<string, number>;
  costByGiBarcode: Map<string, number>;
  packByGiBarcode: Map<string, number>;
} {
  const costByArticle = new Map<string, number>();
  const costByBarcode = new Map<string, number>();
  const packByArticle = new Map<string, number>();
  const packByBarcode = new Map<string, number>();
  for (const c of costs) {
    const key = c.article.trim().toUpperCase();
    costByArticle.set(key, c.cost_rub);
    packByArticle.set(key, c.packaging_rub);
    if (c.wb_barcode) {
      costByBarcode.set(c.wb_barcode, c.cost_rub);
      packByBarcode.set(c.wb_barcode, c.packaging_rub);
    }
  }
  // Primary: gi_id + barcode — точное совпадение с "Себестоимость поставок WB"
  const costByGiBarcode = new Map<string, number>();
  const packByGiBarcode = new Map<string, number>();
  for (const d of deliveryCosts) {
    const key = `${d.gi_id}|${d.barcode}`;
    costByGiBarcode.set(key, d.cost_rub);
    packByGiBarcode.set(key, d.packaging_rub);
  }
  return { costByArticle, costByBarcode, packByArticle, packByBarcode, costByGiBarcode, packByGiBarcode };
}

function unitCost(
  row: WbReportRow,
  lookup: ReturnType<typeof buildCostLookup>,
): number {
  const giId   = String((row as Record<string, unknown>).gi_id ?? "");
  const barcode = String(row.barcode ?? "");
  const article = String(row.sa_name ?? "").trim().toUpperCase();
  // 1. Точное совпадение поставка+баркод (Себестоимость поставок WB)
  if (giId && barcode) {
    const v = lookup.costByGiBarcode.get(`${giId}|${barcode}`);
    if (v !== undefined) return v;
  }
  // 2. Фоллбэк по артикулу / баркоду (Базовая себестоимость)
  return lookup.costByArticle.get(article) ?? lookup.costByBarcode.get(barcode) ?? 0;
}

function unitPackaging(
  row: WbReportRow,
  lookup: ReturnType<typeof buildCostLookup>,
): number {
  const giId   = String((row as Record<string, unknown>).gi_id ?? "");
  const barcode = String(row.barcode ?? "");
  const article = String(row.sa_name ?? "").trim().toUpperCase();
  // 1. Точное совпадение поставка+баркод (Себестоимость поставок WB)
  if (giId && barcode) {
    const v = lookup.packByGiBarcode.get(`${giId}|${barcode}`);
    if (v !== undefined) return v;
  }
  // 2. Фоллбэк по артикулу / баркоду (Базовая себестоимость)
  return lookup.packByArticle.get(article) ?? lookup.packByBarcode.get(barcode) ?? 0;
}

function cogsForSales(
  sales: WbReportRow[],
  lookup: ReturnType<typeof buildCostLookup>,
): number {
  return sales.reduce((sum, row) => {
    const type = docType(row);
    if (type === "other") return sum;
    const qty = Math.abs(num(row.quantity));
    const cost = unitCost(row, lookup) * qty;
    return type === "sale" ? sum + cost : sum - cost;
  }, 0);
}

function packagingForSales(
  sales: WbReportRow[],
  lookup: ReturnType<typeof buildCostLookup>,
): number {
  return sales.reduce((sum, row) => {
    const type = docType(row);
    if (type === "other") return sum;
    const qty = Math.abs(num(row.quantity));
    const pack = unitPackaging(row, lookup) * qty;
    return type === "sale" ? sum + pack : sum - pack;
  }, 0);
}

function adsSpendInRange(adStats: AdvertSpendRow[], from: string, to: string): number {
  return adStats.reduce((s, r) => inRange(r.date, from, to) ? s + r.sum : s, 0);
}

export function aggregateWeek(
  week: MonthWeek,
  sales: WbReportRow[],
  orders: WbOrder[],
  adStats: AdvertSpendRow[],
  costLookup: ReturnType<typeof buildCostLookup>,
  nmStats: NmStatRow[] = [],
): WeekRawMetrics {
  const { rangeFrom, rangeTo } = week;

  // ordersRub: если есть NM-статистика — берём оттуда (как в Excel D7),
  // иначе считаем из индивидуальных заказов (прибл.)
  const nmOrdersTotal = nmStats
    .filter((r) => inRange(r.date, rangeFrom, rangeTo))
    .reduce((s, r) => s + r.ordersSumRub, 0);

  // «Воронка продаж» считает все заказы — включая отменённые (cancelled).
  const weekOrders = orders.filter(
    (o) => inRange(orderDate(o), rangeFrom, rangeTo),
  );
  const weekSales = sales.filter((r) => inRange(rowDate(r), rangeFrom, rangeTo));

  const revenueWithoutSpp = weekSales.reduce((s, r) => s + revenueWithoutSppRub(r), 0);
  const forPay = weekSales.reduce((s, r) => s + forPayRub(r), 0);

  return {
    ordersRub: nmOrdersTotal > 0
      ? nmOrdersTotal
      : weekOrders.reduce((s, o) => s + orderRub(o), 0),
    revenueWithoutSpp,
    revenue: weekSales.reduce((s, r) => s + revenueRub(r), 0),
    forPay,
    // Комиссия = Выручка без СПП − К перечислению (строка 12 в «Своде WB по дате продажи»)
    commission: revenueWithoutSpp - forPay,
    logistics: weekSales.reduce((s, r) => s + expenseRub(r.delivery_rub), 0),
    cogs: cogsForSales(weekSales, costLookup),
    packaging: packagingForSales(weekSales, costLookup),
    penalties: weekSales.reduce((s, r) => s + expenseRub(r.penalty) + expenseRub(r.additional_payment), 0),
    storage: weekSales.reduce((s, r) => s + expenseRub(r.storage_fee), 0),
    // Прочие: deduction только по строкам supplier_oper_name="Удержание"/"Удержания",
    // минус Джем, Транзит, Продвижение, Сторно приёмки, Перевод на баланс (как в Excel строка 22)
    otherDeductions: weekSales.reduce(
      (s, r) => {
        const operName = String(r.supplier_oper_name ?? "").toLowerCase().trim();
        if (operName !== "удержание" && operName !== "удержания") return s;
        const bt = bonusType(r);
        if (bt.includes("джем")) return s;
        if (bt.includes("транзит")) return s;
        if (bt.includes("продвижение")) return s;
        if (bt.includes("сторно платной приемки")) return s;
        if (bt.includes("перевод на баланс")) return s;
        return s + expenseRub(r.deduction);
      },
      0,
    ),
    subscriptionJem: weekSales.reduce((s, r) => {
      const bt = bonusType(r);
      return bt.includes("джем") ? s + expenseRub(r.deduction) : s;
    }, 0),
    transitDelivery: weekSales.reduce((s, r) => {
      const bt = bonusType(r);
      return bt.includes("транзит") ? s + expenseRub(r.deduction) : s;
    }, 0),
    acceptance: weekSales.reduce((s, r) => s + expenseRub(r.acceptance), 0),
    adsSpend: adsSpendInRange(adStats, rangeFrom, rangeTo),
    loanTransfer: weekSales.reduce((s, r) => {
      const bt = bonusType(r);
      const isLoan =
        bt.startsWith("перевод на баланс заёмщика для платежа по договору займа") ||
        bt.startsWith("перевод на баланс заёмщика для оплаты основного долга по кредиту") ||
        bt.startsWith("перевод на баланс заёмщика для оплаты комиссии по кредиту") ||
        bt.startsWith("перевод на баланс заёмщика для оплаты процентов по кредиту");
      return isLoan ? s + expenseRub(r.deduction) : s;
    }, 0),
    penaltyLoan: weekSales.reduce((s, r) => {
      const bt = bonusType(r);
      return bt.startsWith("перевод на баланс заёмщика для оплаты пени")
        ? s + expenseRub(r.deduction)
        : s;
    }, 0),
  };
}

export function sumWeeks(weeks: WeekRawMetrics[]): WeekRawMetrics {
  const zero: WeekRawMetrics = {
    ordersRub: 0, revenueWithoutSpp: 0, revenue: 0, forPay: 0,
    commission: 0, logistics: 0, cogs: 0, packaging: 0,
    penalties: 0, storage: 0, otherDeductions: 0,
    subscriptionJem: 0, transitDelivery: 0, acceptance: 0, adsSpend: 0,
    loanTransfer: 0, penaltyLoan: 0,
  };
  return weeks.reduce(
    (acc, w) => ({
      ordersRub: acc.ordersRub + w.ordersRub,
      revenueWithoutSpp: acc.revenueWithoutSpp + w.revenueWithoutSpp,
      revenue: acc.revenue + w.revenue,
      forPay: acc.forPay + w.forPay,
      commission: acc.commission + w.commission,
      logistics: acc.logistics + w.logistics,
      cogs: acc.cogs + w.cogs,
      packaging: acc.packaging + w.packaging,
      penalties: acc.penalties + w.penalties,
      storage: acc.storage + w.storage,
      otherDeductions: acc.otherDeductions + w.otherDeductions,
      subscriptionJem: acc.subscriptionJem + w.subscriptionJem,
      transitDelivery: acc.transitDelivery + w.transitDelivery,
      acceptance: acc.acceptance + w.acceptance,
      adsSpend: acc.adsSpend + w.adsSpend,
      loanTransfer: acc.loanTransfer + w.loanTransfer,
      penaltyLoan: acc.penaltyLoan + w.penaltyLoan,
    }),
    zero,
  );
}
