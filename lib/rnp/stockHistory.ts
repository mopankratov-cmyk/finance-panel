import type { SupabaseClient } from "@supabase/supabase-js";
import { STOCK_SNAPSHOT_HOUR_MSK } from "@/lib/wb/realStock";

/**
 * Суточная история остатков для РНП.
 *
 * РНП показывал остаток точкой — только сегодняшний снимок, а прошлые дни были
 * пустыми, чтобы не выдавать сегодняшний остаток за вчерашний. Снимки же копятся
 * раз в четыре часа (wb_stocks_history), и ряд по дням из них собирается без
 * догадок. Как именно (фиксированный час, только успешные запуски, только «Склад
 * WB») — в комментарии к SQL-функции wb_stock_history_daily.
 */

export interface StockDayPosition {
  stock: number;
  inWayToClient: number;
  inWayFromClient: number;
}

export interface StockHistory {
  /** Час по Москве, на который взяты снимки. */
  hour: number;
  /** Дни, в которые снимок был. Артикула в таком дне нет — остаток нулевой. */
  covered: Set<string>;
  byNm: Map<number, Map<string, StockDayPosition>>;
}

const ZERO: StockDayPosition = { stock: 0, inWayToClient: 0, inWayFromClient: 0 };

/** Пустая история: кабинет без товаров ничего не теряет и не гасит историю сводки. */
export const emptyStockHistory = (): StockHistory => ({ hour: STOCK_SNAPSHOT_HOUR_MSK, covered: new Set(), byNm: new Map() });

/** Ответ функции wb_stock_history_daily → структура. Мусор вместо ответа — null. */
export function parseStockHistory(raw: unknown): StockHistory | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as { hour?: unknown; covered?: unknown; byNm?: unknown };
  if (!Array.isArray(source.covered) || !source.byNm || typeof source.byNm !== "object") return null;
  const byNm = new Map<number, Map<string, StockDayPosition>>();
  for (const [nm, days] of Object.entries(source.byNm as Record<string, Record<string, unknown>>)) {
    const nmId = Number(nm);
    if (!Number.isFinite(nmId) || !days || typeof days !== "object") continue;
    const perDay = new Map<string, StockDayPosition>();
    for (const [day, value] of Object.entries(days)) {
      if (!Array.isArray(value)) continue;
      perDay.set(day, { stock: Number(value[0] ?? 0), inWayToClient: Number(value[1] ?? 0), inWayFromClient: Number(value[2] ?? 0) });
    }
    byNm.set(nmId, perDay);
  }
  return {
    hour: Number(source.hour ?? STOCK_SNAPSHOT_HOUR_MSK),
    covered: new Set(source.covered.map(String)),
    byNm,
  };
}

/**
 * Читает историю за период. `null` — функции нет (миграция не применена) или
 * она упала: РНП тогда остаётся с остатком-точкой, как раньше, а не падает.
 */
export async function loadStockHistory(
  db: SupabaseClient,
  input: { cabinetId: string | null; from: string; to: string; nmIds: number[] | null },
): Promise<StockHistory | null> {
  const { data, error } = await db.rpc("wb_stock_history_daily", {
    p_cabinet: input.cabinetId,
    p_from: input.from,
    p_to: input.to,
    p_hour: STOCK_SNAPSHOT_HOUR_MSK,
    p_nm_ids: input.nmIds,
  });
  // Функции нет — миграция 202609220002 ещё не применена: остаток остаётся точкой, как раньше.
  if (error && (error.code === "42883" || error.code === "PGRST202")) return null;
  if (error) throw new Error(error.message);
  return parseStockHistory(data);
}

/** Сводка нескольких кабинетов: складывается по артикулу и дню; хоть один без истории — истории нет. */
export function mergeStockHistories(parts: readonly (StockHistory | null)[]): StockHistory | null {
  if (parts.length === 0 || parts.some((part) => part == null)) return null;
  const known = parts as StockHistory[];
  const covered = new Set<string>();
  const byNm = new Map<number, Map<string, StockDayPosition>>();
  for (const part of known) {
    for (const day of part.covered) covered.add(day);
    for (const [nmId, days] of part.byNm) {
      const merged = byNm.get(nmId) ?? new Map<string, StockDayPosition>();
      for (const [day, position] of days) {
        const current = merged.get(day) ?? ZERO;
        merged.set(day, {
          stock: current.stock + position.stock,
          inWayToClient: current.inWayToClient + position.inWayToClient,
          inWayFromClient: current.inWayFromClient + position.inWayFromClient,
        });
      }
      byNm.set(nmId, merged);
    }
  }
  return { hour: known[0].hour, covered, byNm };
}

/** Ряд одного дня для метрик: остаток, «в пути» и деньги в остатках. */
export interface StockSeriesDay extends StockDayPosition {
  money: number | null;
}

export interface StockSeries {
  /** Сегодня по Москве: сегодняшний день — живой остаток, а не снимок. */
  today: string;
  covered: ReadonlySet<string>;
  byDate: ReadonlyMap<string, StockSeriesDay>;
  hour: number;
}

/**
 * Ряд по одному артикулу. Деньги в остатках — как у точечной метрики: без
 * себестоимости при ненулевом остатке они неизвестны (null), а не ноль.
 */
export function stockSeriesForSku(history: StockHistory, nmId: number, cost: number, today: string): StockSeries {
  const perDay = history.byNm.get(nmId);
  const byDate = new Map<string, StockSeriesDay>();
  for (const day of history.covered) {
    const position = perDay?.get(day) ?? ZERO;
    byDate.set(day, {
      ...position,
      money: position.stock === 0 ? 0 : cost > 0 ? Math.round(position.stock * cost) : null,
    });
  }
  return { today, covered: history.covered, byDate, hour: history.hour };
}

/**
 * Ряд для сводки по набору артикулов. Деньги — сумма «остаток × себестоимость»;
 * артикул без себестоимости в сумму входит нулём, как в сегодняшней сводке.
 */
export function stockSeriesForSummary(
  history: StockHistory,
  nmIds: Iterable<number>,
  costByNm: ReadonlyMap<number, number | null>,
  today: string,
): StockSeries {
  const ids = [...nmIds];
  const byDate = new Map<string, StockSeriesDay>();
  for (const day of history.covered) {
    const total: StockSeriesDay = { stock: 0, inWayToClient: 0, inWayFromClient: 0, money: 0 };
    for (const nmId of ids) {
      const position = history.byNm.get(nmId)?.get(day);
      if (!position) continue;
      total.stock += position.stock;
      total.inWayToClient += position.inWayToClient;
      total.inWayFromClient += position.inWayFromClient;
      total.money = (total.money ?? 0) + position.stock * Number(costByNm.get(nmId) ?? 0);
    }
    total.money = Math.round(total.money ?? 0);
    byDate.set(day, total);
  }
  return { today, covered: history.covered, byDate, hour: history.hour };
}

/**
 * Значения метрики по дням периода.
 *  · сегодня — живой остаток (`current`): снимок часа ещё не сделан;
 *  · день со снимком — значение снимка (артикула в нём нет — ноль);
 *  · остальные дни — null: «неизвестно», а не ноль.
 */
export function stockDailySeries(
  days: readonly string[],
  series: StockSeries,
  current: number | null,
  pick: (day: StockSeriesDay) => number | null,
): (number | null)[] {
  return days.map((day) => {
    if (day === series.today) return current;
    if (!series.covered.has(day)) return null;
    return pick(series.byDate.get(day) ?? { stock: 0, inWayToClient: 0, inWayFromClient: 0, money: 0 });
  });
}
