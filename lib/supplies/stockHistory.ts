import { moscowToday } from "@/lib/sync/moscowDay";
import type { WarehouseQty } from "./stockFilter";

/**
 * История остатка артикула из снимков `wb_stocks_history`.
 *
 * Снимок делается раз в четыре часа целиком (крон stocks-history) и пишет только
 * ненулевые строки: отсутствие пары «артикул — склад» в снимке означает ноль.
 * Из этого два следствия, ради которых модуль и существует:
 *
 * 1. День, когда остаток артикула был нулевым, в самой таблице вообще не
 *    отражён — строк нет. Отличить «остатка не было» от «снимок не делался»
 *    можно только по журналу запусков крона (`sync_log`, job stocks-history):
 *    есть успешный запуск, а у артикула в нём строк нет — значит, ноль.
 * 2. Неудавшийся запуск мог записать часть строк. Верить можно только снимкам
 *    успешных запусков.
 *
 * В таблицу — последний снимок каждых суток по Москве: на графике на 90 дней
 * шесть точек в день не читаются, а конец суток и есть «остаток на этот день».
 */

export interface HistoryRow {
  snapshot_at: string;
  warehouse: string;
  quantity: number | null;
  in_way_to_client: number | null;
  in_way_from_client: number | null;
}

export interface HistoryPoint {
  /** Дата по Москве, ГГГГ-ММ-ДД. */
  date: string;
  /** Момент снимка, ISO. */
  at: string;
  /** Остаток по складам; склады без товара не перечисляются. */
  byWarehouse: Record<string, number>;
  inWayToClient: number;
  inWayFromClient: number;
  /** Снимок подтверждён журналом крона. false — взят по строкам артикула без журнала. */
  confirmed: boolean;
}

/**
 * Периоды, когда снимки заведомо врут. Не восстановимы, поэтому не прячутся, а
 * подписываются на графике: пустота была бы честнее, но её не отличить от
 * реального нуля, а провал остатка «до нуля» читался бы как распродажа.
 *  · 28–31.08.2026 в снимках завышен in_way_*: агрегаты шли вперемешку с устаревшими складами;
 *  · 31.08–01.09.2026 по реальным складам лежат нули.
 */
export const UNRELIABLE_WINDOWS: { from: string; to: string; note: string }[] = [
  { from: "2026-08-28", to: "2026-09-01", note: "сбой источника остатков: в снимках завышены «в пути», а по складам местами нули" },
];

export function unreliableNote(date: string): string | null {
  return UNRELIABLE_WINDOWS.find((window) => date >= window.from && date <= window.to)?.note ?? null;
}

const SNAPSHOT_TOLERANCE_MS = 1_000;

/** Дата по Москве для момента ISO. */
export const mskDate = (iso: string): string => moscowToday(new Date(iso));

function pointFrom(rows: readonly HistoryRow[], date: string, at: string, confirmed: boolean): HistoryPoint {
  const byWarehouse: Record<string, number> = {};
  let inWayToClient = 0;
  let inWayFromClient = 0;
  for (const row of rows) {
    const quantity = Number(row.quantity ?? 0);
    if (quantity > 0) byWarehouse[row.warehouse] = (byWarehouse[row.warehouse] ?? 0) + quantity;
    inWayToClient += Number(row.in_way_to_client ?? 0);
    inWayFromClient += Number(row.in_way_from_client ?? 0);
  }
  return { date, at, byWarehouse, inWayToClient, inWayFromClient, confirmed };
}

/**
 * Точки истории по одной на московские сутки.
 * `runs` — моменты успешных запусков крона. Пусто (журнал недоступен) — берём
 * последний снимок суток по строкам самого артикула, с пометкой `confirmed: false`.
 */
export function dailyPoints(rows: readonly HistoryRow[], runs: readonly string[]): HistoryPoint[] {
  const lastRunByDate = new Map<string, string>();
  for (const run of runs) {
    const date = mskDate(run);
    const known = lastRunByDate.get(date);
    if (!known || Date.parse(run) > Date.parse(known)) lastRunByDate.set(date, run);
  }

  const rowsByDate = new Map<string, HistoryRow[]>();
  for (const row of rows) {
    const date = mskDate(row.snapshot_at);
    const list = rowsByDate.get(date) ?? [];
    list.push(row);
    rowsByDate.set(date, list);
  }

  const dates = [...new Set([...lastRunByDate.keys(), ...rowsByDate.keys()])].sort();
  const points: HistoryPoint[] = [];
  for (const date of dates) {
    const dayRows = rowsByDate.get(date) ?? [];
    const run = lastRunByDate.get(date);
    if (run) {
      const target = Date.parse(run);
      const snapshot = dayRows.filter((row) => Math.abs(Date.parse(row.snapshot_at) - target) <= SNAPSHOT_TOLERANCE_MS);
      // Запуск был, а строк у артикула в нём нет — остаток нулевой.
      points.push(pointFrom(snapshot, date, run, true));
      continue;
    }
    if (!dayRows.length) continue;
    const latest = dayRows.reduce((max, row) => (Date.parse(row.snapshot_at) > Date.parse(max) ? row.snapshot_at : max), dayRows[0].snapshot_at);
    points.push(pointFrom(dayRows.filter((row) => row.snapshot_at === latest), date, latest, false));
  }
  return points;
}

/** Остаток точки по выбранным складам; `null` — все. */
export function pointTotal(point: Pick<HistoryPoint, "byWarehouse">, selected: ReadonlySet<string> | null): number {
  return Object.entries(point.byWarehouse).reduce((sum, [warehouse, quantity]) => sum + (selected === null || selected.has(warehouse) ? quantity : 0), 0);
}

export interface HistoryLine {
  date: string;
  at: string;
  total: number;
  /** Разница с предыдущей точкой; null у первой. */
  delta: number | null;
  inWayToClient: number;
  top: WarehouseQty[];
  unreliable: string | null;
  confirmed: boolean;
}

/** Строки для таблицы и графика по выбранным складам, от старых к новым. */
export function historyLines(points: readonly HistoryPoint[], selected: ReadonlySet<string> | null): HistoryLine[] {
  return points.map((point, index) => {
    const total = pointTotal(point, selected);
    const previous = index > 0 ? pointTotal(points[index - 1], selected) : null;
    return {
      date: point.date,
      at: point.at,
      total,
      delta: previous == null ? null : total - previous,
      inWayToClient: point.inWayToClient,
      top: Object.entries(point.byWarehouse)
        .filter(([warehouse]) => selected === null || selected.has(warehouse))
        .map(([warehouse, quantity]) => ({ warehouse, quantity }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 3),
      unreliable: unreliableNote(point.date),
      confirmed: point.confirmed,
    };
  });
}
