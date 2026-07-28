import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { supabase } from "@/lib/supabase";
import { calculateWeatherImpacts, type SeasonalProductRule } from "@/lib/opiu/weatherImpact";
import { fetchOrders, fetchSalesFromCache } from "@/lib/opiu/loadMonth";
import { loadPlanningState } from "@/lib/planning/stateStore";
import { calculateSalesPlanDaily, inferModelArticle, type SalesPlanDocument } from "@/lib/planning/salesPlan";
import { loadRnpDailySkuRows, loadRnpReportRows, type RnpDailySkuRow, type RnpReportRow } from "@/lib/rnp/rpcLoaders";
import { getWbCommissionForCabinet, resolveWbRatesForNm } from "@/lib/wb/commissions";
import type { SupabaseClient } from "@supabase/supabase-js";

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export interface ArticlePayoutForecast {
  article: string;
  originalPlanRevenue: number;
  planRevenue: number;
  historicalRevenue: number;
  historicalPayout: number;
  payoutRate: number | null;
  forecastPayout: number | null;
  actualRevenue: number;
  actualOrders: number;
  actualBuyouts: number;
  planUnitPrice: number | null;
  actualUnitPrice: number | null;
  usedUnitPrice: number | null;
  projectedRevenue: number;
  adaptiveRevenue: number;
  plannedOrders: number;
  plannedBuyouts: number;
  marketplaceExpenses: number;
  cogs: number;
  advertising: number;
  tax: number;
  plannedProfit: number | null;
  unitEconomicsReady: boolean;
  unitEconomicsMissingReasons: string[];
}

export interface PayoutRules {
  mode: "standard" | "daily_request" | "wb_bank_auto";
  withdrawalWaitDays: number;
  withdrawalIntervalDays: number;
  bankTransferDays: number;
  effectiveFrom: string;
}

interface ForecastPlanRow {
  article: string;
  plan_revenue: number;
  plan_orders: number;
  plan_buyouts: number;
  plan_ads: number;
  nm_id: number | null;
  daily_revenue: number[];
}

const clampDays = (value: unknown, fallback: number) => Math.min(90, Math.max(0, Math.round(num(value) || fallback)));

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addBusinessDays(date: Date, days: number) {
  const result = new Date(date);
  let remaining = Math.max(0, Math.round(days));
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const weekday = result.getDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return result;
}

function payoutReceiptDate(saleDate: Date, rules: PayoutRules) {
  if (rules.mode === "wb_bank_auto") return addDays(saleDate, 1);
  if (rules.mode === "daily_request") return addBusinessDays(saleDate, rules.bankTransferDays);
  const daysUntilSunday = (7 - saleDate.getDay()) % 7;
  const reportDate = addDays(saleDate, daysUntilSunday + 1);
  const availableForWithdrawal = addDays(reportDate, rules.withdrawalWaitDays);
  return addBusinessDays(availableForWithdrawal, rules.bankTransferDays);
}

function payoutAvailableDate(saleDate: Date, rules: PayoutRules) {
  if (rules.mode === "wb_bank_auto" || rules.mode === "daily_request") return saleDate;
  const daysUntilSunday = (7 - saleDate.getDay()) % 7;
  const reportDate = addDays(saleDate, daysUntilSunday + 1);
  return addDays(reportDate, rules.withdrawalWaitDays);
}

function planFromDocument(document: SalesPlanDocument, monthKey: string): ForecastPlanRow[] {
  return document.rows.map((row) => {
    const daily = row.months[monthKey] ?? [];
    const metrics = daily.map((orders) => calculateSalesPlanDaily(row, orders));
    return {
      article: String(row.variant || row.model || inferModelArticle(row.variant)).trim().toUpperCase(),
      plan_revenue: metrics.reduce((sum, item) => sum + item.revenue, 0),
      plan_orders: metrics.reduce((sum, item) => sum + item.orders, 0),
      plan_buyouts: metrics.reduce((sum, item) => sum + item.buyouts, 0),
      plan_ads: metrics.reduce((sum, item) => sum + item.ads, 0),
      nm_id: /^\d+$/.test(String(row.externalId)) ? Number(row.externalId) : null,
      daily_revenue: metrics.map((item) => item.revenue),
    };
  }).filter((row) => row.article && row.plan_revenue > 0);
}

