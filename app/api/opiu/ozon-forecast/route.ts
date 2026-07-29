import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getOzonCabinetScope } from "@/lib/ozon/cabinet";
import { ozonAnalyticsDaily, ozonPrices } from "@/lib/ozon/api";
import { calculateSalesPlanDaily, inferModelArticle, type SalesPlanDocument } from "@/lib/planning/salesPlan";
import { loadPlanningState } from "@/lib/planning/stateStore";
import {
  payoutReportKey,
  reconcileBankReceipts,
  type BankReceipt,
  type PayoutReport,
} from "@/lib/opiu/payoutReconciliation";
import {
  allocateForecastRemainder,
  assessCappedProviderRows,
  assessTariffCoverage,
  classifyActualPeriod,
  createRequestDeadline,
  deriveMoscowBusinessDate,
  deriveDefinitivePayout,
  deriveReconciliationDataStatus,
  isForecastDateEligible,
  loadBoundedPaymentRows,
  loadOzonCashFlowReports,
  mergePayoutSchedule,
  isSupportedForecastYear,
  parsePayoutMode,
  parsePayoutRuleParams,
  publicOzonForecastError,
  reportBelongsToMonth,
  runWithDeadline,
  validateOzonForecastQuery,
  type PaymentReadDatabase,
  type ScheduleRow,
} from "@/lib/opiu/ozonForecastPolicy";
import {
  classifyOzonReceipt,
  getOzonPayoutMapping,
} from "@/lib/opiu/ozonPayoutIdentity";

export const maxDuration = 60;
const REQUEST_BUDGET_MS = 48_000;

const numberOrZero = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;
const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function endOfWeek(date: Date) {
  return addDays(date, (7 - date.getDay()) % 7);
}

function nextWeekday(date: Date, weekday: number) {
  return addDays(date, (weekday - date.getDay() + 7) % 7);
}

function planForMonth(value: unknown, monthKey: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as {
    approvedByMonth?: Record<string, SalesPlanDocument>;
    approved?: SalesPlanDocument;
    working?: SalesPlanDocument;
  };
  const hasMonth = (document?: SalesPlanDocument) =>
    document?.rows.some((row) =>
      (row.months[monthKey] ?? []).some((orders) => numberOrZero(orders) > 0));
  const approved = envelope.approvedByMonth?.[monthKey]
    ?? (hasMonth(envelope.approved) ? envelope.approved : null);
  if (approved) return { document: approved, source: "approved_sales_plan" as const };
  if (hasMonth(envelope.working)) {
    return { document: envelope.working!, source: "working_sales_plan" as const };
  }
  return null;
}

