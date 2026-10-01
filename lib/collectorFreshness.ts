/**
 * Свежесть внешнего сборщика (Mac mini): полки и снимки выплат.
 *
 * Сборщики пишут ошибки только в свой лог на mini. 01.10.2026 выяснилось, что
 * полки стояли десять дней, а снимки выплат части кабинетов — тоже (умер узел
 * VPN, и запросы к панели не выходили), и в панели этого не было видно вовсе.
 * Отсюда — явная плашка, когда самый свежий снимок старше порога.
 */

export interface CollectorFreshness {
  /** Самый свежий снимок, ISO; null — снимков нет. */
  lastAt: string | null;
  /** Сколько часов назад; null — снимков нет. */
  hours: number | null;
  /** «меньше часа назад», «5 ч назад», «3 дн назад». */
  label: string;
  /** Сбор встал: снимки были, но самый свежий старше порога. */
  stalled: boolean;
}

/** Самая поздняя из дат; пустые и нечитаемые пропускаются. */
export function latestIso(values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const value of values) {
    const ms = Date.parse(String(value ?? ""));
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = new Date(ms).toISOString();
    }
  }
  return best;
}

export function collectorAgeLabel(hours: number): string {
  if (hours < 1) return "меньше часа назад";
  if (hours < 24) return `${Math.round(hours)} ч назад`;
  return `${Math.round(hours / 24)} дн назад`;
}

/**
 * `thresholdHours` — сколько без снимков ещё нормально. Без снимков вовсе это
 * не «встал»: кабинет может быть намеренно не подключён к сборщику.
 */
export function collectorFreshness(lastAt: string | null, thresholdHours: number, nowMs = Date.now()): CollectorFreshness {
  const ms = Date.parse(String(lastAt ?? ""));
  if (!lastAt || !Number.isFinite(ms)) return { lastAt: null, hours: null, label: "снимков нет", stalled: false };
  const hours = Math.max(0, (nowMs - ms) / 3_600_000);
  return { lastAt: new Date(ms).toISOString(), hours, label: collectorAgeLabel(hours), stalled: hours > thresholdHours };
}

/** Полки: плановые сборы 10:00 / 18:00 / 22:00 МСК, штатная пауза — 12 ч; сутки = пропущено два слота. */
export const SHELF_STALL_HOURS = 24;
/** Выплаты: агент ходит раз в 6 часов; сутки = четыре пропущенных прогона подряд. */
export const PAYOUT_STALL_HOURS = 24;
