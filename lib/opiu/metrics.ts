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
  /** WB Analytics gross placed orders; cancellations are intentionally not subtracted. */
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
  /** Выручка без СПП — retail_price_withdisc_rub (до скидки постоянного покупателя). */
  revenueWithoutSpp: number;
  /** Выручка с учётом СПП — фактическая сумма продажи (retail_amount). */
  revenue: number;
  forPay: number;
  cogs: number;
  commission: number;
  logistics: number;
  /** Прочие удержания — остаток после вычета штрафов/Джема/Транзита/«Вывести сейчас» ниже. */
  otherDeductions: number;
  /** Штрафы и доплаты (penalty + additional_payment). */
  penalties: number;
  /** Подписка «Джем» (deduction, bonus_type_name содержит «джем»). */
  subscriptionJem: number;
  /** Транзитные поставки (deduction, bonus_type_name содержит «транзит»). */
  transitDelivery: number;
  /** Разовое изменение срока перечисления денежных средств. */
  withdrawNow: number;
  /** Платная приёмка (acceptance). */
  acceptance: number;
  /** Перевод на баланс заёмщика для платежа/долга/процентов/комиссии по займу (deduction). */
  loanTransfer: number;
  /** Перевод на баланс заёмщика для оплаты пени (deduction). */
  penaltyLoan: number;
  adsSpend: number;
  warehousePackaging: number;
  /** Компенсация скидки по программе лояльности (cashback_discount). */
  loyaltyCompensation: number;
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

function docType(row: WbReportRow): "sale" | "return" | "other" {
  const t = String(row.doc_type_name ?? row.supplier_oper_name ?? "").toLowerCase();
  if (t.includes("продаж") || t.includes("sale")) return "sale";
  if (t.includes("возврат") || t.includes("return")) return "return";
  return "other";
}

/**
 * Комиссия ВБ = Выручка без СПП − К перечислению продавцу (остаток).
 * В отличие от m.revenueWithoutSpp/forPay (которые считаются только по
 * продажам, без учёта возвратов — так исторически сделано на main для
 * строк "Выручка"/"К перечислению"), здесь both суммируются по ВСЕМ
 * строкам (продажи и возвраты) со знаком — возврат вычитает — чтобы
 * остаток точно совпадал с методологией старой ветки (Excel-модель).
 */
function commissionResidualRub(row: WbReportRow): number {
  const type = docType(row);
  if (type === "other") return 0;
  const revenueWithoutSpp = num(row.retail_price_withdisc_rub) * Math.abs(num(row.quantity) || 1) + loyaltyCompensationRub(row);
  const forPay = num(row.ppvz_for_pay);
  const signed = revenueWithoutSpp - forPay;
  return type === "sale" ? signed : -signed;
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
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseOrdersSum(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && CANONICAL_UNSIGNED_DECIMAL.test(value)
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed)
    && parsed >= 0
    && parsed <= Number.MAX_SAFE_INTEGER
    ? parsed
    : null;
}

function orderKey(date: string, nmId: number): string {
  return `${date}\u0000${nmId}`;
}

function canonicalFactDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() !== value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (!match || (value.length > 10 && !Number.isFinite(Date.parse(value)))) return null;
  const [, year, month, day] = match;
  const date = `${year}-${month}-${day}`;
  const canonical = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
    .toISOString()
    .slice(0, 10);
  return canonical === date ? date : null;
}

