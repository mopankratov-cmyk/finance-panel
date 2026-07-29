import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { supabase } from "@/lib/supabase";
import { calculateWeatherImpacts, type SeasonalProductRule } from "@/lib/opiu/weatherImpact";
import { fetchOrders, fetchSalesFromCache } from "@/lib/opiu/loadMonth";

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isSale = (value: unknown) => {
  const text = String(value ?? "").toLowerCase();
  return text.includes("продаж") || text.includes("sale");
};

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

function aggregateByArticle(report: Awaited<ReturnType<typeof fetchSalesFromCache>>) {
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

export async function buildMarketplacePayoutForecast(
  year: number,
  month: number,
  options: { forceRecalculate?: boolean } = {},
) {
  const client = getSupabaseAdmin() ?? supabase;
  const { data: planRows, error } = await client
    .from("sales_plan")
    .select("article,plan_revenue")
    .eq("year", year)
    .eq("month", month);
  if (error) throw new Error(error.message);
  let availablePlanPeriods: Array<{ year: number; month: number }> = [];
  if (!(planRows ?? []).length) {
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
  const [report, currentReport, recentOrders] = await Promise.all([
    fetchSalesFromCache(iso(historyStart), iso(historyEnd)),
    hasStarted ? fetchSalesFromCache(iso(targetStart), iso(actualEnd)) : Promise.resolve([]),
    fetchOrders(iso(orderRegionFrom), iso(historyEnd), false),
  ]);
  const actualByArticle = aggregateByArticle(report);
  const currentByArticle = aggregateByArticle(currentReport);
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
    return {
      article,
      planRevenue,
      historicalRevenue: actual.revenue,
      historicalPayout: actual.payout,
      payoutRate,
      forecastPayout: payoutRate === null ? null : weatherAdjustedRevenue * payoutRate,
      actualRevenue: current.revenue,
      projectedRevenue,
      adaptiveRevenue: weatherAdjustedRevenue,
      weatherAdjustmentPercent: weather?.adjustmentPercent ?? 0,
      weatherReason: weather?.reason ?? null,
    };
  });
  const preliminaryPlan = items.reduce((sum, item) => sum + item.planRevenue, 0);
  const preliminaryProjection = items.reduce((sum, item) => sum + item.projectedRevenue, 0);
  const currentDeviation = preliminaryPlan > 0 ? (preliminaryProjection - preliminaryPlan) / preliminaryPlan : 0;
  const { data: previousSnapshots } = await client
    .from("finance_forecast_versions")
    .select("plan_revenue,projected_revenue,snapshot_date")
    .eq("year", year)
    .eq("month", month)
    .neq("snapshot_date", iso(today))
    .order("snapshot_date", { ascending: false })
    .limit(2);
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

  const forecastPayout = items.reduce((sum, item) => sum + (item.forecastPayout ?? 0), 0);
  const payoutDays = [7, 14, 21, Math.min(28, daysInMonth)];
  const actualPayout = [...currentByArticle.values()].reduce((sum, item) => sum + item.payout, 0);
  const futurePayoutDays = targetEnd < today
    ? []
    : payoutDays.filter((day) => targetStart > today || day > actualEnd.getDate());
  const remainingPayout = Math.max(0, forecastPayout - actualPayout);
  const result = {
    historyFrom: iso(historyStart),
    historyTo: iso(historyEnd),
    items,
    planRowsCount: (planRows ?? []).length,
    availablePlanPeriods,
    planRevenue: items.reduce((sum, item) => sum + item.planRevenue, 0),
    forecastPayout,
    articlesWithoutHistory: items.filter((item) => item.payoutRate === null).length,
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
    actualPayout,
    remainingPayout,
    payoutSchedule: futurePayoutDays.map((day, index) => ({
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      amount: index === futurePayoutDays.length - 1
        ? remainingPayout - Math.round(remainingPayout / futurePayoutDays.length) * (futurePayoutDays.length - 1)
        : Math.round(remainingPayout / futurePayoutDays.length),
    })),
  };
  await client.from("finance_forecast_versions").upsert({
    year,
    month,
    snapshot_date: iso(today),
    plan_revenue: result.planRevenue,
    actual_revenue: result.actualRevenue,
    projected_revenue: result.projectedRevenue,
    adaptive_revenue: result.adaptiveRevenue,
    forecast_payout: result.forecastPayout,
    actual_payout: result.actualPayout,
    remaining_payout: result.remainingPayout,
    details: result.items,
  }, { onConflict: "year,month,snapshot_date" });
  return result;
}
