import type { OpiuReportPeriod } from "./reportSync";

export interface OpiuReportQueueState {
  cabinetId: string;
  status: string;
  updatedAt: string | null;
  state: Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * One cron invocation has enough runtime for one heavy WB report page batch.
 * Pick the cabinet furthest behind instead of starting every cabinet at once.
 *
 * A cursor in the current refresh window wins a tie: finishing an existing
 * backfill (notably the large Optima agency cabinet) is more useful than
 * opening another unfinished job. Fully completed cabinets naturally move to
 * the end until the requested dateTo advances on the next day.
 */
export function selectOpiuReportQueueCabinet(
  cabinetIds: readonly string[],
  states: readonly OpiuReportQueueState[],
  period: OpiuReportPeriod,
): string | null {
  const uniqueIds = [...new Set(cabinetIds.filter(Boolean))];
  if (!uniqueIds.length) return null;

  const byCabinet = new Map(states.map((state) => [state.cabinetId, state]));
  const ranked = uniqueIds.map((cabinetId, index) => {
    const sync = byCabinet.get(cabinetId);
    const sameWindow = text(sync?.state.periodDateFrom) === period.dateFrom;
    const completedThrough = sameWindow ? text(sync?.state.completedPeriodDateTo) : "";
    const complete = completedThrough >= period.dateTo;
    const hasProgress = sameWindow && (
      number(sync?.state.cursor) > 0
      || number(sync?.state.synced) > 0
      || sync?.status === "error"
      || sync?.status === "running"
    );
    const updatedAt = Date.parse(sync?.updatedAt ?? "");

    return {
      cabinetId,
      index,
      complete,
      completedThrough,
      hasProgress,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    };
  });

  ranked.sort((left, right) => {
    if (left.complete !== right.complete) return left.complete ? 1 : -1;
    if (left.completedThrough !== right.completedThrough) {
      return left.completedThrough.localeCompare(right.completedThrough);
    }
    if (left.hasProgress !== right.hasProgress) return left.hasProgress ? -1 : 1;
    if (left.updatedAt !== right.updatedAt) return left.updatedAt - right.updatedAt;
    return left.index - right.index;
  });

  return ranked[0]?.cabinetId ?? null;
}
