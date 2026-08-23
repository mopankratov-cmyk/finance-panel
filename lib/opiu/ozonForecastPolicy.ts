import type { PayoutReport } from "./payoutReconciliation";
import { ozonSellerFetch } from "@/lib/ozon/sellerGate";

export interface ScheduleRow {
  id: string;
  date: string;
  amount: number;
  source: "financial_report" | "forecast";
}

export const CASH_FLOW_PAGE_SIZE = 100;
export const CASH_FLOW_MAX_PAGES = 10;
export const CASH_FLOW_MAX_ROWS = CASH_FLOW_PAGE_SIZE * CASH_FLOW_MAX_PAGES;
export const PAYMENT_PAGE_SIZE = 200;
export const PAYMENT_MAX_PAGES = 10;

export function isSupportedForecastYear(year: number) {
  return Number.isInteger(year) && year >= 2020 && year <= 2100;
}

export function deriveReconciliationDataStatus(
  reportDataStatus: "available" | "degraded" | "not_selected",
  unresolved: Array<{
    reason: "unlinked" | "ambiguous" | "partial" | "over_allocation";
  }>,
) {
  if (reportDataStatus === "not_selected") return "not_selected" as const;
  return unresolved.length > 0 ? "degraded" as const : "available" as const;
}

export interface RequestDeadline {
  expiresAt: number;
}

export interface DeadlineOptions {
  now?: () => number;
  scheduleTimeout?: (callback: () => void, delay: number) => unknown;
  cancelTimeout?: (handle: unknown) => void;
  signal?: AbortSignal;
}

const numberOrZero = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;
const toCents = (value: number) => Math.max(0, Math.round(value * 100));
const fromCents = (value: number) => value / 100;

const MOSCOW_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Moscow",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function deriveMoscowBusinessDate(instant: Date) {
  const parts = MOSCOW_DATE_FORMATTER.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isForecastDateEligible(
  dateKey: string,
  businessDateKey: string,
) {
  return dateKey >= businessDateKey;
}

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function nextWeekday(date: Date, weekday: number) {
  return addDays(date, (weekday - date.getDay() + 7) % 7);
}

function parseIsoDate(value: unknown) {
  if (typeof value !== "string") return null;
  const grammar =
    /^(\d{4})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/;
  const grammarMatch = grammar.exec(value);
  if (!grammarMatch) return null;
  const sliced = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sliced);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  if (
    !Number.isFinite(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }
  return { iso: sliced, date };
}

export function parsePayoutRuleParams(
  weeklyDayValue: string | null,
  standardDelayDaysValue: string | null,
) {
  const parseBoundedInteger = (
    value: string | null,
    fallback: number,
    maximum: number,
  ) => {
    if (value === null || value.trim() === "") {
      return { ok: true as const, value: fallback };
    }
    if (!/^\d+$/.test(value)) return { ok: false as const };
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed <= maximum
      ? { ok: true as const, value: parsed }
      : { ok: false as const };
  };
  const weeklyDay = parseBoundedInteger(weeklyDayValue, 2, 6);
  const standardDelayDays = parseBoundedInteger(
    standardDelayDaysValue,
    24,
    60,
  );
  if (!weeklyDay.ok || !standardDelayDays.ok) {
    return {
      ok: false as const,
      error: "Некорректный параметр правила выплаты",
    };
  }
  return {
    ok: true as const,
    weeklyDay: weeklyDay.value,
    standardDelayDays: standardDelayDays.value,
  };
}

export function parsePayoutMode(value: string | null) {
  if (value === null || value === "standard") {
    return { ok: true as const, mode: "standard" as const };
  }
  if (value === "weekly") {
    return { ok: true as const, mode: "weekly" as const };
  }
  return {
    ok: false as const,
    error: "Некорректный режим выплаты",
  };
}

const OZON_FORECAST_QUERY_PARAMS = new Set([
  "year",
  "month",
  "mode",
  "weeklyDay",
  "standardDelayDays",
  "cabinet",
]);

export function validateOzonForecastQuery(searchParams: URLSearchParams) {
  for (const key of searchParams.keys()) {
    if (!OZON_FORECAST_QUERY_PARAMS.has(key)) {
      return { ok: false as const, error: "Неизвестный параметр запроса" };
    }
    if (searchParams.getAll(key).length !== 1) {
      return { ok: false as const, error: "Параметр запроса указан несколько раз" };
    }
  }
  return { ok: true as const };
}

export function publicOzonForecastError(_error: unknown) {
  return "Не удалось рассчитать прогноз Ozon";
}

export function createRequestDeadline(startedAt: number, budgetMs: number): RequestDeadline {
  return { expiresAt: startedAt + budgetMs };
}

