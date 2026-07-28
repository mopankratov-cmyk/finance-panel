import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { describeOzonScope, getOzonCabinetScope } from "@/lib/ozon/cabinet";
import { ozonAnalyticsDaily, ozonPrices, ozonTransactionTotals } from "@/lib/ozon/api";
import { loadCachedOzonCockpit } from "@/lib/ozon/cockpitCache";
import { calculateSalesPlanDaily, inferModelArticle, type SalesPlanDocument } from "@/lib/planning/salesPlan";
import { loadPlanningState } from "@/lib/planning/stateStore";
import { payoutReportKey, reconcileBankReceipts, upsertReports, type BankReceipt, type PayoutReport } from "@/lib/opiu/payoutReconciliation";

export const maxDuration = 60;

const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
type EconomySnapshot = { generatedAt?: string; period?: { from?: string; to?: string }; summary?: { payout?: number; revenue?: number }; rows?: Array<{ offerId?: string; price?: number; units?: number; revenue?: number; commissionPct?: number; logistics?: number; acquiring?: number }> };
type ForecastRate = { commissionPct: number; logistics: number; acquiring: number };
type PlanAuditEvent = { actor: string; role: string; at: string; type: string; version: number; revision: number };

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function nextWeekday(date: Date, weekday: number) {
  const result = new Date(date);
  const shift = (weekday - result.getDay() + 7) % 7;
  result.setDate(result.getDate() + shift);
  return result;
}

function endOfWeek(date: Date) {
  const result = new Date(date);
  const daysToSunday = (7 - result.getDay()) % 7;
  result.setDate(result.getDate() + daysToSunday);
  return result;
}

