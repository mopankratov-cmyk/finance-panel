import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { calculateWeatherImpacts, type SeasonalProductRule } from "@/lib/opiu/weatherImpact";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { OPIU_WB_CABINET_ID } from "@/lib/opiu/constants";
import { fetchForecastReportRows } from "@/lib/opiu/reportRows";
import { loadPlanningState } from "@/lib/planning/stateStore";
import {
  deriveWbPlanForMonth,
  listWbPlanMonths,
  type WbPlanSource,
} from "@/lib/opiu/wbPlan";
import { classifyForecastArticleGaps, type ForecastGap } from "@/lib/opiu/forecastGaps";
import { deriveArticleBreakdown, sumBreakdowns } from "@/lib/opiu/unitEconomics";

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isSale = (value: unknown) => {
  const text = String(value ?? "").toLowerCase();
  return text.includes("продаж") || text.includes("sale");
};

function financeDb() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase service role не настроен");
  return db;
}

export interface ArticlePayoutForecast {
  article: string;
  planRevenue: number;
  historicalRevenue: number;
  historicalPayout: number;
  payoutRate: number | null;
  forecastPayout: number | null;
  actualRevenue: number;
  projectedRevenue: number;
  adaptiveRevenue: number;
}

export function deriveWbPayoutSummary(
  forecastPayout: number,
  reportAccruedPayout: number,
) {
  return {
    reportAccruedPayout,
    actualPayout: null,
    remainingPayout: Number.isFinite(forecastPayout) ? Math.max(0, forecastPayout) : 0,
  };
}

export function deriveWbLegacySnapshotPayout(
  summary: ReturnType<typeof deriveWbPayoutSummary>,
) {
  return {
    // Compatibility sentinel for the legacy NOT NULL column, not a confirmed bank fact.
    // The API source of truth remains summary.actualPayout === null.
    actual_payout: 0,
    remaining_payout: summary.remainingPayout,
  };
}

// Shift the decimal exponent before half-up rounding so values such as 1.005
// normalize to business cents without inheriting binary multiplication drift.
function normalizeRubToCents(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;

  const [coefficient, exponent = "0"] = value.toString().toLowerCase().split("e");
  const shifted = Number(`${coefficient}e${Number(exponent) + 2}`);
  const cents = Math.floor(shifted + 0.5);
  if (!Number.isFinite(cents) || !Number.isSafeInteger(cents)) {
    throw new RangeError("WB payout amount exceeds safe integer cents");
  }
  return cents;
}

export function allocateWbPayoutSchedule(remainingPayout: number, dates: string[]) {
  const totalCents = normalizeRubToCents(remainingPayout);
  const bucketCount = Math.min(dates.length, totalCents);
  if (bucketCount === 0) return [];

  const baseCents = Math.floor(totalCents / bucketCount);
  const remainder = totalCents % bucketCount;
  return dates.slice(0, bucketCount).map((date, index) => ({
    date,
    amount: (baseCents + (index < remainder ? 1 : 0)) / 100,
  }));
}

function aggregateByArticle(report: Awaited<ReturnType<typeof fetchForecastReportRows>>) {
  const result = new Map<string, { revenue: number; payout: number }>();
  for (const row of report) {
    const article = String(row.sa_name ?? "").trim().toUpperCase();
    if (!article) continue;
    const current = result.get(article) ?? { revenue: 0, payout: 0 };
    const saleRevenue = isSale(row.doc_type_name ?? row.supplier_oper_name)
      ? num(row.retail_amount) || num(row.retail_price_withdisc_rub) * Math.abs(num(row.quantity) || 1)
      : 0;
    current.revenue += saleRevenue;
    current.payout +=
      num(row.ppvz_for_pay) -
      num(row.delivery_rub) -
      num(row.rebill_logistic_cost) -
      num(row.storage_fee) -
      num(row.penalty) -
      num(row.deduction) +
      num(row.additional_payment) -
      num(row.acceptance) -
      num(row.acquiring_fee);
    result.set(article, current);
  }
  return result;
}