export async function runWithDeadline<T>(
  deadline: RequestDeadline,
  stage: string,
  task: (signal: AbortSignal) => Promise<T>,
  options: DeadlineOptions = {},
) {
  const now = options.now ?? Date.now;
  const remainingMs = deadline.expiresAt - now();
  if (remainingMs <= 0) {
    throw new Error(`Истёк общий срок запроса до этапа ${stage}`);
  }
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  signal.throwIfAborted();
  const scheduleTimeout = options.scheduleTimeout ?? setTimeout;
  const cancelTimeout = options.cancelTimeout
    ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let timeoutHandle: unknown;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = scheduleTimeout(() => {
      controller.abort();
      reject(new Error(`Истёк общий срок запроса на этапе ${stage}`));
    }, remainingMs);
  });
  try {
    const aborted = options.signal
      ? new Promise<never>((_, reject) => {
        options.signal!.addEventListener(
          "abort",
          () => reject(options.signal!.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      })
      : null;
    return await Promise.race([
      task(signal),
      timeout,
      ...(aborted ? [aborted] : []),
    ]);
  } finally {
    if (timeoutHandle !== undefined) cancelTimeout(timeoutHandle);
  }
}

export function assessForecastCoverage(
  providerOk: boolean,
  rows: Array<{ revenue: number; covered: boolean }>,
) {
  const positiveRows = rows.filter((row) => toCents(row.revenue) > 0);
  const coveredRows = positiveRows.filter((row) => row.covered);
  return {
    forecastDataStatus: (
      providerOk && coveredRows.length === positiveRows.length
        ? "available"
        : "degraded"
    ) as "available" | "degraded",
    plannedPositiveRevenueRows: positiveRows.length,
    plannedPositiveRevenue: fromCents(
      positiveRows.reduce((sum, row) => sum + toCents(row.revenue), 0),
    ),
    coveredPositiveRevenueRows: coveredRows.length,
    coveredPositiveRevenue: fromCents(
      coveredRows.reduce((sum, row) => sum + toCents(row.revenue), 0),
    ),
  };
}

export const OZON_PROVIDER_ROW_CAP = 20_000;

export function assessCappedProviderRows(providerOk: boolean, rowCount: number) {
  return {
    status: providerOk && rowCount < OZON_PROVIDER_ROW_CAP
      ? "available" as const
      : "degraded" as const,
  };
}

type Tariff = {
  commissionPct: number;
  logistics: number;
  acquiring: number;
};

function isCredibleTariff(tariff: Tariff | null | undefined): tariff is Tariff {
  return Boolean(
    tariff
    && Number.isFinite(tariff.commissionPct)
    && tariff.commissionPct > 0
    && tariff.commissionPct <= 100
    && Number.isFinite(tariff.logistics)
    && tariff.logistics > 0
    && Number.isFinite(tariff.acquiring)
    && tariff.acquiring > 0,
  );
}

export function assessTariffCoverage(
  providerOk: boolean,
  providerRowCount: number,
  rows: Array<{ revenue: number; tariff: Tariff | null | undefined }>,
) {
  const providerComplete =
    assessCappedProviderRows(providerOk, providerRowCount).status === "available";
  return assessForecastCoverage(
    providerComplete,
    rows.map((row) => ({
      revenue: row.revenue,
      covered: isCredibleTariff(row.tariff),
    })),
  );
}

export function deriveDefinitivePayout({
  forecastDataStatus,
  reportDataStatus,
  reconciliationDataStatus = "available",
  expectedPayout,
  reports,
  receivedByReport,
}: {
  forecastDataStatus: "available" | "degraded";
  reportDataStatus: "available" | "degraded" | "not_selected";
  reconciliationDataStatus?: "available" | "degraded" | "not_selected";
  expectedPayout: number;
  reports: Array<{ key: string; amount: number }>;
  receivedByReport: Map<string, number>;
}) {
  const reportAvailable =
    reportDataStatus === "available" && reconciliationDataStatus === "available";
  const forecastAvailable = forecastDataStatus === "available";
  const actualCents = reportAvailable
    ? [...receivedByReport.values()].reduce((sum, amount) => sum + toCents(amount), 0)
    : null;
  const outstandingCents = reportAvailable
    ? reports.reduce(
      (sum, report) => sum + Math.max(
        0,
        toCents(report.amount) - toCents(receivedByReport.get(report.key) ?? 0),
      ),
      0,
    )
    : null;
  const expectedCents = forecastAvailable ? toCents(expectedPayout) : null;
  const forecastExpectedCents = expectedCents !== null && actualCents !== null
    ? Math.max(0, expectedCents - actualCents)
    : null;
  const forecastRemainderCents =
    forecastExpectedCents !== null && outstandingCents !== null
      ? Math.max(0, forecastExpectedCents - outstandingCents)
      : null;

  return {
    expectedPayout: expectedCents === null ? null : fromCents(expectedCents),
    actualPayout: actualCents === null ? null : fromCents(actualCents),
    forecastExpectedPayout:
      forecastExpectedCents === null ? null : fromCents(forecastExpectedCents),
    confirmedOutstanding:
      outstandingCents === null ? null : fromCents(outstandingCents),
    forecastRemainder:
      forecastRemainderCents === null ? null : fromCents(forecastRemainderCents),
  };
}

export function classifyActualPeriod(
  year: number,
  month: number,
  businessDateKey: string,
) {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = iso(new Date(year, month, 0, 12));
  if (from > businessDateKey) {
    return {
      status: "not_started" as const,
      range: null,
    };
  }
  return {
    status: "available" as const,
    range: {
      from,
      to: to < businessDateKey ? to : businessDateKey,
    },
  };
}

interface PaymentReadResult {
  data: Record<string, unknown>[] | null;
  error: unknown;
}

interface PaymentReadQuery {
  select(columns: string): PaymentReadQuery;
  eq(column: string, value: unknown): PaymentReadQuery;
  gt(column: string, value: unknown): PaymentReadQuery;
  gte(column: string, value: unknown): PaymentReadQuery;
  lte(column: string, value: unknown): PaymentReadQuery;
  order(column: string, options?: { ascending: boolean }): PaymentReadQuery;
  abortSignal?(signal: AbortSignal): PaymentReadQuery;
  range(from: number, to: number): Promise<PaymentReadResult>;
}

export interface PaymentReadDatabase {
  from(table: string): PaymentReadQuery;
}

export async function loadBoundedPaymentRows(
  db: PaymentReadDatabase,
  accountId: string,
  selectedStart: Date,
  selectedEnd: Date,
  maxDelayDays: number,
  options: { signal?: AbortSignal } = {},
) {
  // Covers reports beginning before the selected month and bank settlement lag
  // after its latest possible calculated payout date.
  const boundedFrom = iso(addDays(selectedStart, -31));
  const boundedTo = iso(addDays(selectedEnd, maxDelayDays + 31));
  const rows: Record<string, unknown>[] = [];

  for (let page = 0; page < PAYMENT_MAX_PAGES; page += 1) {
    options.signal?.throwIfAborted();
    const from = page * PAYMENT_PAGE_SIZE;
    let query = db
      .from("payments")
      .select("id,date,name,amount,status,comment,company_id,category,counterparty,account_id")
      .eq("account_id", accountId)
      .eq("status", "done")
      .gt("amount", 0)
      .gte("date", boundedFrom)
      .lte("date", boundedTo)
      .order("date", { ascending: true })
      .order("id", { ascending: true });
    if (options.signal) {
      if (!query.abortSignal) throw new Error("Чтение платежей не поддерживает отмену");
      query = query.abortSignal(options.signal);
    }
    const result = await query.range(from, from + PAYMENT_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    const pageRows = result.data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < PAYMENT_PAGE_SIZE) return rows;
  }

  throw new Error("Данные платежей неполные: достигнут лимит сверки");
}

export function reportBelongsToMonth(
  report: Pick<PayoutReport, "periodTo">,
  year: number,
  month: number,
) {
  return report.periodTo.slice(0, 7) === `${year}-${String(month).padStart(2, "0")}`;
}

export async function loadOzonCashFlowReports({
  creds,
  from,
  to,
  rules,
  identity,
  // По умолчанию — через ворота кабинета: отчёты о движении денег читаются
  // постранично и делят лимит Ozon со всеми остальными запросами кабинета.
  fetchImpl = (input, init) => ozonSellerFetch(creds.clientId, String(input), init),
  deadline,
  deadlineOptions,
}: {
  creds: { clientId: string; apiKey: string };
  from: Date;
  to: Date;
  rules: { mode: "standard" | "weekly"; weeklyDay: number; standardDelayDays: number };
  identity: { cabinetId: string; companyId: string };
  fetchImpl?: typeof fetch;
  deadline?: RequestDeadline;
  deadlineOptions?: DeadlineOptions;
}) {
  const reportsById = new Map<string, PayoutReport>();
  let rejectedRows = 0;
  let fetchedRows = 0;
  let expectedPageCount: number | null = null;

  for (let page = 1; page <= (expectedPageCount ?? 1); page += 1) {
    if (page > CASH_FLOW_MAX_PAGES) {
      throw new Error("Ozon превысил лимит страниц финансовых отчётов");
    }
    const pageDeadline = deadline ?? createRequestDeadline(Date.now(), 20_000);
    const payload = await runWithDeadline(
      pageDeadline,
      `cash-flow page ${page}`,
      async (signal) => {
        const response = await fetchImpl(
          "https://api-seller.ozon.ru/v1/finance/cash-flow-statement/list",
          {
            method: "POST",
            headers: {
              "Client-Id": creds.clientId.trim(),
              "Api-Key": creds.apiKey.trim(),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              page,
              page_size: CASH_FLOW_PAGE_SIZE,
              date: { from: from.toISOString(), to: to.toISOString() },
              with_details: true,
            }),
            signal,
            cache: "no-store",
          },
        );
        if (!response.ok) {
          throw new Error(`Ozon не вернул финансовые отчёты, страница ${page}`);
        }
        return await response.json() as {
          result?: { details?: unknown; page_count?: number; pageCount?: number };
        };
      },
      deadlineOptions,
    );
    const rawPageCount = payload.result?.page_count ?? payload.result?.pageCount;
    if (
      typeof rawPageCount !== "number"
      || !Number.isFinite(rawPageCount)
      || !Number.isInteger(rawPageCount)
      || rawPageCount < 1
    ) {
      throw new Error("Ozon вернул неполные данные: некорректное число страниц");
    }
    const declaredPageCount = rawPageCount;
    if (declaredPageCount > CASH_FLOW_MAX_PAGES) {
      throw new Error("Ozon превысил лимит страниц финансовых отчётов");
    }
    if (expectedPageCount === null) {
      expectedPageCount = declaredPageCount;
    } else if (declaredPageCount !== expectedPageCount) {
      throw new Error("Ozon вернул неполные данные: число страниц изменилось");
    }
    const rawDetails = payload.result?.details;
    const details = Array.isArray(rawDetails)
      ? rawDetails
      : rawDetails
        ? [rawDetails]
        : [];
    if (details.length > CASH_FLOW_PAGE_SIZE) {
      throw new Error("Ozon превысил размер страницы финансовых отчётов");
    }
    if (page < declaredPageCount && details.length !== CASH_FLOW_PAGE_SIZE) {
      throw new Error("Ozon вернул неполные страницы финансовых отчётов");
    }
    fetchedRows += details.length;
    if (fetchedRows > CASH_FLOW_MAX_ROWS) {
      throw new Error("Ozon превысил лимит строк финансовых отчётов");
    }

    for (const raw of details) {
      if (!raw || typeof raw !== "object") {
        rejectedRows += 1;
        continue;
      }
      const detail = raw as {
        payments?: { payment?: number | string };
        period?: { id?: number | string; begin?: string; end?: string };
      };
      const reportId = String(detail.period?.id ?? "").trim();
      const amount = numberOrZero(detail.payments?.payment);
      if (amount <= 0) continue;
      const parsedFrom = parseIsoDate(detail.period?.begin);
      const parsedTo = parseIsoDate(detail.period?.end);
      if (
        !reportId
        || !parsedFrom
        || !parsedTo
        || parsedFrom.iso > parsedTo.iso
      ) {
        rejectedRows += 1;
        continue;
      }
      const periodEnd = parsedTo.date;
      const estimatedReceiptDate = rules.mode === "weekly"
        ? nextWeekday(addDays(periodEnd, 1), rules.weeklyDay)
        : addDays(periodEnd, rules.standardDelayDays);
      if (!Number.isFinite(estimatedReceiptDate.getTime())) {
        rejectedRows += 1;
        continue;
      }
      reportsById.set(reportId, {
        marketplace: "ozon",
        ...identity,
        reportId,
        periodFrom: parsedFrom.iso,
        periodTo: parsedTo.iso,
        amount,
        estimatedReceiptDate: iso(estimatedReceiptDate),
        state: "report_confirmed",
      });
    }
  }

  return {
    reports: [...reportsById.values()],
    rejectedRows,
    degraded: rejectedRows > 0,
  };
}

export function mergePayoutSchedule(
  reports: ScheduleRow[],
  forecast: ScheduleRow[],
) {
  return [...reports, ...forecast];
}

export function allocateForecastRemainder(
  remainder: number,
  buckets: Array<{ id: string; date: string; weight: number }>,
) {
  const targetCents = Math.max(0, Math.round(remainder * 100));
  const totalWeight = buckets.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (buckets.length === 0 || totalWeight <= 0) {
    return {
      schedule: [],
      unallocatedForecastPayout: targetCents / 100,
    };
  }

  let allocatedCents = 0;
  const schedule: ScheduleRow[] = buckets.map((item, index) => {
    const amountCents = index === buckets.length - 1
      ? targetCents - allocatedCents
      : Math.min(
        targetCents - allocatedCents,
        Math.round(targetCents * Math.max(0, item.weight) / totalWeight),
      );
    allocatedCents += amountCents;
    return {
      id: item.id,
      date: item.date,
      amount: amountCents / 100,
      source: "forecast",
    };
  });

  return { schedule, unallocatedForecastPayout: 0 };
}
