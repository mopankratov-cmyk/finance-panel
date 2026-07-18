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
