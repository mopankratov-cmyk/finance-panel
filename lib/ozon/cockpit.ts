import { previousOzonPeriod, type OzonPeriod } from "@/lib/ozon/period";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { calculateAdvertProfitGuardrail } from "@/lib/adverts/profitGuardrails";
import type { OzonCabinetScope } from "@/lib/ozon/cabinet";
import {
  ozonAnalytics,
  ozonAnalyticsDaily,
  ozonImages,
  ozonPostings,
  ozonPrices,
  ozonServiceBreakdown,
  ozonStocks,
  ozonTransactionTotals,
  type OzonAnalyticsDailyRow,
  type OzonTotals,
} from "@/lib/ozon/api";
import { getPerfToken, isOzonPerformanceReportDeferredMessage, perfDailySpend, perfProductReport } from "@/lib/ozon/performance";
import { createOzonCostResolver } from "@/lib/ozon/costs";
import { chooseOzonAdSource, ozonAdHistoryDays, type OzonAdCoverage } from "@/lib/ozon/adCoverage";
import { describeOzonPostingStatus, isOzonPostingDelayed } from "@/lib/ozon/postingStatus";
import { indexOzonOfferIdsBySku, resolveOzonOfferId } from "@/lib/ozon/productIdentity";
import { cachedOzonImages, cachedOzonPrices, cachedOzonStocks } from "@/lib/ozon/staticCache";
import { buyerDiscountForOffer, loadOzonBuyerDiscount, taxableOzonPrice } from "@/lib/ozon/buyerDiscount";
import { loadCabinetUnitSettings, type CabinetUnitSettings } from "@/lib/unit/cabinetSettings";
import {
  calculateOzonEconomyUnit,
  ozonAdCacheStatus,
  requireCompleteOzonSalesSnapshot,
  summarizeOzonEconomy,
  summarizeOzonHealth,
  summarizeOzonSales,
  type OzonQualityStatus,
} from "@/lib/ozon/cockpitQuality";

export type OzonCockpitView = "overview" | "sales" | "adverts" | "stocks" | "orders" | "economy" | "health";

const DAY = 86_400_000;
const r0 = (value: number) => Math.round(value || 0);
const r1 = (value: number) => Math.round((value || 0) * 10) / 10;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const pct = (part: number, total: number) => total > 0 ? r1((part / total) * 100) : 0;
const deltaPct = (current: number, previous: number) => previous !== 0 ? r1(((current - previous) / Math.abs(previous)) * 100) : null;
const dateOnly = (value: Date | number) => new Date(value).toISOString().slice(0, 10);

/** Период с запасом влево — нужен там, где рядом с текущим считается предыдущий. */
function withPrevious(period: OzonPeriod) {
  return { from: previousOzonPeriod(period).from, to: period.to };
}

function dateAxis(from: string, to: string) {
  const result: string[] = [];
  for (let cursor = new Date(`${from}T00:00:00Z`).getTime(); cursor <= new Date(`${to}T00:00:00Z`).getTime(); cursor += DAY) {
    result.push(dateOnly(cursor));
  }
  return result;
}

function publicScope(scope: OzonCabinetScope) {
  return {
    mode: scope.mode,
    label: scope.label,
    count: scope.cabinets.length,
    cabinets: scope.cabinets.map((cabinet) => ({ id: cabinet.id, name: cabinet.name, hasPerformance: Boolean(cabinet.perf) })),
  };
}

interface AdCacheRow {
  client_id: string;
  sku: string;
  spent: number | string | null;
  orders_money: number | string | null;
  updated_at: string | null;
}

interface OzonAdCacheResult {
  /** Ключ — `clientId:sku`. */
  rows: Map<string, { spent: number; ordersMoney: number; updatedAt: string | null }>;
  /** Полнота и источник по каждому кабинету — для честной подписи на экране. */
  coverage: OzonAdCoverage[];
}