export function overlayFunnelOrders(
  orders: OpiuOrder[],
  funnelFacts: FunnelOrderFact[],
  expectedCabinetId: string,
): OpiuOrder[] {
  const factsByKey = new Map<string, {
    date: string;
    nmId: number;
    ordersCount: number;
    totalPriceDiscount: number;
  }>();

  for (const fact of funnelFacts) {
    if (!fact || typeof fact !== "object" || fact.cabinetId !== expectedCabinetId) {
      return orders;
    }
    const date = canonicalFactDate(fact.date);
    const nmId = fact.nmId;
    const ordersCount = parseOrders(fact.orders);
    const totalPriceDiscount = parseOrdersSum(fact.ordersSum);
    if (
      date === null
      || !Number.isSafeInteger(nmId)
      || nmId <= 0
      || ordersCount === null
      || totalPriceDiscount === null
    ) {
      return orders;
    }
    const key = orderKey(date, nmId);
    if (factsByKey.has(key)) return orders;
    factsByKey.set(key, {
      date,
      nmId,
      ordersCount,
      totalPriceDiscount,
    });
  }

  const covered = new Set(factsByKey.keys());
  const fallback = orders.filter((row) => {
    const date = orderDate(row);
    const nmId = Number(row.nmId);
    return !date || !Number.isFinite(nmId) || !covered.has(orderKey(date, nmId));
  });
  const synthetic: OpiuOrder[] = [...factsByKey.values()]
    .map(({ date, nmId, ordersCount, totalPriceDiscount }) => ({
      date,
      nmId,
      ordersCount,
      totalPriceDiscount,
    }));

  let cumulativeOrders = 0;
  let cumulativeOrdersRub = 0;
  for (const row of [...fallback, ...synthetic]) {
    if (row.isCancel) continue;
    const count = row.ordersCount ?? 1;
    const rub = orderRub(row);
    if (
      !Number.isSafeInteger(count)
      || count < 0
      || !Number.isFinite(rub)
      || rub < 0
      || rub > Number.MAX_SAFE_INTEGER
    ) {
      return orders;
    }
    cumulativeOrders += count;
    cumulativeOrdersRub += rub;
    if (
      !Number.isSafeInteger(cumulativeOrders)
      || !Number.isFinite(cumulativeOrdersRub)
      || cumulativeOrdersRub > Number.MAX_SAFE_INTEGER
    ) {
      return orders;
    }
  }

  return [...fallback, ...synthetic];
}

/**
 * WB хранит ppvz_for_pay по возвратам как положительное число (не готовое
 * к сложению) — суммировать без учёта типа операции нельзя, иначе выплата
 * продавцу задваивается на сумму возвратов.
 */
function forPayRub(row: WbReportRow): number {
  const type = docType(row);
  if (type === "other") return 0;
  const amount = num(row.ppvz_for_pay);
  return type === "sale" ? amount : -amount;
}

/**
 * Возвраты вычитаются из выручки (со знаком), а не просто исключаются —
 * иначе выручка задваивается на сумму возвратов относительно реального
 * поступления денег.
 */
function revenueRub(row: WbReportRow): number {
  const type = docType(row);
  if (type === "other") return 0;
  const amount = num(row.retail_amount) || num(row.retail_price_withdisc_rub) * Math.abs(num(row.quantity) || 1);
  return type === "sale" ? amount : -amount;
}

/**
 * cashback_discount (компенсация скидки по программе лояльности) добавляется
 * к "Выручке без СПП" — WB так возмещает продавцу часть выручки, потерянной
 * из-за скидки постоянного покупателя. Без этого "без СПП" занижена ровно
 * на сумму компенсации за неделю.
 */
function revenueWithoutSppRub(row: WbReportRow): number {
  const type = docType(row);
  if (type === "other") return 0;
  const amount = num(row.retail_price_withdisc_rub) * Math.abs(num(row.quantity) || 1) + loyaltyCompensationRub(row);
  return type === "sale" ? amount : -amount;
}

/** Суммируем со знаком: возвраты уменьшают удержания */
function expenseRub(value: unknown): number {
  return num(value);
}

/**
 * Компенсация скидки по программе лояльности.
 * Колонка cashback_discount пока не выбирается в reportRows.ts (REPORT_COLUMNS) —
 * её нет в таблице Supabase wb_report_rows (см. заявку docs/codemap/request-wb-sales-fields.md).
 * До миграции row.cashback_discount всегда undefined → метрика безопасно равна 0.
 * Как только колонка появится и попадёт в REPORT_COLUMNS/REPORT_FIELDS, значения
 * подтянутся сюда без дополнительных правок.
 */