async function fetchForecastOrderRegions(
  dateFrom: string,
  dateTo: string,
  articles: string[],
  signal?: AbortSignal,
  cabinetId: string = OPIU_WB_CABINET_ID,
) {
  const client = financeDb();
  const candidates = [...new Set(articles.flatMap((value) => {
    const article = String(value ?? "").trim();
    return article ? [article, article.toUpperCase()] : [];
  }))];
  if (candidates.length === 0) return [];

  return loadAllSupabasePages<{
    supplier_article: string | null;
    region: string | null;
    is_cancel: boolean | null;
  }>(async (from, to) => {
    const query = client
      .from("wb_orders")
      .select("supplier_article,region,is_cancel")
      .eq("cabinet_id", cabinetId)
      .gte("date", dateFrom)
      .lte("date", `${dateTo}T23:59:59.999Z`)
      .in("supplier_article", candidates)
      .order("date", { ascending: true })
      .range(from, to);
    const result = signal ? await query.abortSignal(signal) : await query;
    return {
      data: result.data,
      error: result.error ? { message: result.error.message } : null,
    };
  }, {
    maxPages: 100,
    label: "Прогноз выплат WB: регионы сезонных товаров",
  });
}

// §6. Себестоимость из раздела «Затраты» (product_costs). Таблица ключуется по
// артикулу (без cabinet_id), поэтому сопоставляем по нормализованному артикулу.
// При ошибке чтения возвращаем available:false — тогда себестоимость помечается
// «не оценивалась», а не ложным «нет данных» (§19).
async function fetchArticleCosts(
  client: ReturnType<typeof financeDb>,
  signal?: AbortSignal,
): Promise<{ map: Map<string, number>; available: boolean }> {
  try {
    const rows = await loadAllSupabasePages<{ article: string | null; cost_rub: number | null }>(
      async (from, to) => {
        const query = client
          .from("product_costs")
          .select("article,cost_rub")
          .order("article", { ascending: true })
          .range(from, to);
        const result = signal ? await query.abortSignal(signal) : await query;
        return {
          data: result.data,
          error: result.error ? { message: result.error.message } : null,
        };
      },
      { maxPages: 200, label: "Прогноз выплат WB: себестоимость (product_costs)" },
    );
    const map = new Map<string, number>();
    for (const row of rows) {
      const article = String(row.article ?? "").trim().toUpperCase();
      const cost = Number(row.cost_rub);
      if (article && Number.isFinite(cost) && cost > 0) map.set(article, cost);
    }
    return { map, available: true };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { map: new Map(), available: false };
  }
}