async function loadAdCache(scope: OzonCabinetScope, period: OzonPeriod): Promise<OzonAdCacheResult> {
  const days = period.days;
  const db = getSupabaseAdmin();
  const rows = new Map<string, { spent: number; ordersMoney: number; updatedAt: string | null }>();
  const coverage: OzonAdCoverage[] = [];
  if (!db || !scope.cabinets.length) return { rows, coverage };
  const clientIds = scope.cabinets.map((cabinet) => cabinet.clientId);
  // Кэш расхода рекламы хранится по числу дней и означает «последние N дней».
  // Для периода, который кончился в прошлом, эта строка — не тот период, и брать
  // её значило бы показать расход не за то время. Такой период читаем живьём.
  // Для «последних N дней» точный ответ — скользящее окно: история по дням
  // ещё дозаполняется, и её неполнота занижала бы расход на главных экранах.
  // Посуточные строки — для произвольных периодов, где окно молчит вовсе
  // (01.08-26.08 показывал нули), и как запасной путь при пустом окне.
  const periodDays = Math.max(1, Math.round(
    (Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000,
  ) + 1);
  const historyDays = ozonAdHistoryDays(periodDays, period.endsToday);

  // Оба источника читаем сразу и раскладываем ПО КАБИНЕТАМ: выбор источника
  // общей кучей на весь скоуп приводил к тому, что история одного кабинета
  // «покрывала» период, и расход остальных обнулялся.
  type Bucket = Map<string, { spent: number; ordersMoney: number; updatedAt: string | null }>;
  const dailyByClient = new Map<string, Bucket>();
  const dailyDates = new Map<string, Set<string>>();
  const windowByClient = new Map<string, Bucket>();

  const [{ data: dailyRows }, { data: windowRows }] = await Promise.all([
    db.from("ozon_ad_daily")
      .select("client_id, sku, spent, orders_money, updated_at, date")
      .in("client_id", clientIds)
      .gte("date", period.from)
      .lte("date", period.to),
    // Окно означает «последние N дней» и годится только для периода,
    // кончающегося сегодня. Для прошлого периода это просто другой отрезок.
    period.endsToday
      ? db.from("ozon_ad_cache")
        .select("client_id, sku, spent, orders_money, updated_at")
        .in("client_id", clientIds)
        .eq("days", days)
      : Promise.resolve({ data: [] as AdCacheRow[] }),
  ]);

  for (const row of (dailyRows ?? []) as Array<AdCacheRow & { date?: string }>) {
    const clientId = String(row.client_id);
    if (row.date) {
      const dates = dailyDates.get(clientId) ?? new Set<string>();
      dates.add(String(row.date).slice(0, 10));
      dailyDates.set(clientId, dates);
    }
    if (String(row.sku) === "-") continue; // маркер «день собран, расхода не было»
    const bucket = dailyByClient.get(clientId) ?? new Map();
    const entry = bucket.get(String(row.sku)) ?? { spent: 0, ordersMoney: 0, updatedAt: null };
    entry.spent += Number(row.spent ?? 0);
    entry.ordersMoney += Number(row.orders_money ?? 0);
    entry.updatedAt = row.updated_at ?? entry.updatedAt;
    bucket.set(String(row.sku), entry);
    dailyByClient.set(clientId, bucket);
  }

  for (const row of (windowRows ?? []) as AdCacheRow[]) {
    const clientId = String(row.client_id);
    const bucket = windowByClient.get(clientId) ?? new Map();
    bucket.set(String(row.sku), {
      spent: Number(row.spent ?? 0),
      ordersMoney: Number(row.orders_money ?? 0),
      updatedAt: row.updated_at,
    });
    windowByClient.set(clientId, bucket);
  }

  const spendOf = (bucket: Bucket | undefined) =>
    bucket ? [...bucket.values()].reduce((total, value) => total + value.spent, 0) : 0;

  for (const cabinet of scope.cabinets) {
    const clientId = cabinet.clientId;
    const daily = dailyByClient.get(clientId);
    const window = windowByClient.get(clientId);
    const coveredDays = dailyDates.get(clientId)?.size ?? 0;
    const decision = chooseOzonAdSource({
      periodDays,
      endsToday: period.endsToday,
      coveredDays,
      dailyHasSpend: spendOf(daily) > 0,
      windowAvailable: period.endsToday && windowByClient.has(clientId),
      windowHasSpend: spendOf(window) > 0,
    });
    const chosen = decision.source === "window" ? window : decision.source === "daily" ? daily : undefined;
    for (const [sku, value] of chosen ?? []) rows.set(`${clientId}:${sku}`, value);
    coverage.push({
      clientId,
      cabinet: cabinet.name,
      periodDays,
      historyDays,
      coveredDays,
      source: decision.source,
      complete: decision.complete,
    });
  }

  // Плановая синхронизация держит 14-дневный кэш. Для другого выбранного периода
  // или нового кабинета точечно догружаем Performance, чтобы отсутствие строки не
  // выглядело как нулевой расход. Кабинеты обновляются параллельно, ключ включает client_id.
  const noData = new Set(coverage.filter((item) => item.source === "none").map((item) => item.clientId));
  const missing = scope.cabinets.filter((cabinet) => cabinet.perf && noData.has(cabinet.clientId));
  if (missing.length) {
    const range = period;
    const reports = await Promise.all(missing.map(async (cabinet) => ({
      cabinet,
      // Экран не должен ждать, пока Ozon приготовит отчёт: раньше запрос
      // висел здесь до 20 секунд и всё равно чаще возвращался ни с чем —
      // отчёт готовится минутами. Пробуем коротко, остальное принесёт крон.
      report: await perfProductReport(
        cabinet.perf!,
        `${range.from}T00:00:00.000Z`,
        `${range.to}T23:59:59.999Z`,
        60,
        { pollAttempts: 2, pollIntervalMs: 700, maxBatchesPerRun: 1 },
      ),
    })));
    const freshRows: Array<{ client_id: string; sku: string; days: number; spent: number; orders_money: number; updated_at: string }> = [];
    for (const { cabinet, report } of reports) {
      if (!report) continue;
      const updatedAt = new Date().toISOString();
      for (const [sku, value] of Object.entries(report.bySku)) {
        rows.set(`${cabinet.clientId}:${sku}`, { spent: value.spent, ordersMoney: value.ordersMoney, updatedAt });
        freshRows.push({ client_id: cabinet.clientId, sku, days, spent: r0(value.spent), orders_money: r0(value.ordersMoney), updated_at: updatedAt });
      }
      // Живой отчёт закрывает период целиком — кабинет больше не «не собран».
      const entry = coverage.find((item) => item.clientId === cabinet.clientId);
      if (entry) { entry.source = "live"; entry.complete = true; }
    }
    // Пишем в кэш только «последние N дней»: иначе строка соврёт следующему,
    // кто спросит тот же N.
    if (freshRows.length && period.endsToday) {
      await db.from("ozon_ad_cache").upsert(freshRows, { onConflict: "client_id,sku,days" });
    }
  }
  return { rows, coverage };
}

async function loadCosts() {
  const db = getSupabaseAdmin();
  if (!db) return createOzonCostResolver([]);
  const { data } = await db.from("product_costs").select("article, name, cost_rub");
  return createOzonCostResolver(data ?? []);
}

function emptyTotals(): OzonTotals {
  return {
    accruals_for_sale: 0,
    sale_commission: 0,
    processing_and_delivery: 0,
    refunds_and_cancellations: 0,
    services_amount: 0,
    compensation_amount: 0,
    money_transfer: 0,
    others_amount: 0,
  };
}

function addTotals(target: OzonTotals, value: OzonTotals) {
  for (const key of Object.keys(target) as (keyof OzonTotals)[]) target[key] += Number(value[key] ?? 0);
}

function financeSummary(totals: OzonTotals) {
  const commission = Math.abs(totals.sale_commission);
  const logistics = Math.abs(totals.processing_and_delivery);
  const services = Math.abs(totals.services_amount);
  const refunds = Math.abs(totals.refunds_and_cancellations);
  const other = Math.abs(totals.others_amount);
  const deductions = commission + logistics + services + refunds + other;
  return {
    accruals: r0(Math.abs(totals.accruals_for_sale)),
    commission: r0(commission),
    logistics: r0(logistics),
    services: r0(services),
    refunds: r0(refunds),
    other: r0(other),
    compensation: r0(totals.compensation_amount),
    deductions: r0(deductions),
    payout: r0(totals.accruals_for_sale - commission - logistics - services - refunds - other + totals.compensation_amount),
  };
}

interface CabinetBase {
  cabinetId: string;
  cabinetName: string;
  clientId: string;
  analytics: OzonAnalyticsDailyRow[];
  analyticsAvailable: boolean;
  analyticsError: string | null;
  funnel: boolean;
  stocks: Awaited<ReturnType<typeof ozonStocks>>;
  images: Awaited<ReturnType<typeof ozonImages>>;
  currentTotals: OzonTotals | null;
  previousTotals: OzonTotals | null;
  performance: Awaited<ReturnType<typeof perfDailySpend>>;
  warnings: string[];
}

async function loadCabinetBase(
  cabinet: OzonCabinetScope["cabinets"][number],
  from: string,
  to: string,
  currentFrom: string,
  previousFrom: string,
  previousTo: string,
  includeFunnel: boolean,
  includeFinance: boolean,
): Promise<CabinetBase> {
  const [analytics, stocks, images, currentTotals, previousTotals, performance] = await Promise.all([
    ozonAnalyticsDaily(cabinet.creds, from, to, includeFunnel),
    cachedOzonStocks(cabinet.creds),
    cachedOzonImages(cabinet.creds),
    includeFinance
      ? ozonTransactionTotals(cabinet.creds, `${currentFrom}T00:00:00.000Z`, `${to}T23:59:59.999Z`)
      : Promise.resolve(null),
    includeFinance
      ? ozonTransactionTotals(cabinet.creds, `${previousFrom}T00:00:00.000Z`, `${previousTo}T23:59:59.999Z`)
      : Promise.resolve(null),
    cabinet.perf ? perfDailySpend(cabinet.perf, from, to) : Promise.resolve(null),
  ]);

  const warnings: string[] = [];
  if (!analytics.ok) warnings.push(`${cabinet.name}: аналитика — ${analytics.error}`);
  if (!stocks.ok) warnings.push(`${cabinet.name}: остатки — ${stocks.error}`);
  if (currentTotals && !currentTotals.ok) warnings.push(`${cabinet.name}: финансы — ${currentTotals.error}`);
  if (cabinet.perf && !performance) warnings.push(`${cabinet.name}: Performance API недоступен`);

  return {
    cabinetId: cabinet.id,
    cabinetName: cabinet.name,
    clientId: cabinet.clientId,
    analytics: analytics.ok ? analytics.rows : [],
    analyticsAvailable: analytics.ok,
    analyticsError: analytics.ok ? null : analytics.error,
    funnel: analytics.ok && analytics.funnel,
    stocks,
    images,
    currentTotals: currentTotals?.ok ? currentTotals.totals : null,
    previousTotals: previousTotals?.ok ? previousTotals.totals : null,
    performance,
    warnings,
  };
}

export async function loadOverview(scope: OzonCabinetScope, current: OzonPeriod) {
  const days = current.days;
  const allPeriod = withPrevious(current);
  const currentPeriod = { from: current.from, to: current.to };
  const previous = previousOzonPeriod(current);
  const previousFrom = previous.from;
  const previousTo = previous.to;
  const bases = await Promise.all(scope.cabinets.map((cabinet) => loadCabinetBase(
    cabinet,
    allPeriod.from,
    allPeriod.to,
    currentPeriod.from,
    previousFrom,
    previousTo,
    false,
    true,
  )));
  requireCompleteOzonSalesSnapshot(bases.map((base) => ({
    cabinet: base.cabinetName,
    available: base.analyticsAvailable,
    error: base.analyticsError,
  })));
  const { rows: adCache, coverage: adCoverage } = await loadAdCache(scope, current);
  const dates = dateAxis(currentPeriod.from, currentPeriod.to);
  const currentByDay = new Map(dates.map((day) => [day, { orders: 0, revenue: 0, adSpend: 0 }]));
  const currentTotals = emptyTotals();
  const previousTotals = emptyTotals();
  const skuRows: Array<{
    key: string; cabinetId: string; cabinet: string; clientId: string; sku: string; offerId: string;
    name: string; image: string | null; orders: number; previousOrders: number; revenue: number;
    // null — остатки этого кабинета Ozon не отдал. Ноль здесь означал бы
    // «товар кончился», и обзор заливало ложными критикалами «нет остатка».
    previousRevenue: number; stock: number | null; reserved: number | null; adSpend: number; adRevenue: number;
  }> = [];
  let stock = 0;
  let reserved = 0;
  let stocksAvailable = 0;
  let currentAdSpend = 0;
  let previousAdSpend = 0;

  for (const base of bases) {
    if (base.currentTotals) addTotals(currentTotals, base.currentTotals);
    if (base.previousTotals) addTotals(previousTotals, base.previousTotals);
    const grouped = new Map<string, { name: string; orders: number; previousOrders: number; revenue: number; previousRevenue: number }>();
    for (const row of base.analytics) {
      const entry = grouped.get(row.sku) ?? { name: row.name, orders: 0, previousOrders: 0, revenue: 0, previousRevenue: 0 };
      if (row.day >= currentPeriod.from) {
        entry.orders += row.ordered_units;
        entry.revenue += row.revenue;
        const day = currentByDay.get(row.day);
        if (day) {
          day.orders += row.ordered_units;
          day.revenue += row.revenue;
        }
      } else if (row.day >= previousFrom && row.day <= previousTo) {
        entry.previousOrders += row.ordered_units;
        entry.previousRevenue += row.revenue;
      }
      grouped.set(row.sku, entry);
    }

    const stockByOffer = new Map<string, { free: number; reserved: number }>();
    if (base.stocks.ok) {
      stocksAvailable += 1;
      for (const row of base.stocks.rows) {
        const entry = stockByOffer.get(row.article) ?? { free: 0, reserved: 0 };
        entry.free += row.free;
        entry.reserved += row.reserved;
        stockByOffer.set(row.article, entry);
        stock += row.free;
        reserved += row.reserved;
      }
    }

    if (base.performance) {
      for (const [day, value] of Object.entries(base.performance.byDate)) {
        if (day >= currentPeriod.from) {
          currentAdSpend += value.spent;
          const daily = currentByDay.get(day);
          if (daily) daily.adSpend += value.spent;
        } else if (day >= previousFrom && day <= previousTo) previousAdSpend += value.spent;
      }
    }

    for (const [sku, metrics] of grouped) {
      const offerId = base.images.skuToOffer[sku] ?? "";
      const stockValue = base.stocks.ok
        ? stockByOffer.get(offerId) ?? { free: 0, reserved: 0 }
        : { free: null, reserved: null };
      const ad = adCache.get(`${base.clientId}:${sku}`) ?? { spent: 0, ordersMoney: 0 };
      skuRows.push({
        key: `${base.cabinetId}:${sku}`,
        cabinetId: base.cabinetId,
        cabinet: base.cabinetName,
        clientId: base.clientId,
        sku,
        offerId,
        name: metrics.name || offerId || sku,
        image: base.images.bySku[sku] ?? null,
        orders: metrics.orders,
        previousOrders: metrics.previousOrders,
        revenue: metrics.revenue,
        previousRevenue: metrics.previousRevenue,
        stock: stockValue.free,
        reserved: stockValue.reserved,
        adSpend: ad.spent,
        adRevenue: ad.ordersMoney,
      });
    }
  }

  const {
    orders: currentOrders,
    revenue: currentRevenue,
    previousOrders,
    previousRevenue,
  } = summarizeOzonSales(skuRows);

  if (currentAdSpend === 0 && days === 14) currentAdSpend = sum([...adCache.values()].map((row) => row.spent));
  const financial = financeSummary(currentTotals);
  const attention = skuRows.flatMap((row) => {
    const dailySales = row.orders / days;
    // Пока остатков нет, про запас сказать нечего: отказ Ozon однажды
    // превратился в лавину «нет остатка» по всем проданным товарам.
    const daysCover = row.stock != null && dailySales > 0 ? row.stock / dailySales : null;
    const drr = pct(row.adSpend, row.revenue);
    const messages: Array<{ severity: "critical" | "warning"; title: string; detail: string; href: string }> = [];
    if (row.orders > 0 && row.stock != null && row.stock <= 0) messages.push({ severity: "critical", title: `${row.offerId || row.sku}: нет остатка`, detail: `${r0(row.orders)} заказов за период`, href: "/ozon/stocks" });
    else if (daysCover !== null && daysCover <= 7) messages.push({ severity: "critical", title: `${row.offerId || row.sku}: запас на ${r1(daysCover)} дн.`, detail: `${r0(row.stock ?? 0)} шт. доступно`, href: "/ozon/stocks" });
    else if (daysCover !== null && daysCover <= 14) messages.push({ severity: "warning", title: `${row.offerId || row.sku}: пора пополнять`, detail: `Запас на ${r1(daysCover)} дн.`, href: "/ozon/stocks" });
    if (row.adSpend > 0 && drr >= 30) messages.push({ severity: "warning", title: `${row.offerId || row.sku}: ДРР ${drr}%`, detail: `${r0(row.adSpend).toLocaleString("ru-RU")} ₽ расход`, href: "/ozon/adverts" });
    return messages;
  }).sort((left, right) => left.severity === right.severity ? 0 : left.severity === "critical" ? -1 : 1).slice(0, 12);

  if (financial.refunds > 0 && pct(financial.refunds, currentRevenue) >= 10) {
    attention.unshift({ severity: "warning", title: "Высокая сумма возвратов", detail: `${pct(financial.refunds, currentRevenue)}% от выручки`, href: "/ozon/orders" });
  }

  return {
    view: "overview",
    scope: publicScope(scope),
    period: { ...currentPeriod, days },
    generatedAt: new Date().toISOString(),
    summary: {
      orders: r0(currentOrders),
      revenue: r0(currentRevenue),
      avgPrice: currentOrders > 0 ? r0(currentRevenue / currentOrders) : 0,
      // Ни один кабинет не отдал остатки — карточка честно пустая, а не «0».
      stock: stocksAvailable ? r0(stock) : null,
      reserved: stocksAvailable ? r0(reserved) : null,
      stocksIncomplete: stocksAvailable < bases.length,
      adSpend: r0(currentAdSpend),
      adRevenue: r0(sum([...adCache.values()].map((row) => row.ordersMoney))),
      drr: pct(currentAdSpend, currentRevenue),
      refunds: financial.refunds,
      deductions: financial.deductions,
      payout: financial.payout,
      delta: {
        orders: deltaPct(currentOrders, previousOrders),
        revenue: deltaPct(currentRevenue, previousRevenue),
        adSpend: deltaPct(currentAdSpend, previousAdSpend),
      },
    },
    finance: financial,
    trend: dates.map((day) => ({ day, ...currentByDay.get(day)! })).map((row) => ({ ...row, revenue: r0(row.revenue), adSpend: r0(row.adSpend), orders: r0(row.orders) })),
    attention,
    topSku: skuRows
      .map((row) => {
        const dailySales = row.orders / days;
        return {
          ...row,
          orders: r0(row.orders),
          revenue: r0(row.revenue),
          stock: row.stock == null ? null : r0(row.stock),
          daysCover: row.stock != null && dailySales > 0 ? r1(row.stock / dailySales) : null,
          drr: pct(row.adSpend, row.revenue),
          deltaRevenue: deltaPct(row.revenue, row.previousRevenue),
        };
      })
      .sort((left, right) => right.revenue - left.revenue)
      .slice(0, 20),
    adCoverage,
    warnings: bases.flatMap((base) => base.warnings),
    capabilities: {
      performance: scope.cabinets.filter((cabinet) => cabinet.perf).length,
      seller: scope.cabinets.length,
    },
  };
}

export async function loadSales(scope: OzonCabinetScope, current: OzonPeriod) {
  const days = current.days;
  const range = current;
  const dates = dateAxis(range.from, range.to);
  const { rows: adCache, coverage: adCoverage } = await loadAdCache(scope, current);
  const bases = await Promise.all(scope.cabinets.map((cabinet) => loadCabinetBase(
    cabinet,
    range.from,
    range.to,
    range.from,
    range.from,
    range.from,
    true,
    false,
  )));
  requireCompleteOzonSalesSnapshot(bases.map((base) => ({
    cabinet: base.cabinetName,
    available: base.analyticsAvailable,
    error: base.analyticsError,
  })));
  const rows: Record<string, unknown>[] = [];
  for (const base of bases) {
    const grouped = new Map<string, { name: string; views: number; carts: number; orders: number; revenue: number; daily: Record<string, { orders: number; revenue: number }> }>();
    for (const row of base.analytics) {
      const entry = grouped.get(row.sku) ?? { name: row.name, views: 0, carts: 0, orders: 0, revenue: 0, daily: {} };
      entry.views += row.hits_view;
      entry.carts += row.hits_tocart;
      entry.orders += row.ordered_units;
      entry.revenue += row.revenue;
      entry.daily[row.day] = { orders: r0(row.ordered_units), revenue: r0(row.revenue) };
      grouped.set(row.sku, entry);
    }
    const stockByOffer = new Map<string, number>();
    if (base.stocks.ok) for (const stock of base.stocks.rows) stockByOffer.set(stock.article, (stockByOffer.get(stock.article) ?? 0) + stock.free);
    for (const [sku, entry] of grouped) {
      const offerId = base.images.skuToOffer[sku] ?? "";
      const ad = adCache.get(`${base.clientId}:${sku}`) ?? { spent: 0, ordersMoney: 0 };
      rows.push({
        key: `${base.cabinetId}:${sku}`,
        cabinetId: base.cabinetId,
        cabinet: base.cabinetName,
        sku,
        offerId,
        name: entry.name || offerId || sku,
        image: base.images.bySku[sku] ?? null,
        views: r0(entry.views),
        carts: r0(entry.carts),
        orders: r0(entry.orders),
        revenue: r0(entry.revenue),
        avgPrice: entry.orders > 0 ? r0(entry.revenue / entry.orders) : 0,
        crCart: entry.views > 0 ? pct(entry.carts, entry.views) : null,
        crOrder: entry.carts > 0 ? pct(entry.orders, entry.carts) : null,
        stock: r0(stockByOffer.get(offerId) ?? 0),
        adSpend: r0(ad.spent),
        drr: pct(ad.spent, entry.revenue),
        daily: dates.map((day) => ({ day, orders: entry.daily[day]?.orders ?? 0, revenue: entry.daily[day]?.revenue ?? 0 })),
        funnelAvailable: base.funnel,
      });
    }
  }
  const { orders: totalOrders, revenue: totalRevenue } = summarizeOzonSales(rows.map((row) => ({
    orders: Number(row.orders ?? 0),
    revenue: Number(row.revenue ?? 0),
  })));
  const totalViews = sum(rows.map((row) => Number(row.views ?? 0)));
  const totalCarts = sum(rows.map((row) => Number(row.carts ?? 0)));
  return {
    view: "sales",
    scope: publicScope(scope),
    period: { ...range, days },
    generatedAt: new Date().toISOString(),
    summary: {
      views: r0(totalViews),
      carts: r0(totalCarts),
      orders: r0(totalOrders),
      revenue: r0(totalRevenue),
      avgPrice: totalOrders > 0 ? r0(totalRevenue / totalOrders) : 0,
      crCart: totalViews > 0 ? pct(totalCarts, totalViews) : null,
      crOrder: totalCarts > 0 ? pct(totalOrders, totalCarts) : null,
    },
    funnelAvailable: bases.length > 0 && bases.every((base) => base.funnel),
    funnelCabinets: bases.filter((base) => base.funnel).map((base) => base.cabinetName),
    dates,
    rows: rows.sort((left, right) => Number(right.revenue ?? 0) - Number(left.revenue ?? 0)),
    adCoverage,
    warnings: bases.flatMap((base) => base.warnings),
  };
}

export async function loadStocks(scope: OzonCabinetScope, current: OzonPeriod) {
  const days = current.days;
  const range = current;
  const bases = await Promise.all(scope.cabinets.map((cabinet) => loadCabinetBase(
    cabinet,
    range.from,
    range.to,
    range.from,
    range.from,
    range.from,
    false,
    false,
  )));
  const rows: Record<string, unknown>[] = [];
  const identityWarnings: string[] = [];
  for (const base of bases) {
    const stockRows = base.stocks.ok ? base.stocks.rows : [];
    const stockOfferBySku = indexOzonOfferIdsBySku(stockRows);
    const salesByOffer = new Map<string, { orders: number; revenue: number }>();
    let unmatchedOrders = 0;
    for (const item of base.analytics) {
      const offerId = resolveOzonOfferId(item.sku, base.images.skuToOffer, stockOfferBySku);
      if (!offerId) {
        unmatchedOrders += item.ordered_units;
        continue;
      }
      const entry = salesByOffer.get(offerId) ?? { orders: 0, revenue: 0 };
      entry.orders += item.ordered_units;
      entry.revenue += item.revenue;
      salesByOffer.set(offerId, entry);
    }
    if (unmatchedOrders > 0) {
      identityWarnings.push(`${base.cabinetName}: ${r0(unmatchedOrders)} заказов не сопоставлены с остатками`);
    }
    const stockByOffer = new Map<string, { name: string; free: number; reserved: number; warehouses: Record<string, number> }>();
    for (const stock of stockRows) {
      const entry = stockByOffer.get(stock.article) ?? { name: stock.name, free: 0, reserved: 0, warehouses: {} };
      entry.free += stock.free;
      entry.reserved += stock.reserved;
      entry.warehouses[stock.warehouse] = (entry.warehouses[stock.warehouse] ?? 0) + stock.free;
      stockByOffer.set(stock.article, entry);
    }
    for (const [offerId, stockValue] of stockByOffer) {
      const sales = salesByOffer.get(offerId) ?? { orders: 0, revenue: 0 };
      const dailySales = sales.orders / days;
      const daysCover = dailySales > 0 ? stockValue.free / dailySales : null;
      const status = stockValue.free <= 0 && sales.orders > 0
        ? "out"
        : daysCover !== null && daysCover <= 7
          ? "critical"
          : daysCover !== null && daysCover <= 14
            ? "warning"
            : daysCover !== null && daysCover >= 90
              ? "overstock"
              : "ok";
      rows.push({
        key: `${base.cabinetId}:${offerId}`,
        cabinetId: base.cabinetId,
        cabinet: base.cabinetName,
        offerId,
        name: stockValue.name || offerId,
        image: base.images.byOffer[offerId] ?? null,
        free: r0(stockValue.free),
        reserved: r0(stockValue.reserved),
        orders: r0(sales.orders),
        dailySales: r1(dailySales),
        daysCover: daysCover === null ? null : r1(daysCover),
        reorderQty: daysCover !== null && daysCover < 30 ? Math.max(0, r0(dailySales * 30 - stockValue.free)) : 0,
        status,
        warehouses: Object.entries(stockValue.warehouses)
          .map(([name, value]) => ({ name, value: r0(value) }))
          .sort((left, right) => right.value - left.value),
      });
    }
  }
  const totalFree = sum(rows.map((row) => Number(row.free ?? 0)));
  const totalReserved = sum(rows.map((row) => Number(row.reserved ?? 0)));
  return {
    view: "stocks",
    scope: publicScope(scope),
    period: { ...range, days },
    generatedAt: new Date().toISOString(),
    summary: {
      free: totalFree,
      reserved: totalReserved,
      sku: rows.length,
      critical: rows.filter((row) => row.status === "critical" || row.status === "out").length,
      overstock: rows.filter((row) => row.status === "overstock").length,
      reorderQty: sum(rows.map((row) => Number(row.reorderQty ?? 0))),
      // Пустая таблица имеет две разные причины: «товаров нет» и «Ozon не
      // ответил». Без этой пары экран советовал менять фильтр там, где менять
      // нечего.
      cabinetsWithStocks: bases.filter((base) => base.stocks.ok).length,
      cabinets: bases.length,
    },
    rows: rows.sort((left, right) => {
      const statusScores: Record<string, number> = { out: 0, critical: 1, warning: 2, ok: 3, overstock: 4 };
      const score = (status: unknown) => statusScores[String(status)] ?? 5;
      return score(left.status) - score(right.status) || Number(left.daysCover ?? 999_999) - Number(right.daysCover ?? 999_999);
    }),
    warnings: [...bases.flatMap((base) => base.warnings), ...identityWarnings],
  };
}

export async function loadAdverts(scope: OzonCabinetScope, current: OzonPeriod) {
  const days = current.days;
  const range = current;
  const [{ rows: cache, coverage: adCoverage }, costs] = await Promise.all([loadAdCache(scope, current), loadCosts()]);
  const rows: Record<string, unknown>[] = [];
  const warnings: string[] = [];
  const cabinetData = await Promise.all(scope.cabinets.map(async (cabinet) => {
    const [analytics, images, prices, stocks] = await Promise.all([
      ozonAnalytics(cabinet.creds, range.from, range.to),
      cachedOzonImages(cabinet.creds),
      cachedOzonPrices(cabinet.creds),
      cachedOzonStocks(cabinet.creds),
    ]);
    return { cabinet, analytics, images, prices, stocks };
  }));
  for (const { cabinet, analytics, images, prices, stocks } of cabinetData) {
    if (!cabinet.perf) warnings.push(`${cabinet.name}: Performance API не подключён`);
    if (!analytics.ok) warnings.push(`${cabinet.name}: ${analytics.error}`);
    if (!prices.ok) warnings.push(`${cabinet.name}: цены и комиссии — ${prices.error}`);
    if (!stocks.ok) warnings.push(`${cabinet.name}: остатки — ${stocks.error}`);
    const sales = new Map((analytics.ok ? analytics.rows : []).map((row) => [row.sku, row]));
    const pricesByOffer = new Map((prices.ok ? prices.rows : []).map((row) => [row.offer_id, row]));
    const stockByOffer = new Map<string, { free: number; name: string }>();
    if (stocks.ok) for (const stock of stocks.rows) {
      const entry = stockByOffer.get(stock.article) ?? { free: 0, name: stock.name };
      entry.free += stock.free;
      if (!entry.name && stock.name) entry.name = stock.name;
      stockByOffer.set(stock.article, entry);
    }
    const stockOfferBySku = indexOzonOfferIdsBySku(stocks.ok ? stocks.rows : []);
    for (const [key, ad] of cache) {
      if (!key.startsWith(`${cabinet.clientId}:`)) continue;
      const sku = key.slice(cabinet.clientId.length + 1);
      const sale = sales.get(sku);
      const offerId = resolveOzonOfferId(sku, images.skuToOffer, stockOfferBySku);
      const priceRow = pricesByOffer.get(offerId);
      const units = Number(sale?.ordered_units ?? 0);
      const actualPrice = units > 0 ? Number(sale?.revenue ?? 0) / units : Number(priceRow?.price ?? 0);
      const stockEntry = stockByOffer.get(offerId);
      const cost = costs.resolve({ offerId, names: [sale?.name, stockEntry?.name] })?.cost ?? 0;
      const stock = stockEntry ? stockEntry.free : null;
      const attributionCompatible = ad.ordersMoney <= Math.max(1, Number(sale?.revenue ?? 0)) * 1.2;
      const dataAgeHours = ad.updatedAt ? Math.max(0, (Date.now() - new Date(ad.updatedAt).getTime()) / 3_600_000) : null;
      const economics = calculateAdvertProfitGuardrail({
        price: actualPrice,
        cost: cost > 0 ? cost : null,
        revenue: Number(sale?.revenue ?? 0),
        spent: ad.spent,
        units,
        commissionPct: Number(priceRow?.commissionPct ?? 0),
        acquiringPct: actualPrice > 0 ? Number(priceRow?.acquiring ?? 0) / actualPrice * 100 : 0,
        extraPct: 0,
        taxPct: 7,
        logisticsPerUnit: Number(priceRow?.logistics ?? 0),
        feesComplete: Boolean(prices.ok && priceRow),
        stock,
        dailyUnits: units / days,
        attributionCompatible,
        dataAgeHours,
        // Рекламное окно Ozon пересобирается раз в сутки — данные суточной
        // давности здесь плановые, а не просроченные.
        dataCadenceHours: 24,
      });
      rows.push({
        key: `${cabinet.id}:${sku}`,
        cabinetId: cabinet.id,
        cabinet: cabinet.name,
        sku,
        offerId,
        name: sale?.name || stockEntry?.name || offerId || sku,
        image: images.bySku[sku] ?? null,
        spent: r0(ad.spent),
        adRevenue: r0(ad.ordersMoney),
        revenue: r0(sale?.revenue ?? 0),
        orders: r0(sale?.ordered_units ?? 0),
        drr: pct(ad.spent, sale?.revenue ?? 0),
        adDrr: pct(ad.spent, ad.ordersMoney),
        roas: ad.spent > 0 ? r1(ad.ordersMoney / ad.spent) : null,
        attributionCompatible,
        economics,
        updatedAt: ad.updatedAt,
      });
    }
  }
  const spent = sum(rows.map((row) => Number(row.spent ?? 0)));
  const adRevenue = sum(rows.map((row) => Number(row.adRevenue ?? 0)));
  const revenue = sum(rows.map((row) => Number(row.revenue ?? 0)));
  const knownProfitRows = rows.filter((row) => (row.economics as { profitAfterAds?: number | null } | undefined)?.profitAfterAds != null);
  const calculatedProfit = sum(knownProfitRows.map((row) => Number((row.economics as { profitAfterAds: number }).profitAfterAds)));
  const knownProfitRevenue = sum(knownProfitRows.map((row) => Number(row.revenue ?? 0)));
  const unavailableEconomics = rows.length - knownProfitRows.length;
  if (unavailableEconomics > 0) warnings.push(`Рекомендации недоступны для ${unavailableEconomics} SKU без полной себестоимости, комиссии или логистики.`);
  return {
    view: "adverts",
    scope: publicScope(scope),
    period: { ...range, days },
    generatedAt: new Date().toISOString(),
    summary: {
      spent: r0(spent),
      adRevenue: r0(adRevenue),
      revenue: r0(revenue),
      drr: pct(spent, revenue),
      adDrr: pct(spent, adRevenue),
      roas: spent > 0 ? r1(adRevenue / spent) : null,
      calculatedProfit: knownProfitRows.length ? r0(calculatedProfit) : null,
      profitCoveragePct: revenue > 0
        ? r1(knownProfitRevenue / revenue * 100)
        : (rows.length ? r1(knownProfitRows.length / rows.length * 100) : 0),
      recommendations: rows.filter((row) => ["increase", "decrease", "pause"].includes(String((row.economics as { action?: string } | undefined)?.action))).length,
      sku: rows.length,
    },
    rows: rows.sort((left, right) => Number(right.spent ?? 0) - Number(left.spent ?? 0)),
    adCoverage,
    warnings,
  };
}

export async function loadOrders(scope: OzonCabinetScope, current: OzonPeriod) {
  const days = current.days;
  const range = current;
  const fromIso = `${range.from}T00:00:00.000Z`;
  const toIso = `${range.to}T23:59:59.999Z`;
  const rows: Record<string, unknown>[] = [];
  const totals = emptyTotals();
  const warnings: string[] = [];
  await Promise.all(scope.cabinets.map(async (cabinet) => {
    const [postings, finance] = await Promise.all([
      ozonPostings(cabinet.creds, fromIso, toIso),
      ozonTransactionTotals(cabinet.creds, fromIso, toIso),
    ]);
    warnings.push(...postings.errors.map((error) => `${cabinet.name}: ${error}`));
    if (finance.ok) addTotals(totals, finance.totals);
    else warnings.push(`${cabinet.name}: ${finance.error}`);
    for (const posting of postings.postings) {
      const state = describeOzonPostingStatus(posting.status);
      rows.push({
        key: `${cabinet.id}:${posting.scheme}:${posting.postingNumber}`,
        cabinetId: cabinet.id,
        cabinet: cabinet.name,
        ...posting,
        amount: r0(posting.amount),
        statusLabel: state.label,
        stage: state.stage,
        cancelled: state.cancelled,
        delivered: state.delivered,
        awaitingShipment: state.awaitingShipment,
        delayed: isOzonPostingDelayed(state, posting.shipmentDate),
      });
    }
  }));
  const financial = financeSummary(totals);
  return {
    view: "orders",
    scope: publicScope(scope),
    period: { ...range, days },
    generatedAt: new Date().toISOString(),
    summary: {
      postings: rows.length,
      units: sum(rows.map((row) => Number(row.units ?? 0))),
      amount: r0(sum(rows.map((row) => Number(row.amount ?? 0)))),
      active: rows.filter((row) => !row.cancelled && !row.delivered).length,
      delivered: rows.filter((row) => row.delivered).length,
      cancelled: rows.filter((row) => row.cancelled).length,
      delayed: rows.filter((row) => row.delayed).length,
      // Отдельно от «в работе»: это то, что менеджер обязан собрать и отгрузить
      // сам, и именно эти отправления горят по срокам.
      awaitingShipment: rows.filter((row) => row.awaitingShipment).length,
      refunds: financial.refunds,
    },
    rows: rows.sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""))),
    warnings,
  };
}