function loyaltyCompensationRub(row: WbReportRow): number {
  const raw = row as Record<string, unknown>;
  return num(raw.cashback_discount);
}

function bonusType(row: WbReportRow): string {
  return String(row.bonus_type_name ?? "").toLowerCase();
}

function penaltiesRub(row: WbReportRow): number {
  return expenseRub(row.penalty) + expenseRub(row.additional_payment);
}

function subscriptionJemRub(row: WbReportRow): number {
  return bonusType(row).includes("джем") ? expenseRub(row.deduction) : 0;
}

function transitDeliveryRub(row: WbReportRow): number {
  return bonusType(row).includes("транзит") ? expenseRub(row.deduction) : 0;
}

function withdrawNowRub(row: WbReportRow): number {
  const oper = String(row.supplier_oper_name ?? "").trim().toLowerCase();
  return oper === "разовое изменение срока перечисления денежных средств"
    ? expenseRub(row.deduction)
    : 0;
}

function acceptanceRub(row: WbReportRow): number {
  return expenseRub(row.acceptance);
}

/**
 * WB иногда выставляет счёт за рекламные услуги отдельной строкой прямо
 * в финотчёте (supplier_oper_name="Удержание", bonus_type_name содержит
 * "Оказание услуг «WB Продвижение»"), привязанной к произвольной дате
 * счёта, а не к датам продаж. Реклама уже честно считается из отдельного
 * источника (wb_advert_nm_daily/adsSpend) — эта строка задвоила бы расход
 * и раздувала бы "Прочие удержания". Исключаем её из P&L целиком.
 */
function isAdsInvoiceDeductionRow(row: WbReportRow): boolean {
  const oper = String(row.supplier_oper_name ?? "").trim().toLowerCase();
  if (oper !== "удержание") return false;
  const bt = bonusType(row);
  return bt.includes("оказание услуг") && bt.includes("продвижение");
}

function adsInvoiceDeductionRub(row: WbReportRow): number {
  return isAdsInvoiceDeductionRow(row) ? expenseRub(row.deduction) : 0;
}

/** Автоматическое "Хранение" — идёт в строку "Хранение / упаковка склада" в дополнение к ручному вводу. */
function storageFeeRub(row: WbReportRow): number {
  return expenseRub(row.storage_fee);
}

function loanTransferRub(row: WbReportRow): number {
  const bt = bonusType(row);
  const isLoan =
    bt.startsWith("перевод на баланс заёмщика для платежа по договору займа") ||
    bt.startsWith("перевод на баланс заёмщика для оплаты основного долга по кредиту") ||
    bt.startsWith("перевод на баланс заёмщика для оплаты комиссии по кредиту") ||
    bt.startsWith("перевод на баланс заёмщика для оплаты процентов по кредиту");
  return isLoan ? expenseRub(row.deduction) : 0;
}