export async function buildMarketplacePayoutForecast(
  year: number,
  month: number,
  options: {
    forceRecalculate?: boolean;
    signal?: AbortSignal;
    cabinetId?: string;
  } = {},
) {
  const client = financeDb();
  const cabinetId = options.cabinetId ?? OPIU_WB_CABINET_ID;
  // §2. План берём из planning_state → sales_plan_v1 → wb → cabinetId
  // (раздел «План»), а не из устаревшей пустой таблицы sales_plan.
  const monthKey = String(month).padStart(2, "0");
  const planningState = await loadPlanningState<{
    sales_plan_v1?: { wb?: Record<string, unknown> };
  }>(client, year, { signal: options.signal });
  const cabinetPlan = planningState.data.sales_plan_v1?.wb?.[cabinetId];
  const planSelection = deriveWbPlanForMonth(cabinetPlan, monthKey);
  const planSource: WbPlanSource = planSelection.source;
  const planMeta = new Map(planSelection.articles.map((item) => [item.article, item]));
  const planRows = planSelection.articles.map((item) => ({
    article: item.article,
    plan_revenue: item.planRevenue,
  }));
  const availablePlanPeriods: Array<{ year: number; month: number }> =
    planRows.length ? [] : listWbPlanMonths(cabinetPlan, year);

  const targetStart = new Date(year, month - 1, 1);
  const historyEnd = new Date(targetStart);
  historyEnd.setDate(historyEnd.getDate() - 1);
  const historyStart = new Date(historyEnd);
  historyStart.setDate(historyStart.getDate() - 83);
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetEnd = new Date(year, month, 0);
  const hasStarted = targetStart <= today;
  const actualEnd = targetEnd < today ? targetEnd : today;
  const orderRegionFrom = new Date(historyEnd);
  orderRegionFrom.setDate(orderRegionFrom.getDate() - 27);
  const planArticles = (planRows ?? []).map((row) => String(row.article ?? "").trim()).filter(Boolean);
  const { data: seasonalRows } = await client
    .from("finance_seasonal_products")
    .select("article,weather_mode,threshold,impact_percent_per_unit,max_adjustment_percent")
    .eq("is_active", true);
  const planArticleSet = new Set(planArticles.map((article) => article.toUpperCase()));
  const seasonalRules = ((seasonalRows ?? []) as SeasonalProductRule[])
    .filter((row) => planArticleSet.has(String(row.article ?? "").trim().toUpperCase()));
  const [report, currentReport, recentOrders, articleCosts] = await Promise.all([
    fetchForecastReportRows(iso(historyStart), iso(historyEnd), planArticles, options.signal, cabinetId),
    hasStarted
      ? fetchForecastReportRows(iso(targetStart), iso(actualEnd), planArticles, options.signal, cabinetId)
      : Promise.resolve([]),
    fetchForecastOrderRegions(
      iso(orderRegionFrom),
      iso(historyEnd),
      seasonalRules.map((row) => row.article),
      options.signal,
      cabinetId,
    ),
    fetchArticleCosts(client, options.signal),
  ]);
  const actualByArticle = aggregateByArticle(report);
  const currentByArticle = aggregateByArticle(currentReport);
  const daysInMonth = targetEnd.getDate();
  const elapsedDays = hasStarted ? Math.max(1, actualEnd.getDate()) : 0;
  const regionCounts = new Map<string, Map<string, number>>();
  for (const order of recentOrders) {
    if (order.is_cancel) continue;
    const article = String(order.supplier_article ?? "").trim().toUpperCase();
    const region = String(order.region ?? "").trim();
    if (!article || !region) continue;
    const byRegion = regionCounts.get(article) ?? new Map<string, number>();
    byRegion.set(region, (byRegion.get(region) ?? 0) + 1);
    regionCounts.set(article, byRegion);
  }
  const orderRegions = [...regionCounts.entries()].flatMap(([article, byRegion]) => {
    const total = [...byRegion.values()].reduce((sum, count) => sum + count, 0);
    return [...byRegion.entries()].map(([region, count]) => ({ article, region, share: count / total }));
  });
  const weatherImpacts = await calculateWeatherImpacts(seasonalRules, orderRegions, options.signal);

  let items = (planRows ?? []).map((row) => {
    const article = String(row.article).trim().toUpperCase();
    const actual = actualByArticle.get(article) ?? { revenue: 0, payout: 0 };
    const payoutRate = actual.revenue > 0 ? actual.payout / actual.revenue : null;
    const planRevenue = num(row.plan_revenue);
    const current = currentByArticle.get(article) ?? { revenue: 0, payout: 0 };
    const projectedRevenue = elapsedDays ? current.revenue / elapsedDays * daysInMonth : planRevenue;
    const progressWeight = elapsedDays ? Math.min(0.85, Math.max(0.25, elapsedDays / daysInMonth)) : 0;
    const adaptiveRevenue = hasStarted
      ? planRevenue * (1 - progressWeight) + projectedRevenue * progressWeight
      : planRevenue;
    const weather = weatherImpacts.get(article);
    const weatherAdjustedRevenue = adaptiveRevenue * (1 + (weather?.adjustmentPercent ?? 0) / 100);
    const meta = planMeta.get(article);
    const planBuyouts = meta?.planBuyouts ?? 0;
    const costPerUnit = articleCosts.map.get(article) ?? null;
    // §6: наличие себестоимости. available:false (ошибка чтения) → undefined,
    // чтобы не выдавать ложное «нет себестоимости» (§19). Комиссия/логистика
    // (join артикул→nmId) вынесены в отдельное согласование — здесь не оцениваются.
    const costPresence = costPerUnit !== null ? true : (articleCosts.available ? false : undefined);
    // §9: причины нехватки данных по артикулу (плановая выручка, история
    // фин.отчётов, себестоимость). Себестоимость влияет только на прибыль.
    const gapResult = classifyForecastArticleGaps({ planRevenue, payoutRate, cost: costPresence });
    return {
      article,
      externalId: meta?.externalId ?? "",
      model: meta?.model ?? "",
      planRevenue,
      planBuyouts,
      costPerUnit,
      historicalRevenue: actual.revenue,
      historicalPayout: actual.payout,
      payoutRate,
      forecastPayout: payoutRate === null ? null : weatherAdjustedRevenue * payoutRate,
      actualRevenue: current.revenue,
      projectedRevenue,
      adaptiveRevenue: weatherAdjustedRevenue,
      weatherAdjustmentPercent: weather?.adjustmentPercent ?? 0,
      weatherReason: weather?.reason ?? null,
      gaps: gapResult.gaps,
      affectsPayout: gapResult.affectsPayout,
      includedInForecast: gapResult.includedInForecast,
    };
  });
  const preliminaryPlan = items.reduce((sum, item) => sum + item.planRevenue, 0);
  const preliminaryProjection = items.reduce((sum, item) => sum + item.projectedRevenue, 0);
  const currentDeviation = preliminaryPlan > 0 ? (preliminaryProjection - preliminaryPlan) / preliminaryPlan : 0;
  // §19: finance_forecast_versions пока без cabinet_id в ключе. Историю отклонений
  // читаем/пишем только для дефолтного кабинета, иначе снапшоты кабинетов смешаются.
  // Для остальных кабинетов история пуста до owner-миграции (cabinet_id+company_id).
  const persistSnapshot = cabinetId === OPIU_WB_CABINET_ID;
  const { data: previousSnapshots } = persistSnapshot
    ? await client
        .from("finance_forecast_versions")
        .select("plan_revenue,projected_revenue,snapshot_date")
        .eq("year", year)
        .eq("month", month)
        .neq("snapshot_date", iso(today))
        .order("snapshot_date", { ascending: false })
        .limit(2)
    : { data: [] as Array<{ plan_revenue: number; projected_revenue: number; snapshot_date: string }> };
  const previousDeviations = (previousSnapshots ?? []).map((snapshot) => {
    const plan = num(snapshot.plan_revenue);
    return plan > 0 ? (num(snapshot.projected_revenue) - plan) / plan : 0;
  });
  const direction = Math.sign(currentDeviation);
  const stableDeviationDays = Math.abs(currentDeviation) >= 0.1
    ? 1 + previousDeviations.filter((value) => Math.abs(value) >= 0.1 && Math.sign(value) === direction).length
    : 0;
  const automaticAdjustmentApplied = !!options.forceRecalculate || stableDeviationDays >= 3;
  if (!automaticAdjustmentApplied) {
    items = items.map((item) => {
      const weatherMultiplier = 1 + item.weatherAdjustmentPercent / 100;
      const adaptiveRevenue = item.planRevenue * weatherMultiplier;
      return {
        ...item,
        adaptiveRevenue,
        forecastPayout: item.payoutRate === null ? null : adaptiveRevenue * item.payoutRate,
      };
    });
  }

  // §6: разбивка считается после финализации adaptiveRevenue/forecastPayout.
  // Выплата НЕ пересчитывается по юнит-экономике (формула на согласовании) —
  // удержания и прибыль честно выводятся из уже известных чисел и себестоимости.
  const itemsWithBreakdown = items.map((item) => ({
    ...item,
    breakdown: deriveArticleBreakdown({
      revenue: item.adaptiveRevenue,
      forecastPayout: item.forecastPayout,
      planBuyouts: item.planBuyouts,
      costPerUnit: item.costPerUnit,
    }),
  }));
  const breakdownTotals = sumBreakdowns(itemsWithBreakdown.map((item) => item.breakdown));
  items = itemsWithBreakdown;

  const forecastPayout = items.reduce((sum, item) => sum + (item.forecastPayout ?? 0), 0);
  const payoutDays = [7, 14, 21, Math.min(28, daysInMonth)];
  const reportAccruedPayout = [...currentByArticle.values()].reduce((sum, item) => sum + item.payout, 0);
  const payoutSummary = deriveWbPayoutSummary(forecastPayout, reportAccruedPayout);
  const futurePayoutDays = targetEnd < today
    ? []
    : payoutDays.filter((day) => targetStart > today || day > actualEnd.getDate());
  const futurePayoutDates = futurePayoutDays.map(
    (day) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );
  const result = {
    historyFrom: iso(historyStart),
    historyTo: iso(historyEnd),
    cabinetId,
    planSource,
    items,
    planRowsCount: planRows.length,
    availablePlanPeriods,
    planRevenue: items.reduce((sum, item) => sum + item.planRevenue, 0),
    forecastPayout,
    articlesWithoutHistory: items.filter((item) => item.payoutRate === null).length,
    // §9/§19: сколько артикулов имеют пробел, влияющий на выплату — при >0 итог неполный.
    articlesAffectingPayout: items.filter((item) => item.affectsPayout).length,
    // §6: раздельная разбивка (выручка/удержания/выплата/себестоимость/прибыль).
    breakdownTotals,
    weatherWarnings: items.filter((item) => item.weatherAdjustmentPercent > 0).map((item) => ({
      article: item.article,
      adjustmentPercent: item.weatherAdjustmentPercent,
      reason: item.weatherReason,
    })),
    actualRevenue: items.reduce((sum, item) => sum + item.actualRevenue, 0),
    projectedRevenue: items.reduce((sum, item) => sum + item.projectedRevenue, 0),
    adaptiveRevenue: items.reduce((sum, item) => sum + item.adaptiveRevenue, 0),
    elapsedDays,
    daysInMonth,
    stableDeviationDays,
    automaticAdjustmentApplied,
    currentDeviation,
    ...payoutSummary,
    payoutSchedule: allocateWbPayoutSchedule(payoutSummary.remainingPayout, futurePayoutDates),
  };
  const legacySnapshotPayout = deriveWbLegacySnapshotPayout(payoutSummary);
  // §19/§3 (owner follow-up): ключ снапшота — year/month/snapshot_date без cabinet_id.
  // Пишем снапшот только для дефолтного кабинета (persistSnapshot), чтобы выбор
  // другого кабинета не затирал историю COSMOS в общей строке. Для полноценной
  // мультикабинетной истории нужна owner-миграция finance_forecast_versions
  // с cabinet_id + company_id в уникальном ключе.
  if (persistSnapshot) {
    await client.from("finance_forecast_versions").upsert({
      year,
      month,
      snapshot_date: iso(today),
      plan_revenue: result.planRevenue,
      actual_revenue: result.actualRevenue,
      projected_revenue: result.projectedRevenue,
      adaptive_revenue: result.adaptiveRevenue,
      forecast_payout: result.forecastPayout,
      ...legacySnapshotPayout,
      details: result.items,
    }, { onConflict: "year,month,snapshot_date" });
  }
  return result;
}
