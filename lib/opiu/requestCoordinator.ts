export interface WarehouseSavePayload {
  month: string;
  weekStart: string;
  amount: number;
}

interface ReportContext {
  month: string;
  refresh: boolean;
}

interface OpiuRequestCoordinatorOptions<TReport> {
  fetchReport: (
    month: string,
    refresh: boolean,
    signal: AbortSignal,
  ) => Promise<TReport>;
  writeWarehouse: (payload: WarehouseSavePayload) => Promise<void>;
  onReport: (report: TReport, context: ReportContext) => void;
  onError: (message: string) => void;
  onSavingChange: (
    payload: Readonly<WarehouseSavePayload>,
    pendingCount: number,
  ) => void;
  onReportStart?: (context: ReportContext) => void;
  onReportSettled?: (context: ReportContext) => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

let warehouseWriteTail: Promise<void> = Promise.resolve();

export function createOpiuRequestCoordinator<TReport>(
  options: OpiuRequestCoordinatorOptions<TReport>,
) {
  let mounted = true;
  let currentMonth: string | null = null;
  let reportGeneration = 0;
  let reportController: AbortController | null = null;
  const pendingByMonthWeek = new Map<string, number>();

  const isCurrentMonth = (month: string) =>
    mounted && currentMonth === month;

  const loadReport = async (month: string, refresh = false): Promise<void> => {
    const generation = ++reportGeneration;
    reportController?.abort();
    const controller = new AbortController();
    reportController = controller;
    const context = { month, refresh };

    if (isCurrentMonth(month)) options.onReportStart?.(context);

    try {
      const report = await options.fetchReport(month, refresh, controller.signal);
      if (
        isCurrentMonth(month)
        && generation === reportGeneration
      ) {
        options.onReport(report, context);
      }
    } catch (error) {
      if (
        isCurrentMonth(month)
        && generation === reportGeneration
        && !isAbortError(error)
      ) {
        options.onError(errorMessage(error, "Ошибка загрузки"));
      }
    } finally {
      if (
        isCurrentMonth(month)
        && generation === reportGeneration
      ) {
        options.onReportSettled?.(context);
      }
    }
  };

  const saveWarehouse = (input: WarehouseSavePayload): Promise<void> => {
    const payload = Object.freeze({
      month: input.month,
      weekStart: input.weekStart,
      amount: input.amount,
    });
    const savingKey = `${payload.month}:${payload.weekStart}`;
    const pendingCount = (pendingByMonthWeek.get(savingKey) ?? 0) + 1;
    pendingByMonthWeek.set(savingKey, pendingCount);
    if (mounted) options.onSavingChange(payload, pendingCount);

    const run = async () => {
      try {
        await options.writeWarehouse(payload);
        if (isCurrentMonth(payload.month)) {
          void loadReport(payload.month, false);
        }
      } catch (error) {
        if (isCurrentMonth(payload.month)) {
          options.onError(errorMessage(error, "Ошибка сохранения"));
        }
      } finally {
        const remaining = Math.max(
          0,
          (pendingByMonthWeek.get(savingKey) ?? 1) - 1,
        );
        if (remaining === 0) pendingByMonthWeek.delete(savingKey);
        else pendingByMonthWeek.set(savingKey, remaining);
        if (mounted) options.onSavingChange(payload, remaining);
      }
    };

    const completion = warehouseWriteTail.then(run, run);
    warehouseWriteTail = completion;
    return completion;
  };

  return {
    loadReport,
    saveWarehouse,
    activate() {
      mounted = true;
    },
    setMonth(month: string) {
      mounted = true;
      currentMonth = month;
      reportGeneration += 1;
      reportController?.abort();
    },
    dispose() {
      mounted = false;
      reportGeneration += 1;
      reportController?.abort();
    },
  };
}