export async function loadEconomy(scope: OzonCabinetScope, current: OzonPeriod, taxPct: number) {
  const days = current.days;
  const range = current;
  const { rows: cache, coverage: adCoverage } = await loadAdCache(scope, current);
  const costs = await loadCosts();
  // Налог и комиссия посредника задаются вручную на кабинет: у каждой компании
  // свой режим, а посредник есть не везде. Кабинет без настройки считается по
  // ставке экрана — прежнее поведение.
  const db = getSupabaseAdmin();
  const unitSettings = db
    ? await loadCabinetUnitSettings(db, scope.cabinets.map((cabinet) => cabinet.id)).catch(() => new Map<string, CabinetUnitSettings>())
    : new Map<string, CabinetUnitSettings>();
  const rows: Array<Record<string, unknown> & {
    units: number;
    revenue: number;
    profit: number | null;
    margin: number | null;
    reliability: "estimated" | "missing_cost";
  }> = [];
  const totals = emptyTotals();
  const serviceTotals: Record<string, number> = {};
  const warnings: string[] = [];
  // Расход кабинета целиком берём тем же способом, что и «Обзор», — суточной
  // сводкой Performance. Она живая и дешёвая, поэтому карточка «Реклама» на
  // обоих экранах показывает одно число. Разнесение по товарам приходит из
  // кэша отчётов и бывает неполным — эту разницу больше не теряем.
  let adCabinetTotal = 0;
  let adAllocated = 0;
  await Promise.all(scope.cabinets.map(async (cabinet) => {
    const [prices, analytics, images, finance, services, stocks, buyerDiscount, dailySpend] = await Promise.all([
      cachedOzonPrices(cabinet.creds),
      ozonAnalytics(cabinet.creds, range.from, range.to),
      cachedOzonImages(cabinet.creds),
      ozonTransactionTotals(cabinet.creds, `${range.from}T00:00:00.000Z`, `${range.to}T23:59:59.999Z`),
      ozonServiceBreakdown(cabinet.creds, `${range.from}T00:00:00.000Z`, `${range.to}T23:59:59.999Z`),
      cachedOzonStocks(cabinet.creds),
      loadOzonBuyerDiscount(cabinet.creds),
      cabinet.perf ? perfDailySpend(cabinet.perf, range.from, range.to) : Promise.resolve(null),
    ]);
    if (dailySpend) {
      for (const [day, value] of Object.entries(dailySpend.byDate)) {
        if (day >= range.from && day <= range.to) adCabinetTotal += value.spent;
      }
    }
    if (!prices.ok) warnings.push(`${cabinet.name}: ${prices.error}`);
    if (!analytics.ok) warnings.push(`${cabinet.name}: ${analytics.error}`);
    if (!stocks.ok) warnings.push(`${cabinet.name}: остатки — ${stocks.error}`);
    if (finance.ok) addTotals(totals, finance.totals);
    else warnings.push(`${cabinet.name}: ${finance.error}`);
    for (const [name, value] of Object.entries(services)) serviceTotals[name] = (serviceTotals[name] ?? 0) + value;

    const stockNameByOffer = new Map<string, string>();
    if (stocks.ok) for (const stock of stocks.rows) {
      if (stock.article && stock.name && !stockNameByOffer.has(stock.article)) stockNameByOffer.set(stock.article, stock.name);
    }
    const stockOfferBySku = indexOzonOfferIdsBySku(stocks.ok ? stocks.rows : []);

    const salesByOffer = new Map<string, { units: number; revenue: number; name: string }>();
    if (analytics.ok) for (const sale of analytics.rows) {
      const offerId = resolveOzonOfferId(sale.sku, images.skuToOffer, stockOfferBySku);
      const entry = salesByOffer.get(offerId) ?? { units: 0, revenue: 0, name: sale.name };
      entry.units += sale.ordered_units;
      entry.revenue += sale.revenue;
      if (!entry.name && sale.name) entry.name = sale.name;
      salesByOffer.set(offerId, entry);
    }
    const adsByOffer = new Map<string, number>();
    for (const [key, ad] of cache) {
      if (!key.startsWith(`${cabinet.clientId}:`)) continue;
      const sku = key.slice(cabinet.clientId.length + 1);
      // Сопоставляем так же, как экран «Реклама»: по карточкам И по остаткам.
      // По одним карточкам часть SKU не находилась, и строка молча
      // выбрасывалась — в себестоимость не попадало 99% расхода: 1 652 ₽
      // вместо 142 262 ₽ по кабинету, при том что «Реклама» читает тот же кэш.
      const offerId = resolveOzonOfferId(sku, images.skuToOffer, stockOfferBySku);
      if (offerId) adsByOffer.set(offerId, (adsByOffer.get(offerId) ?? 0) + ad.spent);
    }
    if (prices.ok) for (const priceRow of prices.rows) {
      const offerId = priceRow.offer_id;
      const sales = salesByOffer.get(offerId) ?? { units: 0, revenue: 0, name: "" };
      const stockName = stockNameByOffer.get(offerId) ?? "";
      const productName = sales.name || stockName || offerId;
      const salePrice = sales.units > 0 ? sales.revenue / sales.units : priceRow.price;
      const costMatch = costs.resolve({ offerId, names: [sales.name, stockName] });
      const cost = costMatch?.cost ?? 0;
      const commission = salePrice * priceRow.commissionPct / 100;
      const logistics = priceRow.logistics;
      const acquiring = priceRow.acquiring;
      // Расход на единицу считается только при продажах. Расход товара, который
      // за период ничего не продал, в строку не помещается — но и пропасть не
      // должен: он уходит в «нераспределённый» и виден в сводке.
      const offerAdSpend = adsByOffer.get(offerId) ?? 0;
      const adPerUnit = sales.units > 0 ? offerAdSpend / sales.units : 0;
      if (sales.units > 0) adAllocated += offerAdSpend;
      // Налог — с цены покупателя: Ozon добивает часть цены за него, и с этой доли
      // налога нет. Комиссия и логистика остаются на цене продавца — их считает Ozon.
      const discountShare = buyerDiscountForOffer(buyerDiscount, offerId);
      const buyerPrice = taxableOzonPrice(salePrice, discountShare);
      const cabinetSettings = unitSettings.get(cabinet.id);
      const cabinetTaxPct = cabinetSettings?.taxPct ?? taxPct;
      const extraCommissionPct = cabinetSettings?.extraCommissionPct ?? 0;
      const extraCommission = salePrice * extraCommissionPct / 100;
      const tax = buyerPrice * cabinetTaxPct / 100;
      const economy = calculateOzonEconomyUnit({
        price: salePrice,
        cost,
        commission: commission + extraCommission,
        logistics,
        acquiring,
        ad: adPerUnit,
        tax,
      });
      rows.push({
        key: `${cabinet.id}:${offerId}`,
        cabinetId: cabinet.id,
        cabinet: cabinet.name,
        offerId,
        name: productName,
        image: images.byOffer[offerId] ?? null,
        units: r0(sales.units),
        revenue: r0(sales.revenue),
        price: r0(salePrice),
        cost: r0(cost),
        commissionPct: r1(priceRow.commissionPct),
        commission: r0(commission),
        logistics: r0(logistics),
        acquiring: r0(acquiring),
        extraCommission: extraCommissionPct > 0 ? r0(extraCommission) : null,
        // База налога: сколько заплатил покупатель после скидки Ozon. null —
        // отчёт о реализации по этому товару фактов не дал.
        buyerPrice: discountShare == null ? null : r0(buyerPrice),
        ozonDiscountPct: discountShare == null ? null : r1(discountShare * 100),
        taxPct: r1(cabinetTaxPct),
        ad: r0(adPerUnit),
        drr: pct(adPerUnit, salePrice),
        tax: r0(tax),
        profit: economy.profit === null ? null : r0(economy.profit),
        margin: economy.margin === null ? null : r1(economy.margin),
        reliability: economy.reliability,
      });
    }
  }));
  const financial = financeSummary(totals);
  const quality = summarizeOzonEconomy(rows);
  if (quality.missingCost > 0) {
    warnings.push(`Расчётная прибыль исключает ${quality.missingCost} SKU без себестоимости.`);
  }
  // Панель настроек работает по одному кабинету: у разных компаний ставки разные,
  // и показать их одной строкой на группу значило бы соврать про обе.
  const singleCabinet = scope.cabinets.length === 1 ? scope.cabinets[0] : null;
  const singleSettings = singleCabinet ? unitSettings.get(singleCabinet.id) : null;
  return {
    view: "economy",
    scope: publicScope(scope),
    period: { ...range, days },
    generatedAt: new Date().toISOString(),
    settings: singleCabinet
      ? {
        cabinetId: singleCabinet.id,
        taxPct: singleSettings?.taxPct ?? taxPct,
        // Экран ставку не передаёт: без настройки кабинета работает значение по
        // умолчанию, и подписывать его «введено на экране» было бы неправдой.
        taxSource: singleSettings?.taxPct != null ? "cabinet" as const : "default" as const,
        extraCommissionPct: singleSettings?.extraCommissionPct ?? 0,
        extraCommissionSource: singleSettings?.extraCommissionPct != null ? "cabinet" as const : "none" as const,
      }
      : null,
    taxPct,
    summary: {
      ...financial,
      ...quality,
      // Расход кабинета целиком — то же число, что на «Обзоре».
      adSpend: r0(adCabinetTotal),
      // Из него разнесено по проданным товарам: остальное осталось на
      // товарах без продаж за период или ещё не разложено по SKU.
      adAllocated: r0(Math.min(adAllocated, adCabinetTotal || adAllocated)),
      adUnallocated: r0(Math.max(0, (adCabinetTotal || adAllocated) - adAllocated)),
    },
    services: Object.entries(serviceTotals)
      .map(([name, value]) => ({ name, value: r0(Math.abs(value)) }))
      .filter((row) => row.value > 0)
      .sort((left, right) => right.value - left.value)
      .slice(0, 15),
    rows: rows.sort((left, right) => Number(left.margin ?? -999) - Number(right.margin ?? -999)),
    adCoverage,
    warnings,
    note: "Прибыль по SKU — расчётная и показывается только при известной себестоимости. Фактические возвраты, хранение и часть услуг Ozon вынесены на уровень кабинета.",
  };
}

