import { wbFetch } from "./fetch";
import { SALES_LIMIT, sevenDayRange, stocksDateFrom } from "./keys";
import {
  extractAdvertIds,
  type WbAdStat,
  type WbAdvertsResponse,
  type WbOrder,
  type WbReportRow,
  type WbStock,
} from "./types";

export interface WbLoadedData {
  sales: WbReportRow[];
  orders: WbOrder[];
  stocks: WbStock[];
  ads: WbAdvertsResponse | null;
  adStats: WbAdStat[];
  empty: boolean;
  error: string | null;
  timestamp: string;
  dateFrom: string;
  dateTo: string;
}

function filterOrdersInRange(
  orders: WbOrder[],
  dateFrom: string,
  dateTo: string,
): WbOrder[] {
  return orders.filter((o) => {
    const d = (o.date ?? "").slice(0, 10);
    return d >= dateFrom && d <= dateTo;
  });
}

export async function loadWbData(refresh = false): Promise<WbLoadedData> {
  const { dateFrom, dateTo } = sevenDayRange();
  const opts = { refresh };

  const salesUrl = new URL(
    "https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod",
  );
  salesUrl.searchParams.set("dateFrom", dateFrom);
  salesUrl.searchParams.set("dateTo", dateTo);
  salesUrl.searchParams.set("limit", SALES_LIMIT);
  salesUrl.searchParams.set("rrdid", "0");

  const ordersUrl = new URL(
    "https://statistics-api.wildberries.ru/api/v1/supplier/orders",
  );
  ordersUrl.searchParams.set("dateFrom", dateFrom);
  ordersUrl.searchParams.set("flag", "0");

  const stocksUrl = new URL(
    "https://statistics-api.wildberries.ru/api/v1/supplier/stocks",
  );
  stocksUrl.searchParams.set("dateFrom", stocksDateFrom());

  const adsUrl = "https://advert-api.wildberries.ru/api/advert/v2/adverts";

  const [salesRes, ordersRes, stocksRes, adsRes] = await Promise.all([
    wbFetch<WbReportRow[]>(salesUrl.toString(), { method: "GET" }, opts),
    wbFetch<WbOrder[]>(ordersUrl.toString(), { method: "GET" }, opts),
    wbFetch<WbStock[]>(stocksUrl.toString(), { method: "GET" }, opts),
    wbFetch<WbAdvertsResponse>(adsUrl, { method: "GET" }, opts),
  ]);

  const advertIds = extractAdvertIds(adsRes.data).slice(0, 50);
  let adStats: WbAdStat[] = [];
  let adStatsError: string | null = null;

  if (advertIds.length > 0) {
    const statUrl = new URL(
      "https://advert-api.wildberries.ru/adv/v3/fullstats",
    );
    statUrl.searchParams.set("ids", advertIds.join(","));
    statUrl.searchParams.set("beginDate", dateFrom);
    statUrl.searchParams.set("endDate", dateTo);

    const adStatsRes = await wbFetch<WbAdStat[]>(
      statUrl.toString(),
      { method: "GET" },
      opts,
    );
    adStats = adStatsRes.data ?? [];
    adStatsError = adStatsRes.error;
  }

  const sales = salesRes.data ?? [];
  const orders = filterOrdersInRange(ordersRes.data ?? [], dateFrom, dateTo);
  const stocks = stocksRes.data ?? [];
  const ads = adsRes.data ?? null;

  const error =
    salesRes.error ??
    ordersRes.error ??
    stocksRes.error ??
    adsRes.error ??
    adStatsError;

  const hasData = !!(
    sales.length ||
    orders.length ||
    stocks.length ||
    ads ||
    adStats.length
  );

  const timestamps = [
    salesRes.timestamp,
    ordersRes.timestamp,
    stocksRes.timestamp,
    adsRes.timestamp,
  ].map((t) => new Date(t).getTime());

  return {
    sales,
    orders,
    stocks,
    ads,
    adStats,
    empty: !hasData,
    error,
    timestamp: new Date(Math.max(...timestamps)).toISOString(),
    dateFrom,
    dateTo,
  };
}
