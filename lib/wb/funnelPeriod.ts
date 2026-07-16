const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

export interface FunnelSyncPeriod { begin: string; end: string; mode: string }
export interface FunnelCoverageRow { nm_id: number; date: string }

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mskDate(offsetDays = 0, nowMs = Date.now()): Date {
  const date = new Date(nowMs + MSK_OFFSET_MS);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date;
}

export function syncFunnelPeriod(url: string, nowMs = Date.now()): FunnelSyncPeriod {
  const params = new URL(url).searchParams;
  const forcedFrom = params.get("from");
  const forcedTo = params.get("to");
  if (forcedFrom && forcedTo) return { begin: forcedFrom, end: forcedTo, mode: "manual" };

  const yesterday = mskDate(-1, nowMs);
  const todayMsk = mskDate(0, nowMs);
  const mode = params.get("period") ?? "auto";
  const weeklyRecovery = mode === "month" || (mode === "auto" && todayMsk.getUTCDay() === 1);

  // WB history API принимает максимум 7 дней. Раньше по понедельникам отправлялся
  // весь текущий месяц и все кабинеты получали 400 "invalid start day: excess limit".
  // Глубокую историю восстанавливает отдельный async /api/sync/history.
  if (weeklyRecovery || mode === "7d") {
    const begin = new Date(yesterday);
    begin.setUTCDate(begin.getUTCDate() - 6);
    return {
      begin: dateOnly(begin),
      end: dateOnly(yesterday),
      mode: weeklyRecovery ? "7d-recovery" : "7d",
    };
  }

  return { begin: dateOnly(yesterday), end: dateOnly(yesterday), mode: "yesterday" };
}

/**
 * Находит первую неполную дату для текущего батча SKU и возвращает допустимое
 * WB-окно до семи дней. Так ежедневный синк постепенно чинит календарные дыры,
 * а не считает обход SKU достаточным признаком полной истории.
 */
export function funnelGapRecoveryPeriod(
  closedDates: string[],
  nmIds: number[],
  rows: FunnelCoverageRow[],
  fallback: FunnelSyncPeriod,
): FunnelSyncPeriod {
  if (fallback.mode === "manual" || !closedDates.length || !nmIds.length) return fallback;

  const expected = new Set(nmIds);
  const coverage = new Map<string, Set<number>>();
  for (const row of rows) {
    const date = String(row.date).slice(0, 10);
    if (!expected.has(Number(row.nm_id)) || !closedDates.includes(date)) continue;
    const covered = coverage.get(date) ?? new Set<number>();
    covered.add(Number(row.nm_id));
    coverage.set(date, covered);
  }

  const missingIndex = closedDates.findIndex((date) => (coverage.get(date)?.size ?? 0) < expected.size);
  if (missingIndex < 0) return fallback;
  return {
    begin: closedDates[missingIndex],
    end: closedDates[Math.min(missingIndex + 6, closedDates.length - 1)],
    mode: "gap-recovery",
  };
}

export function rotateFunnelTargets<T>(targets: readonly T[], dayOfYear: number): T[] {
  if (!targets.length) return [];
  const start = ((dayOfYear % targets.length) + targets.length) % targets.length;
  return targets.map((_, index) => targets[(start + index) % targets.length]);
}

export async function runFunnelTargetsConcurrently<T>(
  targets: readonly T[],
  worker: (target: T) => Promise<void>,
): Promise<void> {
  await Promise.all(targets.map(worker));
}