export async function GET(request: NextRequest) {
  const businessDateKey = deriveMoscowBusinessDate(new Date());
  const gate = await requireApiSession(["director", "finance"]);
  if (gate) return gate;
  const deadline = createRequestDeadline(Date.now(), REQUEST_BUDGET_MS);
  const deadlineOptions = { signal: request.signal };

  try {
    const queryValidation = validateOzonForecastQuery(request.nextUrl.searchParams);
    if (!queryValidation.ok) {
      return NextResponse.json({ error: queryValidation.error }, { status: 400 });
    }
    const year = Number(request.nextUrl.searchParams.get("year"));
    const month = Number(request.nextUrl.searchParams.get("month"));
    if (!isSupportedForecastYear(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: "Некорректный период" }, { status: 400 });
    }

    const payoutMode = parsePayoutMode(
      request.nextUrl.searchParams.get("mode"),
    );
    if (!payoutMode.ok) {
      return NextResponse.json(
        { error: payoutMode.error },
        { status: 400 },
      );
    }
    const { mode } = payoutMode;
    const payoutRuleParams = parsePayoutRuleParams(
      request.nextUrl.searchParams.get("weeklyDay"),
      request.nextUrl.searchParams.get("standardDelayDays"),
    );
    if (!payoutRuleParams.ok) {
      return NextResponse.json(
        { error: payoutRuleParams.error },
        { status: 400 },
      );
    }
    const { weeklyDay, standardDelayDays } = payoutRuleParams;
    const db = getSupabaseAdmin();
    if (!db) {
      return NextResponse.json({ error: "База данных не настроена" }, { status: 500 });
    }

    const allCabinets = await runWithDeadline(
      deadline,
      "список кабинетов",
      (signal) => getOzonCabinetScope("all", { signal }),
      deadlineOptions,
    );
    if (!allCabinets.ok) {
      return NextResponse.json(
        { error: "Не удалось получить список кабинетов Ozon" },
        { status: 503 },
      );
    }
    const requestedCabinet = request.nextUrl.searchParams.get("cabinet")
      || allCabinets.scope.cabinets[0]?.id;
    if (!requestedCabinet || requestedCabinet === "all") {
      return NextResponse.json(
        { error: "Для финансового прогноза выберите один кабинет Ozon" },
        { status: 400 },
      );
    }
    const resolved = await runWithDeadline(
      deadline,
      "выбранный кабинет",
      (signal) => getOzonCabinetScope(requestedCabinet, { signal }),
      deadlineOptions,
    );
    if (!resolved.ok) {
      return NextResponse.json(
        { error: "Выбранный кабинет Ozon не найден" },
        { status: 404 },
      );
    }
    if (resolved.scope.cabinets.length !== 1) {
      return NextResponse.json(
        { error: "Финансовый прогноз рассчитывается отдельно для каждого кабинета" },
        { status: 400 },
      );
    }
    const cabinet = resolved.scope.cabinets[0];
    const mapping = getOzonPayoutMapping(cabinet.id);
    if (!mapping) {
      return NextResponse.json(
        { error: "Для выбранного кабинета не настроено подтверждённое сопоставление выплат" },
        { status: 422 },
      );
    }
    const companyId = mapping.companyId;
    let paymentRows: Array<{
      id: string;
      date: string;
      name: string;
      amount: number;
      status: string;
      comment: string | null;
      company_id: string | null;
      category: string;
      counterparty: string;
      account_id: string;
    }> = [];
    const companyResult = await runWithDeadline(
      deadline,
      "компания",
      async (signal) => {
        signal.throwIfAborted();
        return await db
          .from("companies")
          .select("id,is_active")
          .eq("id", companyId)
          .abortSignal(signal)
          .maybeSingle();
      },
      deadlineOptions,
    );
    if (companyResult.error) throw companyResult.error;
    if (!companyResult.data?.is_active) {
      return NextResponse.json(
        { error: "Сопоставленная компания не существует или отключена" },
        { status: 422 },
      );
    }
    const monthKey = String(month).padStart(2, "0");
    const snapshot = await runWithDeadline(
      deadline,
      "план продаж",
      (signal) => loadPlanningState<{
        sales_plan_v1?: { ozon?: Record<string, unknown> };
      }>(db, year, { signal }),
      deadlineOptions,
    );
    const selectedPlan = planForMonth(
      snapshot.data.sales_plan_v1?.ozon?.[cabinet.id],
      monthKey,
    );
    const start = new Date(year, month - 1, 1, 12);
    const end = new Date(year, month, 0, 12);
    const boundedRows = await runWithDeadline(
        deadline,
        "платежи для сверки",
        (signal) => loadBoundedPaymentRows(
          db as unknown as PaymentReadDatabase,
          mapping.receivingAccountId,
          start,
          end,
          Math.max(standardDelayDays, 7),
          { signal },
        ),
        deadlineOptions,
    );
    paymentRows = boundedRows.map((row) => ({
        id: String(row.id),
        date: String(row.date),
        name: String(row.name ?? ""),
        amount: numberOrZero(row.amount),
        status: String(row.status),
        comment: row.comment ? String(row.comment) : null,
        company_id: row.company_id ? String(row.company_id) : null,
        category: String(row.category ?? ""),
        counterparty: String(row.counterparty ?? ""),
        account_id: String(row.account_id ?? ""),
      }));
    const dailyGross = Array.from({ length: end.getDate() }, () => 0);
    const warnings: string[] = [];
    const dataNotices: string[] = [];
    let plannedOrders = 0;
    let planRevenueCents = 0;
    let planRows = 0;
    let expectedPayoutCents = 0;
    const forecastCoverageRows: Array<{
      revenue: number;
      tariff: {
        commissionPct: number;
        logistics: number;
        acquiring: number;
      } | undefined;
    }> = [];

    const prices = await runWithDeadline(
      deadline,
      "тарифы Ozon",
      (signal) => ozonPrices(cabinet.creds, { signal, cache: "no-store" }),
      deadlineOptions,
    );
    const rates = new Map(prices.ok
      ? prices.rows.map((row) => [
        row.offer_id.trim().toUpperCase(),
        {
          commissionPct: row.commissionPct,
          logistics: row.logistics,
          acquiring: row.acquiring,
        },
      ] as const)
      : []);
    if (!prices.ok) {
      warnings.push(`${cabinet.name}: тарифы Ozon недоступны — прогноз выплаты неполный`);
    }

    for (const row of selectedPlan?.document.rows ?? []) {
      const daily = row.months[monthKey] ?? [];
      if (!daily.some((orders) => numberOrZero(orders) > 0)) continue;
      planRows += 1;
      const article = String(
        row.model || inferModelArticle(row.variant) || row.variant,
      ).trim().toUpperCase();
      const rate = rates.get(String(row.externalId || article).trim().toUpperCase())
        ?? rates.get(article);
      let rowRevenueCents = 0;
      daily.forEach((orders, index) => {
        const metric = calculateSalesPlanDaily(row, numberOrZero(orders));
        const revenueCents = Math.max(0, Math.round(metric.revenue * 100));
        plannedOrders += metric.orders;
        planRevenueCents += revenueCents;
        rowRevenueCents += revenueCents;
        dailyGross[index] += revenueCents;
        if (
          rate
          && Number.isFinite(rate.commissionPct)
          && rate.commissionPct > 0
          && rate.commissionPct <= 100
          && Number.isFinite(rate.logistics)
          && rate.logistics > 0
          && Number.isFinite(rate.acquiring)
          && rate.acquiring > 0
        ) {
          expectedPayoutCents += Math.max(
            0,
            Math.round((
              metric.revenue * (1 - rate.commissionPct / 100)
                - (rate.logistics + rate.acquiring) * metric.buyouts
            ) * 100),
          );
        }
      });
      forecastCoverageRows.push({
        revenue: rowRevenueCents / 100,
        tariff: rate,
      });
    }
    const coverage = assessTariffCoverage(
      prices.ok,
      prices.ok ? prices.rows.length : 0,
      forecastCoverageRows,
    );
    const forecastDataStatus = coverage.forecastDataStatus;
    if (forecastDataStatus === "degraded" && prices.ok) {
      warnings.push(prices.rows.length >= 20_000
        ? `${cabinet.name}: тарифы Ozon достигли лимита строк и могут быть неполными`
        : `${cabinet.name}: не для всех строк с плановой выручкой найдены полные валидные тарифы Ozon`);
    }

    let reportDataStatus: "available" | "degraded" | "not_selected" = "available";
    let confirmedPayouts: PayoutReport[] = [];
      try {
        const reportResult = await loadOzonCashFlowReports({
          creds: cabinet.creds,
          from: addDays(start, -31),
          to: addDays(end, 31),
          rules: { mode, weeklyDay, standardDelayDays },
          identity: { cabinetId: cabinet.id, companyId },
          deadline,
          deadlineOptions,
        });
        confirmedPayouts = reportResult.reports.filter(
          (item) => reportBelongsToMonth(item, year, month),
        );
        if (reportResult.degraded) {
          reportDataStatus = "degraded";
          warnings.push(
            `${cabinet.name}: отклонено строк отчётов без обязательного внешнего ID или валидных данных: ${reportResult.rejectedRows}`,
          );
        }
      } catch {
        reportDataStatus = "degraded";
        warnings.push(
          `${cabinet.name}: финансовые отчёты Ozon недоступны`,
        );
      }

    const actualPeriod = classifyActualPeriod(year, month, businessDateKey);
    let actualDataStatus: "available" | "not_started" | "degraded" = actualPeriod.status;
    let actualOrders = 0;
    let actualRevenue = 0;
    if (actualPeriod.range) {
      const analytics = await runWithDeadline(
        deadline,
        "аналитика Ozon",
        (signal) => ozonAnalyticsDaily(
          cabinet.creds,
          actualPeriod.range.from,
          actualPeriod.range.to,
          false,
          { signal, cache: "no-store" },
        ),
        deadlineOptions,
      );
      const analyticsCompleteness = assessCappedProviderRows(
        analytics.ok,
        analytics.ok ? analytics.rows.length : 0,
      );
      if (analytics.ok && analyticsCompleteness.status === "available") {
        actualOrders = analytics.rows.reduce(
          (sum, row) => sum + numberOrZero(row.ordered_units),
          0,
        );
        actualRevenue = analytics.rows.reduce(
          (sum, row) => sum + numberOrZero(row.revenue),
          0,
        );
      } else {
        actualDataStatus = "degraded";
        warnings.push(
          analytics.ok
            ? `${cabinet.name}: аналитика Ozon достигла лимита строк и может быть неполной`
            : `${cabinet.name}: фактические заказы Ozon недоступны`,
        );
      }
    } else {
      dataNotices.push("Фактические показатели ещё не начались для будущего месяца");
    }

    const classifiedRows = paymentRows.map((row) => ({
      row,
      classification: classifyOzonReceipt({
        status: row.status,
        amount: row.amount,
        category: row.category,
        accountId: row.account_id,
        companyId: row.company_id,
        rawText: `${row.name} ${row.counterparty} ${row.comment ?? ""}`,
      }, mapping),
    }));
    const bankReceipts: BankReceipt[] = classifiedRows
      .filter(({ classification }) => classification.kind === "confirmed")
      .map(({ row }) => ({
        id: row.id,
        companyId,
        amount: row.amount,
        status: row.status as BankReceipt["status"],
        comment: row.comment ?? undefined,
      }));
    const reconciliation = reconcileBankReceipts(confirmedPayouts, bankReceipts);
    for (const { row, classification } of classifiedRows) {
      if (classification.kind === "unresolved") {
        reconciliation.unresolved.push({
          bankReceiptId: row.id,
          reason: classification.reason,
          amount: row.amount,
        });
      }
    }
    const reconciliationDataStatus = deriveReconciliationDataStatus(
      reportDataStatus,
      reconciliation.unresolved,
    );
    if (reconciliationDataStatus === "degraded" && reconciliation.unresolved.length > 0) {
      warnings.push(
        "Есть неразрешённые поступления Ozon: итоговые суммы и график недоступны до полной сверки",
      );
    }
    const totals = deriveDefinitivePayout({
      forecastDataStatus,
      reportDataStatus,
      reconciliationDataStatus,
      expectedPayout: expectedPayoutCents / 100,
      reports: confirmedPayouts.map((item) => ({
        key: payoutReportKey(item),
        amount: item.amount,
      })),
      receivedByReport: reconciliation.receivedByReport,
    });
    const buckets = new Map<string, number>();
    dailyGross.forEach((weight, index) => {
      if (weight <= 0) return;
      const saleDate = new Date(year, month - 1, index + 1, 12);
      const payoutDate = mode === "weekly"
        ? nextWeekday(addDays(saleDate, 7), weeklyDay)
        : addDays(endOfWeek(saleDate), standardDelayDays);
      const date = iso(payoutDate);
      if (!isForecastDateEligible(date, businessDateKey)) return;
      buckets.set(date, (buckets.get(date) ?? 0) + weight);
    });
    const definitiveCombined = totals.forecastRemainder !== null;
    const allocation = definitiveCombined
      ? allocateForecastRemainder(
        totals.forecastRemainder!,
        [...buckets].sort(([left], [right]) => left.localeCompare(right))
          .map(([date, weight]) => ({
            id: `forecast:${cabinet.id}:${date}`,
            date,
            weight,
          })),
      )
      : { schedule: [], unallocatedForecastPayout: null };
    const reportSchedule: ScheduleRow[] = definitiveCombined
      ? confirmedPayouts.map((item) => ({
        id: payoutReportKey(item),
        date: item.estimatedReceiptDate,
        amount: Math.max(
          0,
          Math.round((
            item.amount
              - (reconciliation.receivedByReport.get(payoutReportKey(item)) ?? 0)
          ) * 100) / 100,
        ),
        source: "financial_report",
      }))
      : [];
    const payoutSchedule = mergePayoutSchedule(
      reportSchedule,
      allocation.schedule,
    ).filter((item) => item.amount > 0)
      .sort((left, right) => left.date.localeCompare(right.date));
    if (
      allocation.unallocatedForecastPayout !== null
      && allocation.unallocatedForecastPayout > 0
    ) {
      warnings.push(
        "Часть прогноза не распределена: нет будущих расчётных дат выплат",
      );
    }
    const remainingPayout = definitiveCombined
      ? Math.round((
        payoutSchedule.reduce((sum, item) => sum + item.amount, 0)
          + (allocation.unallocatedForecastPayout ?? 0)
      ) * 100) / 100
      : null;

    return NextResponse.json({
      marketplace: "ozon",
      cabinetId: cabinet.id,
      companyId,
      companyName: mapping.companyName,
      scope: resolved.scope.label,
      cabinets: allCabinets.scope.cabinets.map((item) => ({
        id: item.id,
        name: item.name,
      })),
      planRows,
      planSource: selectedPlan?.source ?? "none",
      planApproved: selectedPlan?.source === "approved_sales_plan",
      planRevenue: planRevenueCents / 100,
      plannedOrders,
      actualOrders,
      actualRevenue,
      actualDataStatus,
      expectedPayout: totals.expectedPayout,
      actualPayout: totals.actualPayout,
      forecastExpectedPayout: totals.forecastExpectedPayout,
      remainingPayout,
      unallocatedForecastPayout: allocation.unallocatedForecastPayout,
      payoutSchedule,
      confirmedPayouts,
      reportDataStatus,
      reconciliationDataStatus,
      forecastDataStatus,
      plannedPositiveRevenueRows: coverage.plannedPositiveRevenueRows,
      plannedPositiveRevenue: coverage.plannedPositiveRevenue,
      coveredPositiveRevenueRows: coverage.coveredPositiveRevenueRows,
      coveredPositiveRevenue: coverage.coveredPositiveRevenue,
      reconciliationQueue: reconciliation.unresolved.map((item) => {
        const payment = paymentRows.find((row) => row.id === item.bankReceiptId);
        return {
          ...item,
          date: payment?.date ?? "",
          name: payment?.name ?? "",
          paymentAmount: payment?.amount ?? 0,
        };
      }),
      mode,
      standardDelayDays,
      warnings: [...new Set(warnings)],
      dataNotices: [...new Set(dataNotices)],
    });
  } catch (error) {
    return NextResponse.json(
      { error: publicOzonForecastError(error) },
      { status: 503 },
    );
  }
}