function documentHasMonth(document: SalesPlanDocument | undefined, monthKey: string) {
  return Boolean(document?.rows.some((row) => (row.months[monthKey] ?? []).some((orders) => num(orders) > 0)));
}

function estimateOrderToSaleLag(rows: RnpDailySkuRow[], fallback = 8) {
  const daily = new Map<string, { orders: number; sales: number }>();
  for (const row of rows) {
    const current = daily.get(row.d) ?? { orders: 0, sales: 0 };
    current.orders += num(row.orders_count);
    current.sales += num(row.buyouts_count);
    daily.set(row.d, current);
  }
  const dates = [...daily.keys()].sort();
  let best = { lag: fallback, score: -1, samples: 0 };
  for (let lag = 1; lag <= 21; lag++) {
    const pairs = dates.map((date) => {
      const saleDate = new Date(`${date}T12:00:00`);
      saleDate.setDate(saleDate.getDate() + lag);
      return [daily.get(date)?.orders ?? 0, daily.get(isoDate(saleDate))?.sales ?? 0] as const;
    }).filter(([orders, sales]) => orders > 0 || sales > 0);
    if (pairs.length < 14) continue;
    const orderMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
    const saleMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
    let covariance = 0;
    let orderVariance = 0;
    let saleVariance = 0;
    for (const [orders, sales] of pairs) {
      covariance += (orders - orderMean) * (sales - saleMean);
      orderVariance += (orders - orderMean) ** 2;
      saleVariance += (sales - saleMean) ** 2;
    }
    const score = orderVariance > 0 && saleVariance > 0 ? covariance / Math.sqrt(orderVariance * saleVariance) : -1;
    if (score > best.score) best = { lag, score, samples: pairs.length };
  }
  return best.score >= 0.2 ? { ...best, source: "history" as const } : { lag: fallback, score: best.score, samples: best.samples, source: "fallback" as const };
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function loadForecastPlan(client: SupabaseClient, year: number, month: number, cabinetId?: string | null) {
  const { data: legacyRows, error } = await client.from("sales_plan").select("*").eq("year", year).eq("month", month);
  if (error && error.code !== "42P01") throw new Error(error.message);
  if ((legacyRows ?? []).length) {
    return {
      source: "sales_plan" as const,
      rows: (legacyRows ?? []).map((row) => ({
        article: String(row.article ?? "").trim().toUpperCase(),
        plan_revenue: num(row.plan_revenue),
        plan_orders: num(row.plan_orders ?? row.orders),
        plan_buyouts: num(row.plan_buyouts ?? row.buyouts),
        plan_ads: num(row.plan_ads ?? row.ads),
        nm_id: num(row.nm_id) || null,
        daily_revenue: [],
      })) as ForecastPlanRow[],
    };
  }
  const snapshot = await loadPlanningState<{ sales_plan_v1?: { wb?: Record<string, unknown> } }>(client, year);
  const monthKey = String(month).padStart(2, "0");
  const rows: ForecastPlanRow[] = [];
  let includesWorkingPlan = false;
  for (const [storedCabinetId, value] of Object.entries(snapshot.data.sales_plan_v1?.wb ?? {})) {
    if (cabinetId && storedCabinetId !== cabinetId) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const envelope = value as { approvedByMonth?: Record<string, SalesPlanDocument>; approved?: SalesPlanDocument; working?: SalesPlanDocument };
    const approved = envelope.approvedByMonth?.[monthKey]
      ?? (documentHasMonth(envelope.approved, monthKey) ? envelope.approved : undefined);
    const document = approved ?? (documentHasMonth(envelope.working, monthKey) ? envelope.working : undefined);
    if (!approved && document) includesWorkingPlan = true;
    if (document?.year === year) rows.push(...planFromDocument(document, monthKey));
  }
  return { source: includesWorkingPlan ? "working_sales_plan" as const : "approved_sales_plan" as const, rows };
}

export async function buildMarketplacePayoutForecast(
  year: number,
  month: number,
  options: { forceRecalculate?: boolean; payoutRules?: Partial<PayoutRules>; orderToSaleLagDays?: number; cabinetId?: string } = {},
) {
  const client = getSupabaseAdmin() ?? supabase;
  const dataWarnings: string[] = [];
  const safeLoad = async <T>(label: string, promise: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await promise;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      dataWarnings.push(`${label}: ${reason}`);
      return fallback;
    }
  };
  const targetStart = new Date(year, month - 1, 1);
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const payoutRules: PayoutRules = {
    mode: options.payoutRules?.mode ?? "standard",
    withdrawalWaitDays: clampDays(options.payoutRules?.withdrawalWaitDays, 14),
    withdrawalIntervalDays: 7,
    bankTransferDays: clampDays(options.payoutRules?.bankTransferDays, 7),
    effectiveFrom: options.payoutRules?.effectiveFrom || iso(targetStart),
  };
  const { data: cabinetRows } = await client.from("wb_cabinets").select("id,name").eq("marketplace", "wb").eq("is_active", true).order("created_at", { ascending: true });
  const cabinets = (cabinetRows ?? []).map((cabinet) => ({ id: String(cabinet.id), name: String(cabinet.name || "Wildberries") }));
  const selectedCabinetId = options.cabinetId && cabinets.some((cabinet) => cabinet.id === options.cabinetId)
    ? options.cabinetId
    : cabinets[0]?.id;
  const plan = await loadForecastPlan(client, year, month, selectedCabinetId);
  const planRows = plan.rows;
  let availablePlanPeriods: Array<{ year: number; month: number }> = [];
  if (!planRows.length) {
    const { data: availableRows } = await client
      .from("sales_plan")
      .select("year,month")
      .order("year", { ascending: false })
      .order("month", { ascending: false })
      .limit(36);
    availablePlanPeriods = [...new Map((availableRows ?? []).map((row) => [
      `${row.year}-${row.month}`,
      { year: Number(row.year), month: Number(row.month) },
    ])).values()];
  }

  const historyEnd = new Date(targetStart);
  historyEnd.setDate(historyEnd.getDate() - 1);
  const historyStart = new Date(historyEnd);
  historyStart.setDate(historyStart.getDate() - 83);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetEnd = new Date(year, month, 0);
  const hasStarted = targetStart <= today;
  const isCurrentMonth = targetStart.getFullYear() === today.getFullYear()
    && targetStart.getMonth() === today.getMonth();
  const actualEnd = targetEnd < today ? targetEnd : today;
  const orderRegionFrom = new Date(historyEnd);
  orderRegionFrom.setDate(orderRegionFrom.getDate() - 27);
  const legacyHistory = selectedCabinetId
    ? []
    : await safeLoad("История продаж WB временно недоступна", fetchSalesFromCache(iso(historyStart), iso(historyEnd)), []);
  void legacyHistory;
  const [recentOrders, unitRows, dailyRnpRows, commissionRates] = await Promise.all([
    safeLoad("Регионы заказов WB временно недоступны", fetchOrders(iso(orderRegionFrom), iso(historyEnd), false), []),
    safeLoad("Юнит-экономика временно недоступна", loadRnpReportRows<RnpReportRow>(client, selectedCabinetId ?? null, { label: "Прогноз поступлений: юнит-экономика" }), []),
    safeLoad("История заказов и продаж РНП временно недоступна", loadRnpDailySkuRows<RnpDailySkuRow>(client, { from: iso(historyStart), to: iso(actualEnd), cabinetId: selectedCabinetId ?? null, label: "Прогноз поступлений: срок до продажи" }), []),
    selectedCabinetId
      ? safeLoad("Ставки удержаний WB временно недоступны", getWbCommissionForCabinet(selectedCabinetId, 30, { allowLiveFallback: false }), null)
      : Promise.resolve(null),
  ]);
  const estimatedOrderToSaleLag = estimateOrderToSaleLag(dailyRnpRows, 8);
  const manualLag = Number(options.orderToSaleLagDays);
  const orderToSaleLag = Number.isFinite(manualLag) && manualLag >= 0 && manualLag <= 45
    ? { lag: Math.round(manualLag), score: estimatedOrderToSaleLag.score, samples: estimatedOrderToSaleLag.samples, source: "manual" as const }
    : estimatedOrderToSaleLag;
  const daysInMonth = targetEnd.getDate();
  const elapsedDays = hasStarted ? Math.max(1, actualEnd.getDate()) : 0;
  const { data: seasonalRows } = await client
    .from("finance_seasonal_products")
    .select("article,weather_mode,threshold,impact_percent_per_unit,max_adjustment_percent")
    .eq("is_active", true);
  const regionCounts = new Map<string, Map<string, number>>();
  for (const order of recentOrders) {
    if (order.isCancel) continue;
    const article = String(order.supplierArticle ?? "").trim().toUpperCase();
    const region = String(order.oblast ?? order.regionName ?? "").trim();
    if (!article || !region) continue;
    const byRegion = regionCounts.get(article) ?? new Map<string, number>();
    byRegion.set(region, (byRegion.get(region) ?? 0) + 1);
    regionCounts.set(article, byRegion);
  }
  const orderRegions = [...regionCounts.entries()].flatMap(([article, byRegion]) => {
    const total = [...byRegion.values()].reduce((sum, count) => sum + count, 0);
    return [...byRegion.entries()].map(([region, count]) => ({ article, region, share: count / total }));
  });
  const weatherImpacts = await calculateWeatherImpacts((seasonalRows ?? []) as SeasonalProductRule[], orderRegions);
  const unitByArticle = new Map(unitRows.map((row) => [String(row.article ?? "").trim().toUpperCase(), row]));
  const unitByNmId = new Map(unitRows.map((row) => [Number(row.nm_id), row]));

  let items = planRows.map((row) => {
    const article = String(row.article).trim().toUpperCase();
    const originalPlanRevenue = num(row.plan_revenue);
    const unit = (row.nm_id ? unitByNmId.get(row.nm_id) : undefined) ?? unitByArticle.get(article);
    const actualRevenue = isCurrentMonth ? num(unit?.buyouts_sum_month) : 0;
    const actualOrders = isCurrentMonth ? num(unit?.orders_month) : 0;
    const actualBuyouts = isCurrentMonth ? num(unit?.buyouts_month) : 0;
    const planUnitPrice = num(row.plan_buyouts) > 0 ? originalPlanRevenue / num(row.plan_buyouts) : null;
    const actualUnitPrice = actualBuyouts > 0 && actualRevenue > 0 ? actualRevenue / actualBuyouts : null;
    const usedUnitPrice = actualUnitPrice ?? planUnitPrice;
    const planRevenue = planUnitPrice && actualUnitPrice ? originalPlanRevenue * actualUnitPrice / planUnitPrice : originalPlanRevenue;
    const projectedRevenue = elapsedDays ? actualRevenue / elapsedDays * daysInMonth : planRevenue;
    const progressWeight = elapsedDays ? Math.min(0.85, Math.max(0.25, elapsedDays / daysInMonth)) : 0;
    const adaptiveRevenue = hasStarted
      ? planRevenue * (1 - progressWeight) + projectedRevenue * progressWeight
      : planRevenue;
    const weather = weatherImpacts.get(article);
    const weatherAdjustedRevenue = adaptiveRevenue * (1 + (weather?.adjustmentPercent ?? 0) / 100);
    const nmId = row.nm_id ?? (num(unit?.nm_id) || null);
    const rates = commissionRates ? resolveWbRatesForNm(commissionRates, nmId ?? 0) : null;
    const unitCashRate = rates?.factual
      ? Math.min(1, Math.max(0, 1 - (rates.marketplacePct + rates.acquiringPct) / 100))
      : null;
    const scale = planRevenue > 0 ? weatherAdjustedRevenue / planRevenue : 0;
    const plannedBuyouts = num(row.plan_buyouts) * scale;
    const costPerUnit = num(unit?.cost);
    const cogs = plannedBuyouts * costPerUnit;
    const advertising = num(row.plan_ads) * scale;
    const marketplaceExpenses = unitCashRate === null ? 0 : weatherAdjustedRevenue * (1 - unitCashRate);
    const tax = weatherAdjustedRevenue * 0.07;
    const unitEconomicsReady = unitCashRate !== null && costPerUnit > 0 && row.plan_buyouts > 0;
    const unitEconomicsMissingReasons = [
      !unit ? "артикул не сопоставлен с РНП" : null,
      costPerUnit <= 0 ? "нет себестоимости" : null,
      !rates?.factual ? "нет актуальных ставок комиссии и удержаний WB" : null,
      row.plan_buyouts <= 0 ? "в плане не рассчитан выкуп" : null,
      !nmId ? "нет nmID для сопоставления с тарифами" : null,
    ].filter((reason): reason is string => Boolean(reason));
    const plannedProfit = unitEconomicsReady
      ? weatherAdjustedRevenue - marketplaceExpenses - cogs - advertising - tax
      : null;
    return {
      article,
      originalPlanRevenue,
      planRevenue,
      historicalRevenue: 0,
      historicalPayout: 0,
      payoutRate: unitCashRate,
      forecastPayout: unitCashRate === null ? null : weatherAdjustedRevenue * unitCashRate,
      actualRevenue,
      actualOrders,
      actualBuyouts,
      planUnitPrice,
      actualUnitPrice,
      usedUnitPrice,
      projectedRevenue,
      adaptiveRevenue: weatherAdjustedRevenue,
      weatherAdjustmentPercent: weather?.adjustmentPercent ?? 0,
      weatherReason: weather?.reason ?? null,
      plannedOrders: num(row.plan_orders) * scale,
      plannedBuyouts,
      marketplaceExpenses,
      cogs,
      advertising,
      tax,
      plannedProfit,
      unitEconomicsReady,
      unitEconomicsMissingReasons,
    };
  });
  const preliminaryPlan = items.reduce((sum, item) => sum + item.planRevenue, 0);
  const preliminaryProjection = items.reduce((sum, item) => sum + item.projectedRevenue, 0);
  const currentDeviation = preliminaryPlan > 0 ? (preliminaryProjection - preliminaryPlan) / preliminaryPlan : 0;
  const dailyOrders = new Map<string, number>();
  for (const row of dailyRnpRows) dailyOrders.set(row.d, (dailyOrders.get(row.d) ?? 0) + num(row.orders_count));
  const completedDate = addDays(actualEnd < today ? actualEnd : today, actualEnd < today ? 0 : -1);
  const plannedOrderTotal = items.reduce((sum, item) => sum + item.plannedOrders, 0);
  const deviationChecks = [2, 1, 0].map((offset) => {
    const date = addDays(completedDate, -offset);
    const key = iso(date);
    let cumulative = 0;
    for (const [day, orders] of dailyOrders) if (day <= key && day.startsWith(`${year}-${String(month).padStart(2, "0")}`)) cumulative += orders;
    const projected = cumulative / Math.max(1, date.getDate()) * daysInMonth;
    return plannedOrderTotal > 0 ? projected / plannedOrderTotal - 1 : 0;
  });
  const direction = Math.sign(deviationChecks.at(-1) ?? currentDeviation);
  const stableDeviationDays = deviationChecks.every((value) => Math.abs(value) >= 0.1 && Math.sign(value) === direction) ? 3 : 0;
  const automaticAdjustmentApplied = !!options.forceRecalculate || stableDeviationDays >= 3;
  if (!automaticAdjustmentApplied) {
    items = items.map((item) => {
      const weatherMultiplier = 1 + item.weatherAdjustmentPercent / 100;
      const adaptiveRevenue = item.planRevenue * weatherMultiplier;
      return {
        ...item,
        adaptiveRevenue,
        forecastPayout: item.adaptiveRevenue > 0 && item.forecastPayout !== null
          ? adaptiveRevenue * (item.forecastPayout / item.adaptiveRevenue)
          : null,
      };
    });
  }

  const forecastPayout = items.reduce((sum, item) => sum + (item.forecastPayout ?? 0), 0);
  const actualPayout = 0;
  const remainingPayout = forecastPayout;
  const dailyWeights = Array.from({ length: daysInMonth }, (_, dayIndex) =>
    planRows.reduce((sum, row) => sum + num(row.daily_revenue[dayIndex]), 0));
  if (!dailyWeights.some((value) => value > 0)) dailyWeights.fill(1);
  const scheduleWeights = new Map<string, number>();
  const availableDates = new Map<string, string>();
  dailyWeights.forEach((weight, dayIndex) => {
    if (weight <= 0) return;
    const plannedOrderDate = new Date(year, month - 1, dayIndex + 1, 12);
    const expectedSaleDate = addDays(plannedOrderDate, orderToSaleLag.lag);
    const receiptDate = payoutReceiptDate(expectedSaleDate, payoutRules);
    if (receiptDate < today) return;
    const key = iso(receiptDate);
    scheduleWeights.set(key, (scheduleWeights.get(key) ?? 0) + weight);
    availableDates.set(key, iso(payoutAvailableDate(expectedSaleDate, payoutRules)));
  });
  if (!scheduleWeights.size && remainingPayout > 0) {
    scheduleWeights.set(iso(payoutReceiptDate(targetEnd, payoutRules)), 1);
  }
  const totalScheduleWeight = [...scheduleWeights.values()].reduce((sum, value) => sum + value, 0);
  const scheduleDates = [...scheduleWeights.keys()].sort();
  const payoutSchedule = scheduleDates.map((date, index) => {
    const amountBeforeRounding = totalScheduleWeight > 0
      ? remainingPayout * (scheduleWeights.get(date) ?? 0) / totalScheduleWeight
      : 0;
    const previous = scheduleDates.slice(0, index).reduce((sum, previousDate) => {
      return sum + Math.round(remainingPayout * (scheduleWeights.get(previousDate) ?? 0) / totalScheduleWeight);
    }, 0);
    return {
      date,
      availableDate: availableDates.get(date) ?? date,
      amount: index === scheduleDates.length - 1 ? Math.max(0, Math.round(remainingPayout - previous)) : Math.round(amountBeforeRounding),
    };
  });
  const result = {
    historyFrom: iso(historyStart),
    historyTo: iso(historyEnd),
    items,
    cabinetId: selectedCabinetId ?? "",
    cabinets,
    planRowsCount: (planRows ?? []).length,
    planSource: plan.source,
    payoutRules,
    dataWarnings,
    availablePlanPeriods,
    planRevenue: items.reduce((sum, item) => sum + item.planRevenue, 0),
    originalPlanRevenue: items.reduce((sum, item) => sum + item.originalPlanRevenue, 0),
    forecastPayout,
    articlesWithoutHistory: items.filter((item) => item.payoutRate === null).length,
    weatherWarnings: items.filter((item) => item.weatherAdjustmentPercent > 0).map((item) => ({
      article: item.article,
      adjustmentPercent: item.weatherAdjustmentPercent,
      reason: item.weatherReason,
    })),
    actualRevenue: items.reduce((sum, item) => sum + item.actualRevenue, 0),
    actualOrders: items.reduce((sum, item) => sum + item.actualOrders, 0),
    actualBuyouts: items.reduce((sum, item) => sum + item.actualBuyouts, 0),
    projectedRevenue: items.reduce((sum, item) => sum + item.projectedRevenue, 0),
    adaptiveRevenue: items.reduce((sum, item) => sum + item.adaptiveRevenue, 0),
    elapsedDays,
    daysInMonth,
    stableDeviationDays,
    automaticAdjustmentApplied,
    currentDeviation,
    actualPayout,
    remainingPayout,
    plannedOrders: items.reduce((sum, item) => sum + item.plannedOrders, 0),
    plannedBuyouts: items.reduce((sum, item) => sum + item.plannedBuyouts, 0),
    marketplaceExpenses: items.reduce((sum, item) => sum + item.marketplaceExpenses, 0),
    cogs: items.reduce((sum, item) => sum + item.cogs, 0),
    advertising: items.reduce((sum, item) => sum + item.advertising, 0),
    tax: items.reduce((sum, item) => sum + item.tax, 0),
    plannedProfit: items.reduce((sum, item) => sum + (item.plannedProfit ?? 0), 0),
    unitEconomicsMissing: new Set(items.filter((item) => !item.unitEconomicsReady).map((item) => item.article)).size,
    unitEconomicsMissingDetails: [...new Map(items.filter((item) => !item.unitEconomicsReady).map((item) => [item.article, { article: item.article, reasons: item.unitEconomicsMissingReasons }])).values()],
    orderToSaleLagDays: orderToSaleLag.lag,
    orderToSaleLagSource: orderToSaleLag.source,
    orderToSaleLagScore: orderToSaleLag.score,
    payoutSchedule,
  };
  return result;
}