async function loadOzonCashFlowPayouts(
  creds: { clientId: string; apiKey: string },
  from: Date,
  to: Date,
  rules: { mode: "standard" | "weekly"; weeklyDay: number; standardDelayDays: number },
  identity: { cabinetId: string; companyId: string },
) {
  const details: unknown[] = [];
  let page = 1;
  let pageCount = 1;
  do {
    const response = await fetch("https://api-seller.ozon.ru/v1/finance/cash-flow-statement/list", {
      method: "POST",
      headers: { "Client-Id": creds.clientId.trim(), "Api-Key": creds.apiKey.trim(), "Content-Type": "application/json" },
      body: JSON.stringify({ page, page_size: 100, date: { from: from.toISOString(), to: to.toISOString() }, with_details: true }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Ozon ${response.status}, страница ${page}`);
    const payload = await response.json() as { result?: { details?: unknown; page_count?: number; pageCount?: number } };
    const rawDetails = payload.result?.details;
    details.push(...(Array.isArray(rawDetails) ? rawDetails : rawDetails && typeof rawDetails === "object" ? [rawDetails] : []));
    pageCount = Math.max(1, num(payload.result?.page_count ?? payload.result?.pageCount));
    page += 1;
  } while (page <= pageCount);
  const payouts: PayoutReport[] = [];
  for (const raw of details) {
    if (!raw || typeof raw !== "object") continue;
    const detail = raw as { payments?: { payment?: number | string }; period?: { id?: number | string; begin?: string; end?: string } };
    const amount = num(detail.payments?.payment);
    const periodFrom = String(detail.period?.begin ?? "").slice(0, 10);
    const periodTo = String(detail.period?.end ?? "").slice(0, 10);
    if (amount <= 0 || !periodFrom || !periodTo) continue;
    const periodEnd = new Date(`${periodTo}T12:00:00`);
    let payoutDate: Date;
    if (rules.mode === "weekly") payoutDate = nextWeekday(addDays(periodEnd, 1), rules.weeklyDay);
    else payoutDate = addDays(periodEnd, rules.standardDelayDays);
    payouts.push({
      marketplace: "ozon",
      cabinetId: identity.cabinetId,
      companyId: identity.companyId,
      reportId: String(detail.period?.id ?? `${periodFrom}:${periodTo}`),
      periodFrom,
      periodTo,
      amount,
      estimatedReceiptDate: iso(payoutDate),
      state: "report_confirmed",
    });
  }
  return payouts;
}

function documentForMonth(value: unknown, monthKey: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as { approvedByMonth?: Record<string, SalesPlanDocument>; approved?: SalesPlanDocument; working?: SalesPlanDocument };
  const hasMonth = (document?: SalesPlanDocument) => document?.rows.some((row) => (row.months[monthKey] ?? []).some((orders) => num(orders) > 0));
  const approved = envelope.approvedByMonth?.[monthKey]
    ?? (hasMonth(envelope.approved) ? envelope.approved : null);
  if (approved) return { document: approved, source: "approved_sales_plan" as const };
  const working = hasMonth(envelope.working) ? envelope.working : null;
  return working ? { document: working, source: "working_sales_plan" as const } : null;
}

function auditForMonth(value: unknown, monthKey: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const events = (value as { events?: unknown[] }).events;
  if (!Array.isArray(events)) return [];
  return events.flatMap((raw): PlanAuditEvent[] => {
    if (!raw || typeof raw !== "object") return [];
    const event = raw as Record<string, unknown>;
    if (event.monthKey && String(event.monthKey).padStart(2, "0") !== monthKey) return [];
    return [{
      actor: String(event.actor ?? "Неизвестный пользователь"),
      role: String(event.role ?? "unknown"),
      at: String(event.at ?? ""),
      type: String(event.type ?? "saved"),
      version: num(event.version),
      revision: num(event.revision),
    }];
  }).sort((left, right) => right.at.localeCompare(left.at));
}

export async function GET(request: NextRequest) {
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const year = Number(request.nextUrl.searchParams.get("year"));
  const month = Number(request.nextUrl.searchParams.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "Некорректный период" }, { status: 400 });
  }
  const mode = request.nextUrl.searchParams.get("mode") === "weekly" ? "weekly" : "standard";
  const weeklyDay = Math.min(6, Math.max(0, Number(request.nextUrl.searchParams.get("weeklyDay")) || 2));
  const standardDelayDays = Math.min(60, Math.max(0, Number(request.nextUrl.searchParams.get("standardDelayDays")) || 24));
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "База данных не настроена" }, { status: 500 });
  const allCabinets = await getOzonCabinetScope("all");
  if (!allCabinets.ok) return NextResponse.json({ error: allCabinets.error }, { status: 404 });
  const requestedCabinet = request.nextUrl.searchParams.get("cabinet") || allCabinets.scope.cabinets[0]?.id;
  if (requestedCabinet === "all") return NextResponse.json({ error: "Для финансового прогноза выберите один кабинет Ozon" }, { status: 400 });
  const resolved = await getOzonCabinetScope(requestedCabinet);
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 404 });
  if (resolved.scope.cabinets.length !== 1) return NextResponse.json({ error: "Финансовый прогноз рассчитывается отдельно для каждого кабинета" }, { status: 400 });
  const selectedCabinet = resolved.scope.cabinets[0];
  const companyId = request.nextUrl.searchParams.get("company") ?? "";
  let canonicalPayments: Array<{ id: string; date: string; name: string; amount: number; status: string; comment: string | null; company_id: string; category: string; counterparty: string; type: string }> = [];
  if (companyId) {
    const { data: company, error: companyError } = await db.from("companies").select("id,is_active").eq("id", companyId).maybeSingle();
    if (companyError) return NextResponse.json({ error: `Не удалось проверить компанию: ${companyError.message}` }, { status: 503 });
    if (!company || !company.is_active) return NextResponse.json({ error: "Выбранная компания не существует или отключена" }, { status: 400 });
    const { data: paymentRows, error: paymentError } = await db
      .from("payments")
      .select("id,date,name,amount,status,comment,company_id,category,counterparty,type")
      .eq("company_id", companyId);
    if (paymentError) return NextResponse.json({ error: `Не удалось прочитать фактические платежи ДДС: ${paymentError.message}` }, { status: 503 });
    canonicalPayments = (paymentRows ?? []).map((row) => ({
      id: String(row.id), date: String(row.date), name: String(row.name ?? ""), amount: num(row.amount), status: String(row.status), comment: row.comment ? String(row.comment) : null, company_id: String(row.company_id), category: String(row.category ?? ""), counterparty: String(row.counterparty ?? ""), type: String(row.type ?? ""),
    }));
  }

  const monthKey = String(month).padStart(2, "0");
  const snapshot = await loadPlanningState<{ sales_plan_v1?: { ozon?: Record<string, unknown> } }>(db, year);
  const start = new Date(year, month - 1, 1, 12);
  const end = new Date(year, month, 0, 12);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const actualEnd = end < today ? end : today;
  const daysInMonth = end.getDate();
  const dailyGross = Array.from({ length: daysInMonth }, () => 0);
  const dailyActualOrders = new Map<string, number>();
  let plannedOrders = 0;
  let plannedBuyouts = 0;
  let planRevenue = 0;
  let planRows = 0;
  let expectedPayout = 0;
  let payoutUsesFactualRate = false;
  let plannedLogistics = 0;
  let plannedCommission = 0;
  const warnings: string[] = [];
  const dataNotices: string[] = [];
  const cachedEconomy = new Map<string, EconomySnapshot>();
  const confirmedPayouts: PayoutReport[] = [];
  let reportDataStatus: "available" | "degraded" = "available";
  let planSource: "approved_sales_plan" | "working_sales_plan" | "none" = "none";
  const planAudit: Array<{ cabinetId: string; responsible: string; updatedAt: string; events: PlanAuditEvent[] }> = [];

  for (const cabinet of resolved.scope.cabinets) {
    const storedPlan = snapshot.data.sales_plan_v1?.ozon?.[cabinet.id];
    const selectedPlan = documentForMonth(storedPlan, monthKey);
    if (!selectedPlan) continue;
    const { document } = selectedPlan;
    planSource = selectedPlan.source;
    planAudit.push({ cabinetId: cabinet.id, responsible: document.responsible, updatedAt: document.updatedAt, events: auditForMonth(storedPlan, monthKey) });
    const prices = await ozonPrices(cabinet.creds);
    let fallback: EconomySnapshot | null = null;
    if (!prices.ok) {
      try {
        fallback = await loadCachedOzonCockpit({ view: "economy", scope: describeOzonScope({ mode: "single", label: cabinet.name, cabinets: [cabinet] }), days: 30, taxPct: 7 }) as unknown as EconomySnapshot;
        if (fallback) cachedEconomy.set(cabinet.id, fallback);
        dataNotices.push(`${cabinet.name}: использован последний снимок основной панели${fallback.generatedAt ? ` от ${new Date(fallback.generatedAt).toLocaleString("ru-RU")}` : ""}`);
      } catch {
        warnings.push(`${cabinet.name}: нет ответа Ozon API и сохранённого снимка юнит-экономики`);
      }
    }
    const fallbackRows = fallback?.rows ?? [];
    const rates = new Map<string, ForecastRate>(prices.ok
      ? prices.rows.map((row) => [row.offer_id.trim().toUpperCase(), { commissionPct: row.commissionPct, logistics: row.logistics, acquiring: row.acquiring }] as const)
      : fallbackRows.map((row) => [String(row.offerId ?? "").trim().toUpperCase(), {
          commissionPct: num(row.commissionPct),
          logistics: num(row.logistics),
          acquiring: num(row.acquiring),
        }] as const));
    for (const row of document.rows) {
      const daily = row.months[monthKey] ?? [];
      if (!daily.some((orders) => num(orders) > 0)) continue;
      planRows += 1;
      const article = String(row.model || inferModelArticle(row.variant) || row.variant).trim().toUpperCase();
      const rate = rates.get(String(row.externalId || article).trim().toUpperCase()) ?? rates.get(article);
      daily.forEach((orders, index) => {
        const metric = calculateSalesPlanDaily(row, num(orders));
        plannedOrders += metric.orders;
        plannedBuyouts += metric.buyouts;
        planRevenue += metric.revenue;
        dailyGross[index] += metric.revenue;
        if (rate) {
          expectedPayout += Math.max(0, metric.revenue * (1 - rate.commissionPct / 100) - (rate.logistics + rate.acquiring) * metric.buyouts);
          plannedLogistics += rate.logistics * metric.buyouts;
          plannedCommission += metric.revenue * rate.commissionPct / 100;
        }
      });
    }
  }

  if (!companyId) {
    dataNotices.push("Выберите компанию-получателя, чтобы загрузить и сверить финансовые отчёты Ozon");
  } else {
    for (const cabinet of resolved.scope.cabinets) {
      try {
        const reportFrom = addDays(start, -31);
        const reportTo = addDays(end, 31);
        const rows = await loadOzonCashFlowPayouts(cabinet.creds, reportFrom, reportTo, { mode, weeklyDay, standardDelayDays }, { cabinetId: cabinet.id, companyId });
        confirmedPayouts.push(...rows.filter((row) => row.periodFrom <= iso(end) && row.periodTo >= iso(start)));
        if (rows.length) dataNotices.push(`${cabinet.name}: суммы подтверждены отчётом Ozon; даты поступления пока расчётные до появления факта в банке`);
      } catch (error) {
        reportDataStatus = "degraded";
        warnings.push(`${cabinet.name}: полный набор финансовых отчётов Ozon недоступен — ${error instanceof Error ? error.message : "ошибка провайдера"}`);
      }
    }
  }
  if (reportDataStatus === "degraded") {
    for (const payment of canonicalPayments) {
      const match = payment.comment?.match(/\[ozon-report:([^:\]]+):([^:\]]+):([^:\]]+):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})\]/);
      if (!match || match[1] !== selectedCabinet.id || match[2] !== companyId) continue;
      if (payment.status === "cancelled" && !payment.comment?.includes("[reconciled-by:")) continue;
      const storedTotal = Number(payment.comment?.match(/\[report-total:([\d.]+)\]/)?.[1]);
      confirmedPayouts.push({ marketplace: "ozon", cabinetId: match[1], companyId: match[2], reportId: match[3], periodFrom: match[4], periodTo: match[5], amount: Number.isFinite(storedTotal) && storedTotal > 0 ? storedTotal : payment.amount, estimatedReceiptDate: payment.date, state: "report_confirmed" });
    }
    dataNotices.push("Использован последний подтверждённый набор отчётов из платёжного календаря; обновление календаря заблокировано до восстановления Ozon API");
  }
  confirmedPayouts.splice(0, confirmedPayouts.length, ...upsertReports([], confirmedPayouts));

  let actualOrders = 0;
  let actualRevenue = 0;
  await Promise.all(resolved.scope.cabinets.map(async (cabinet) => {
    const [analytics, finance] = await Promise.all([
      ozonAnalyticsDaily(cabinet.creds, iso(start), iso(actualEnd)),
      ozonTransactionTotals(cabinet.creds, `${iso(start)}T00:00:00.000Z`, `${iso(actualEnd)}T23:59:59.999Z`),
    ]);
    if (analytics.ok) {
      actualOrders += analytics.rows.reduce((sum, row) => sum + row.ordered_units, 0);
      actualRevenue += analytics.rows.reduce((sum, row) => sum + row.revenue, 0);
      for (const row of analytics.rows) dailyActualOrders.set(row.day, (dailyActualOrders.get(row.day) ?? 0) + row.ordered_units);
    } else {
      const fallback = cachedEconomy.get(cabinet.id);
      actualOrders += (fallback?.rows ?? []).reduce((sum, row) => sum + num(row.units), 0);
      actualRevenue += (fallback?.rows ?? []).reduce((sum, row) => sum + (num(row.revenue) || num(row.price) * num(row.units)), 0);
      if (!cachedEconomy.has(cabinet.id)) warnings.push(`${cabinet.name}: фактические заказы и продажи временно недоступны`);
    }
    if (!finance.ok && !cachedEconomy.has(cabinet.id)) warnings.push(`${cabinet.name}: финансовые начисления Ozon временно недоступны`);
  }));

  const orderControlEnd = addDays(actualEnd < today ? actualEnd : today, actualEnd < today ? 0 : -1);
  const orderControlDates = [2, 1, 0].map((daysAgo) => iso(addDays(orderControlEnd, -daysAgo)));
  const orderProjections = orderControlDates.map((date) => {
    const day = Math.max(1, Math.min(daysInMonth, new Date(`${date}T12:00:00`).getDate()));
    let cumulative = 0;
    for (const [actualDate, orders] of dailyActualOrders) if (actualDate <= date) cumulative += orders;
    const projection = cumulative / day * daysInMonth;
    const deviation = plannedOrders > 0 ? projection / plannedOrders - 1 : 0;
    return { date, day, cumulative, projection, deviation };
  });
  const hasThreeOrderDays = orderProjections.length === 3 && orderProjections.every((row) => row.cumulative > 0);
  const consistentlyAbove = hasThreeOrderDays && orderProjections.every((row) => row.deviation >= 0.1);
  const consistentlyBelow = hasThreeOrderDays && orderProjections.every((row) => row.deviation <= -0.1);
  const orderAdjustmentApplied = consistentlyAbove || consistentlyBelow;
  const latestOrderProjection = orderProjections.at(-1)?.projection ?? plannedOrders;
  const adaptivePlannedOrders = orderAdjustmentApplied ? Math.max(0, latestOrderProjection) : plannedOrders;
  const orderAdjustmentFactor = plannedOrders > 0 ? adaptivePlannedOrders / plannedOrders : 1;
  const adaptivePlanRevenue = planRevenue * orderAdjustmentFactor;
  if (orderAdjustmentApplied) {
    expectedPayout *= orderAdjustmentFactor;
    plannedLogistics *= orderAdjustmentFactor;
    plannedCommission *= orderAdjustmentFactor;
    dataNotices.push(`План заказов системы пересчитан после 3 последовательных дней отклонения: ${Math.round(plannedOrders).toLocaleString("ru-RU")} → ${Math.round(adaptivePlannedOrders).toLocaleString("ru-RU")} шт.`);
  }

  if (adaptivePlanRevenue > 0 && expectedPayout === 0) {
    const cachedRevenue = [...cachedEconomy.values()].reduce((sum, item) => sum + num(item.summary?.revenue), 0);
    const cachedPayout = [...cachedEconomy.values()].reduce((sum, item) => sum + num(item.summary?.payout), 0);
    const factualRate = cachedRevenue > 0
      ? Math.max(0, Math.min(1, cachedPayout / cachedRevenue))
        : 0;
    expectedPayout = adaptivePlanRevenue * factualRate;
    payoutUsesFactualRate = factualRate > 0;
    if (!factualRate) warnings.push("Не удалось рассчитать сумму перечисления: нет тарифов и истории выплат Ozon");
    else dataNotices.push(`Сумма перечисления рассчитана по фактической доле выплаты основной панели: ${(factualRate * 100).toFixed(1)}% от выручки`);
  }
  const dailyFinancial = new Map<string, { revenue: number; commission: number; logistics: number; other: number }>();
  const lastCompletedDay = addDays(actualEnd < today ? actualEnd : today, actualEnd < today ? 0 : -1);
  const controlDates = [2, 1, 0].map((daysAgo) => iso(addDays(lastCompletedDay, -daysAgo)));
  await Promise.all(resolved.scope.cabinets.flatMap((cabinet) => controlDates.map(async (date) => {
    const totals = await ozonTransactionTotals(cabinet.creds, `${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`);
    if (!totals.ok) return;
    const current = dailyFinancial.get(date) ?? { revenue: 0, commission: 0, logistics: 0, other: 0 };
    current.revenue += Math.max(0, totals.totals.accruals_for_sale);
    current.commission += Math.abs(totals.totals.sale_commission);
    current.logistics += Math.abs(totals.totals.processing_and_delivery);
    current.other += Math.abs(totals.totals.services_amount) + Math.abs(totals.totals.others_amount);
    dailyFinancial.set(date, current);
  })));
  const financialAdjustments: Array<{ metric: string; plannedRate: number; actualRate: number; impact: number; observedDays: number; message: string }> = [];
  if (adaptivePlanRevenue > 0 && !payoutUsesFactualRate) {
    const plannedLogisticsRate = plannedLogistics / adaptivePlanRevenue;
    const plannedCommissionRate = plannedCommission / adaptivePlanRevenue;
    const rows = controlDates.map((date) => dailyFinancial.get(date)).filter((row): row is { revenue: number; commission: number; logistics: number; other: number } => Boolean(row && row.revenue > 0));
    const hasThreeDays = rows.length === 3;
    const averageRate = (field: "commission" | "logistics" | "other") => rows.length ? rows.reduce((sum, row) => sum + row[field] / row.revenue, 0) / rows.length : 0;
    const actualLogisticsRate = averageRate("logistics");
    if (hasThreeDays && rows.every((row) => row.logistics / row.revenue > plannedLogisticsRate + 0.01 && row.logistics / row.revenue > plannedLogisticsRate * 1.15)) {
      const impact = adaptivePlanRevenue * (actualLogisticsRate - plannedLogisticsRate);
      expectedPayout = Math.max(0, expectedPayout - impact);
      financialAdjustments.push({ metric: "Логистика", plannedRate: plannedLogisticsRate, actualRate: actualLogisticsRate, impact: -impact, observedDays: 3, message: "Фактическая доля логистики выше расчётной три последовательных дня" });
    }
    const actualCommissionRate = averageRate("commission");
    if (hasThreeDays && rows.every((row) => row.commission / row.revenue > plannedCommissionRate + 0.01 && row.commission / row.revenue > plannedCommissionRate * 1.1)) {
      const impact = adaptivePlanRevenue * (actualCommissionRate - plannedCommissionRate);
      expectedPayout = Math.max(0, expectedPayout - impact);
      financialAdjustments.push({ metric: "Комиссия", plannedRate: plannedCommissionRate, actualRate: actualCommissionRate, impact: -impact, observedDays: 3, message: "Фактическая комиссия выше расчётной три последовательных дня" });
    }
    const actualOtherRate = averageRate("other");
    if (hasThreeDays && rows.every((row) => row.other / row.revenue > 0.02)) {
      const impact = adaptivePlanRevenue * actualOtherRate;
      expectedPayout = Math.max(0, expectedPayout - impact);
      financialAdjustments.push({ metric: "Хранение и прочие услуги Ozon", plannedRate: 0, actualRate: actualOtherRate, impact: -impact, observedDays: 3, message: "Дополнительные удержания превышают 2% выручки три последовательных дня" });
    }
    if (!hasThreeDays) dataNotices.push(`Контроль расходов: для пересчёта нужны данные за 3 завершённых дня, сейчас доступны ${rows.length}`);
  }
  const bankReceipts: BankReceipt[] = canonicalPayments.filter((row) => row.amount > 0 && (/ozon|озон/i.test(`${row.name} ${row.category} ${row.counterparty}`) || row.comment?.includes("[payout-link:ozon:"))).map((row) => ({
    id: row.id, companyId: row.company_id, amount: row.amount, status: row.status as BankReceipt["status"], comment: row.comment ?? undefined,
  }));
  const reconciliation = reconcileBankReceipts(confirmedPayouts, bankReceipts);
  const actualPayout = [...reconciliation.receivedByReport.values()].reduce((sum, value) => sum + value, 0);
  const remainingPayout = Math.max(0, expectedPayout - actualPayout);
  const buckets = new Map<string, number>();
  dailyGross.forEach((weight, index) => {
    if (weight <= 0) return;
    const saleDate = new Date(year, month - 1, index + 1, 12);
    let payoutDate: Date;
    if (mode === "weekly") {
      payoutDate = nextWeekday(addDays(saleDate, 7), weeklyDay);
    } else {
      payoutDate = addDays(endOfWeek(saleDate), standardDelayDays);
    }
    if (payoutDate < today) return;
    const key = iso(payoutDate);
    buckets.set(key, (buckets.get(key) ?? 0) + weight);
  });
  const reportDates = new Set(confirmedPayouts.map((report) => report.estimatedReceiptDate));
  const unconfirmedWeight = [...buckets.entries()].filter(([date]) => !reportDates.has(date)).reduce((sum, [, value]) => sum + value, 0);
  const confirmedTotal = confirmedPayouts.reduce((sum, report) => sum + Math.max(0, report.amount - (reconciliation.receivedByReport.get(payoutReportKey(report)) ?? 0)), 0);
  const forecastRemainder = Math.max(0, remainingPayout - confirmedTotal);
  let allocated = 0;
  const forecastSchedule = [...buckets.entries()].filter(([date]) => !reportDates.has(date)).sort(([left], [right]) => left.localeCompare(right)).map(([date, weight], index, rows) => {
    const isLastUnconfirmed = index === rows.length - 1;
    const amount = isLastUnconfirmed
      ? Math.max(0, Math.round(forecastRemainder - allocated))
      : Math.round(unconfirmedWeight > 0 ? forecastRemainder * weight / unconfirmedWeight : 0);
    allocated += amount;
    return { id: `forecast:${selectedCabinet.id}:${date}`, date, amount, source: "forecast" as const, state: "accrual" as const, dateIsEstimated: true };
  });
  const reportSchedule = confirmedPayouts.map((report) => ({
    id: payoutReportKey(report),
    reportId: report.reportId,
    periodFrom: report.periodFrom,
    periodTo: report.periodTo,
    date: report.estimatedReceiptDate,
    amount: Math.max(0, report.amount - (reconciliation.receivedByReport.get(payoutReportKey(report)) ?? 0)),
    reportAmount: report.amount,
    source: "financial_report" as const,
    state: "report_confirmed" as const,
    dateIsEstimated: true,
  }));
  const payoutSchedule = [...reportSchedule, ...forecastSchedule].filter((row) => row.amount > 0).sort((left, right) => left.date.localeCompare(right.date));

  return NextResponse.json({
    marketplace: "ozon",
    cabinetId: selectedCabinet.id,
    scope: resolved.scope.label,
    cabinets: allCabinets.scope.cabinets.map((cabinet) => ({ id: cabinet.id, name: cabinet.name })),
    planRows,
    planSource,
    planApproved: planSource === "approved_sales_plan",
    planRevenue,
    plannedOrders,
    adaptivePlannedOrders,
    adaptivePlanRevenue,
    orderAdjustmentApplied,
    orderDeviationDays: hasThreeOrderDays ? 3 : orderProjections.filter((row) => row.cumulative > 0).length,
    orderDeviationPercent: orderProjections.at(-1)?.deviation ?? 0,
    plannedBuyouts,
    actualOrders,
    actualRevenue,
    expectedPayout,
    actualPayout,
    remainingPayout,
    payoutSchedule,
    confirmedPayouts,
    reportDataStatus,
    reconciliationQueue: reconciliation.unresolved.map((item) => {
      const payment = canonicalPayments.find((row) => row.id === item.bankReceiptId);
      return { ...item, date: payment?.date ?? "", name: payment?.name ?? "", paymentAmount: payment?.amount ?? 0 };
    }),
    financialAdjustments,
    planAudit,
    mode,
    standardDelayDays,
    warnings: [...new Set(warnings)],
    dataNotices: [...new Set(dataNotices)],
  });
}
