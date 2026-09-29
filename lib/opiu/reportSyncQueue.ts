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

// Тик крона раз в час, MAX_PAGES_PER_CALL/SOFT_TIME_BUDGET_MS в syncReportRows.ts
// ограничивают один вызов ~40 страницами/3.5 минутами. Крупный агентский
// кабинет (Оптима, ~116k строк отчёта/день, окно ~45 дней) может проходить
// период НЕДЕЛЯМИ — до этого его completedPeriodDateTo навсегда остаётся
// самым старым среди кабинетов, и, поскольку крон берёт РОВНО один кабинет
// за тик, обычная сортировка по "кто отстаёт сильнее" отдавала ему слот
// каждый час подряд: остальные кабинеты не трогались вообще, пока Оптима
// сама не продвинется дальше их. STARVED_MS не даёт этому случиться —
// кабинет, который не синкали дольше этого срока, обгоняет обычный
// рейтинг независимо от completedPeriodDateTo.
const STARVED_MS = 3 * 60 * 60 * 1000;

/**
 * One cron invocation has enough runtime for one heavy WB report page batch.
 * Pick the cabinet furthest behind instead of starting every cabinet at once.
 *
 * A cursor in the current refresh window wins a tie: finishing an existing
 * backfill (notably the large Optima agency cabinet) is more useful than
 * opening another unfinished job. Fully completed cabinets naturally move to
 * the end until the requested dateTo advances on the next day.
 *
 * `now` обязателен (не Date.now() по умолчанию внутри функции) — иначе
 * поведение теста зависело бы от того, в какой момент его реально запустили,
 * а не от переданных фикстур.
 */
export function selectOpiuReportQueueCabinet(
  cabinetIds: readonly string[],
  states: readonly OpiuReportQueueState[],
  period: OpiuReportPeriod,
  now: number,
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
    const updatedAtMs = Number.isFinite(updatedAt) ? updatedAt : 0;

    return {
      cabinetId,
      index,
      complete,
      completedThrough,
      hasProgress,
      updatedAt: updatedAtMs,
      // Только среди незавершённых: завершённый сегодня кабинет ничего
      // нового не получит до завтрашнего сдвига dateTo, даже если его давно
      // не трогали — голодание тут не про что.
      starved: !complete && (now - updatedAtMs) > STARVED_MS,
    };
  });

  ranked.sort((left, right) => {
    if (left.complete !== right.complete) return left.complete ? 1 : -1;
    if (left.starved !== right.starved) return left.starved ? -1 : 1;
    if (left.completedThrough !== right.completedThrough) {
      return left.completedThrough.localeCompare(right.completedThrough);
    }
    if (left.hasProgress !== right.hasProgress) return left.hasProgress ? -1 : 1;
    if (left.updatedAt !== right.updatedAt) return left.updatedAt - right.updatedAt;
    return left.index - right.index;
  });

  return ranked[0]?.cabinetId ?? null;
}