function penaltyLoanRub(row: WbReportRow): number {
  const bt = bonusType(row);
  return bt.startsWith("перевод на баланс заёмщика для оплаты пени")
    ? expenseRub(row.deduction)
    : 0;
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

  return {
    orders: weekOrders.reduce((sum, order) => sum + (order.ordersCount ?? 1), 0),
    ordersRub: weekOrders.reduce((s, o) => s + orderRub(o), 0),
    revenueWithoutSpp: weekSales.reduce((s, r) => s + revenueWithoutSppRub(r), 0),
    revenue: weekSales.reduce((s, r) => s + revenueRub(r), 0),
    forPay: weekSales.reduce((s, r) => s + forPayRub(r), 0),
    cogs: cogsForSales(weekSales, costLookup),
    commission: weekSales.reduce((s, r) => s + commissionResidualRub(r), 0),
    logistics: weekSales.reduce(
      (s, r) => s + expenseRub(r.delivery_rub) + expenseRub(r.rebill_logistic_cost),
      0,
    ),
    // acquiring_fee (эквайринг) намеренно не входит в пул — не относится
    // никуда в P&L по решению владельца, не вычитается из прибыли.
    // storage_fee уходит в warehousePackaging (строка "Хранение") ниже,
    // а не в "Прочие удержания" — тогда сумма реально видна в отчёте,
    // а не тонет в общей корзине.
    otherDeductions: weekSales.reduce(
      (s, r) =>
        s +
        expenseRub(r.penalty) +
        expenseRub(r.deduction) +
        expenseRub(r.additional_payment) +
        expenseRub(r.acceptance) -
        penaltiesRub(r) -
        subscriptionJemRub(r) -
        transitDeliveryRub(r) -
        withdrawNowRub(r) -
        acceptanceRub(r) -
        loanTransferRub(r) -
        penaltyLoanRub(r) -
        adsInvoiceDeductionRub(r),
      0,
    ),
    penalties: weekSales.reduce((s, r) => s + penaltiesRub(r), 0),
    subscriptionJem: weekSales.reduce((s, r) => s + subscriptionJemRub(r), 0),
    transitDelivery: weekSales.reduce((s, r) => s + transitDeliveryRub(r), 0),
    withdrawNow: weekSales.reduce((s, r) => s + withdrawNowRub(r), 0),
    acceptance: weekSales.reduce((s, r) => s + acceptanceRub(r), 0),
    loanTransfer: weekSales.reduce((s, r) => s + loanTransferRub(r), 0),
    penaltyLoan: weekSales.reduce((s, r) => s + penaltyLoanRub(r), 0),
    adsSpend: adsSpendInRange(adStats, rangeFrom, rangeTo),
    // "Хранение / упаковка склада" = ручной ввод (собственные расходы) + storage_fee из финотчёта.
    warehousePackaging: warehousePackaging + weekSales.reduce((s, r) => s + storageFeeRub(r), 0),
    loyaltyCompensation: weekSales.reduce((s, r) => s + loyaltyCompensationRub(r), 0),
  };
}

export function sumWeeks(weeks: WeekRawMetrics[]): WeekRawMetrics {
  return weeks.reduce(
    (acc, w) => ({
      orders: acc.orders + w.orders,
      ordersRub: acc.ordersRub + w.ordersRub,
      revenueWithoutSpp: acc.revenueWithoutSpp + w.revenueWithoutSpp,
      revenue: acc.revenue + w.revenue,
      forPay: acc.forPay + w.forPay,
      cogs: acc.cogs + w.cogs,
      commission: acc.commission + w.commission,
      logistics: acc.logistics + w.logistics,
      otherDeductions: acc.otherDeductions + w.otherDeductions,
      penalties: acc.penalties + w.penalties,
      subscriptionJem: acc.subscriptionJem + w.subscriptionJem,
      transitDelivery: acc.transitDelivery + w.transitDelivery,
      withdrawNow: acc.withdrawNow + w.withdrawNow,
      acceptance: acc.acceptance + w.acceptance,
      loanTransfer: acc.loanTransfer + w.loanTransfer,
      penaltyLoan: acc.penaltyLoan + w.penaltyLoan,
      adsSpend: acc.adsSpend + w.adsSpend,
      warehousePackaging: acc.warehousePackaging + w.warehousePackaging,
      loyaltyCompensation: acc.loyaltyCompensation + w.loyaltyCompensation,
    }),
    {
      orders: 0,
      ordersRub: 0,
      revenueWithoutSpp: 0,
      revenue: 0,
      forPay: 0,
      cogs: 0,
      commission: 0,
      logistics: 0,
      otherDeductions: 0,
      penalties: 0,
      subscriptionJem: 0,
      transitDelivery: 0,
      withdrawNow: 0,
      acceptance: 0,
      loanTransfer: 0,
      penaltyLoan: 0,
      adsSpend: 0,
      warehousePackaging: 0,
      loyaltyCompensation: 0,
    },
  );
}
