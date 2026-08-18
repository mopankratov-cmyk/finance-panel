export interface WbFunnelMetricRow {
  nm_id: number;
  date: string;
  open_card: number;
  add_to_cart: number;
  orders: number;
  orders_sum: number;
}

export interface WbAdMetricRow {
  nm_id: number;
  date: string;
  views: number;
  clicks: number;
  spent: number;
}

type DayMetrics = Record<number, Record<string, Record<string, number | null>>>;
type Accumulator = {
  views: number;
  clicks: number;
  spent: number;
  openCard: number;
  carts: number;
  orders: number;
  ordersSum: number;
  hasAd: boolean;
  hasFunnel: boolean;
};

const finiteNumber = (value: number) => Number.isFinite(value) ? value : 0;

export function percentRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

export function buildWbFunnelDayMetrics(
  funnelRows: WbFunnelMetricRow[],
  adRows: WbAdMetricRow[],
): DayMetrics {
  const accumulators = new Map<string, Accumulator>();
  const accumulator = (nmId: number, date: string) => {
    const iso = String(date).slice(0, 10);
    const key = `${nmId}:${iso}`;
    let value = accumulators.get(key);
    if (!value) {
      value = { views: 0, clicks: 0, spent: 0, openCard: 0, carts: 0, orders: 0, ordersSum: 0, hasAd: false, hasFunnel: false };
      accumulators.set(key, value);
    }
    return { iso, value };
  };

  for (const row of adRows) {
    const { value } = accumulator(row.nm_id, row.date);
    value.views += finiteNumber(row.views);
    value.clicks += finiteNumber(row.clicks);
    value.spent += finiteNumber(row.spent);
    value.hasAd = true;
  }
  for (const row of funnelRows) {
    const { value } = accumulator(row.nm_id, row.date);
    value.openCard += finiteNumber(row.open_card);
    value.carts += finiteNumber(row.add_to_cart);
    value.orders += finiteNumber(row.orders);
    value.ordersSum += finiteNumber(row.orders_sum);
    value.hasFunnel = true;
  }

  const metrics: DayMetrics = {};
  for (const [key, value] of accumulators) {
    const separator = key.indexOf(":");
    const nmId = Number(key.slice(0, separator));
    const iso = key.slice(separator + 1);
    const cell: Record<string, number | null> = {};
    if (value.hasAd) {
      cell.views = value.views;
      cell.clicks = value.clicks;
      cell.advert_sum = Math.round(value.spent);
      cell.ctr = percentRatio(value.clicks, value.views);
    }
    if (value.hasFunnel) {
      cell.open_card = value.openCard;
      cell.carts = value.carts;
      cell.orders_count = value.orders;
      cell.orders_sum = Math.round(value.ordersSum);
      cell.cart_cr = percentRatio(value.carts, value.openCard);
      cell.cr = percentRatio(value.orders, value.carts);
      cell.drr = percentRatio(value.spent, value.ordersSum);
    }
    (metrics[nmId] ||= {})[iso] = cell;
  }
  return metrics;
}

export const FUNNEL_MAX_PERIOD_DAYS = 90;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1_000;

export interface FunnelPeriod { start: string; end: string; days: number }
export type FunnelPeriodResolution = { ok: true; period: FunnelPeriod | null } | { ok: false; error: string };

// Обратная сверка нужна из-за «2026-02-31»: такую дату Date.parse принимает и
// молча переносит на март — календарно несуществующий день должен быть ошибкой.
const utcMsOf = (iso: string) => {
  if (!ISO_DATE_RE.test(iso)) return Number.NaN;
  const parsed = Date.parse(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return new Date(parsed).toISOString().slice(0, 10) === iso ? parsed : Number.NaN;
};

/** Дни периода включительно. Считаем в UTC: локальная зона сервера и браузера не должна двигать календарь. */
export function funnelPeriodDates(start: string, end: string): string[] {
  const first = utcMsOf(start);
  const last = utcMsOf(end);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return [];
  const dates: string[] = [];
  for (let ms = first; ms <= last; ms += DAY_MS) dates.push(new Date(ms).toISOString().slice(0, 10));
  return dates;
}

/**
 * Период воронки из ?date_from/?date_to. Обе границы пустые — не ошибка, а дефолт
 * (пресет ?days=/?window=), поэтому period=null. Всё остальное разбирается строго:
 * молча подменять запрошенный период соседним нельзя — экран подпишет не те дни.
 */
export function resolveFunnelPeriod(from: string | null | undefined, to: string | null | undefined): FunnelPeriodResolution {
  const start = (from ?? "").trim();
  const end = (to ?? "").trim();
  if (!start && !end) return { ok: true, period: null };
  if (!start || !end) return { ok: false, error: "Период задаётся парой date_from и date_to — одна граница без второй не принимается" };
  const first = utcMsOf(start);
  const last = utcMsOf(end);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return { ok: false, error: "Даты периода нужны в формате ГГГГ-ММ-ДД" };
  if (last < first) return { ok: false, error: "Начало периода позже его конца" };
  const days = Math.round((last - first) / DAY_MS) + 1;
  if (days > FUNNEL_MAX_PERIOD_DAYS) return { ok: false, error: `Период не больше ${FUNNEL_MAX_PERIOD_DAYS} дней, запрошено ${days}` };
  return { ok: true, period: { start, end, days } };
}

/** Экран не даёт запросить больше предела API: режем начало, а не конец — свежие дни важнее. */
export function clampFunnelPeriod(from: string, to: string): { from: string; to: string; clamped: boolean } {
  const dates = funnelPeriodDates(from, to);
  if (!dates.length || dates.length <= FUNNEL_MAX_PERIOD_DAYS) return { from, to, clamped: false };
  return { from: dates[dates.length - FUNNEL_MAX_PERIOD_DAYS], to, clamped: true };
}
