import { closedMoscowDates } from "@/lib/wb/sklejki";

export const WB_MARKET_DEFAULT_DAYS = 30;
export const WB_MARKET_DEFAULT_GRAN = "day";

export function wbMarketClosedDateRange(days = WB_MARKET_DEFAULT_DAYS, nowMs = Date.now()) {
  const dates = closedMoscowDates(days, nowMs);
  return {
    dateFrom: dates[0] ?? "",
    dateTo: dates[dates.length - 1] ?? "",
  };
}
