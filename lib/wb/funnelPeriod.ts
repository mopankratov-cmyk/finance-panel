const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mskDate(offsetDays = 0, nowMs = Date.now()): Date {
  const date = new Date(nowMs + MSK_OFFSET_MS);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date;
}

export function syncFunnelPeriod(url: string, nowMs = Date.now()): { begin: string; end: string; mode: string } {
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

export function rotateFunnelTargets<T>(targets: readonly T[], dayOfYear: number): T[] {
  if (!targets.length) return [];
  const start = ((dayOfYear % targets.length) + targets.length) % targets.length;
  return targets.map((_, index) => targets[(start + index) % targets.length]);
}