export async function loadHealth(scope: OzonCabinetScope) {
  const db = getSupabaseAdmin();
  const to = new Date();
  const from = new Date(Date.now() - DAY);
  const cacheUpdated = new Map<string, string>();
  const syncCompleted = new Map<string, string>();
  if (db) {
    const [cacheResult, stateResult] = await Promise.all([
      db.from("ozon_ad_cache")
        .select("client_id, updated_at")
        .in("client_id", scope.cabinets.map((cabinet) => cabinet.clientId))
        .order("updated_at", { ascending: false }),
      db.from("wb_sync_state")
        .select("cabinet_id, status, state")
        .in("cabinet_id", scope.cabinets.map((cabinet) => cabinet.id))
        .eq("job", "ozon-adverts"),
    ]);
    for (const row of cacheResult.data ?? []) {
      if (!cacheUpdated.has(String(row.client_id))) cacheUpdated.set(String(row.client_id), String(row.updated_at));
    }
    for (const row of stateResult.data ?? []) {
      const state = row.state as Record<string, unknown> | null;
      if (row.status === "caught_up" && typeof state?.lastSyncedAt === "string") {
        syncCompleted.set(String(row.cabinet_id), state.lastSyncedAt);
      }
    }
  }
  const cabinets = await Promise.all(scope.cabinets.map(async (cabinet) => {
    const [seller, performance] = await Promise.all([
      ozonTransactionTotals(cabinet.creds, from.toISOString(), to.toISOString()),
      cabinet.perf ? getPerfToken(cabinet.perf) : Promise.resolve(null),
    ]);
    // Полный отчёт без рекламных строк — валидный нулевой результат. В таком
    // случае таблицу обновлять нечем, поэтому свежесть берём из caught_up state.
    const candidates = [cacheUpdated.get(cabinet.clientId), syncCompleted.get(cabinet.id)].filter(Boolean) as string[];
    const adUpdatedAt = candidates.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
    const adAgeHours = adUpdatedAt ? r1((Date.now() - new Date(adUpdatedAt).getTime()) / 3_600_000) : null;
    const issues: string[] = [];
    if (!seller.ok) issues.push(seller.error);
    if (!cabinet.perf) issues.push("Performance API не подключён");
    else if (!performance) issues.push("Performance API не отвечает");
    const adCacheStatus = ozonAdCacheStatus(Boolean(cabinet.perf), adAgeHours);
    if (cabinet.perf && adAgeHours === null) issues.push("Рекламный кэш ещё не создан");
    else if (adCacheStatus !== "ok" && adAgeHours !== null) issues.push(`Реклама не обновлялась ${adAgeHours} ч.`);
    const status: OzonQualityStatus = !seller.ok
      || (cabinet.perf && !performance)
      || adCacheStatus === "error"
      ? "error"
      : issues.length
        ? "warning"
        : "ok";
    return {
      id: cabinet.id,
      name: cabinet.name,
      clientId: cabinet.clientId,
      sellerApi: seller.ok,
      performanceConfigured: Boolean(cabinet.perf),
      performanceApi: Boolean(performance),
      adUpdatedAt,
      adAgeHours,
      adCacheStatus,
      status,
      issues,
    };
  }));
  let latestSync: Record<string, unknown> | null = null;
  if (db) {
    const { data } = await db
      .from("sync_log")
      .select("status, rows_affected, error, started_at")
      .eq("job", "ozon-adverts")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    latestSync = data as Record<string, unknown> | null;
  }
  const health = summarizeOzonHealth(cabinets.map((cabinet) => cabinet.status), latestSync);
  if (latestSync && health.sync === "warning" && isOzonPerformanceReportDeferredMessage(latestSync.error)) {
    latestSync = {
      ...latestSync,
      error: "Ozon Performance готовит рекламный отчёт или временно ограничил частоту запросов. Повторим автоматически; это не ошибка токена или кабинета.",
    };
  }
  return {
    view: "health",
    scope: publicScope(scope),
    generatedAt: new Date().toISOString(),
    summary: {
      total: cabinets.length,
      ...health,
      performance: cabinets.filter((cabinet) => cabinet.performanceApi).length,
    },
    cabinets,
    latestSync,
  };
}

export async function loadOzonCockpit(
  view: OzonCockpitView,
  scope: OzonCabinetScope,
  period: OzonPeriod,
  taxPct: number,
) {
  if (view === "overview") return loadOverview(scope, period);
  if (view === "sales") return loadSales(scope, period);
  if (view === "adverts") return loadAdverts(scope, period);
  if (view === "stocks") return loadStocks(scope, period);
  if (view === "orders") return loadOrders(scope, period);
  if (view === "economy") return loadEconomy(scope, period, taxPct);
  return loadHealth(scope);
}
