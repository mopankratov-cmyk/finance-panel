import type { WbAdCount, WbAdStat, WbApiResponse, WbOrder, WbReportRow, WbStock } from "./types";

async function fetchApi<T>(path: string, init?: RequestInit): Promise<WbApiResponse<T>> {
  const res = await fetch(path, { ...init, cache: "no-store" });
  return res.json() as Promise<WbApiResponse<T>>;
}

export async function fetchSales(
  dateFrom: string,
  dateTo: string,
): Promise<WbApiResponse<WbReportRow[]>> {
  const params = new URLSearchParams({ dateFrom, dateTo, limit: "100000", rrdid: "0" });
  return fetchApi(`/api/wb/sales?${params}`);
}

export async function fetchOrders(dateFrom: string): Promise<WbApiResponse<WbOrder[]>> {
  const params = new URLSearchParams({ dateFrom, flag: "0" });
  return fetchApi(`/api/wb/orders?${params}`);
}

export async function fetchStocks(): Promise<WbApiResponse<WbStock[]>> {
  return fetchApi("/api/wb/stocks");
}

export async function fetchAds(): Promise<WbApiResponse<WbAdCount>> {
  return fetchApi("/api/wb/ads");
}

export async function fetchAdsStat(ids: number[]): Promise<WbApiResponse<WbAdStat[]>> {
  return fetchApi("/api/wb/ads-stat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ids),
  });
}

export async function fetchAllWbData(dateFrom: string, dateTo: string) {
  const ordersFrom = dateFrom;
  const [sales, orders, stocks, ads] = await Promise.all([
    fetchSales(dateFrom, dateTo),
    fetchOrders(ordersFrom),
    fetchStocks(),
    fetchAds(),
  ]);

  let adStats: WbApiResponse<WbAdStat[]> = {
    data: [],
    error: null,
    timestamp: new Date().toISOString(),
  };

  const advertIds: number[] = [];
  ads.data?.adverts?.forEach((a) =>
    a.advert_list?.forEach((ad) => {
      if (ad.advertId) advertIds.push(ad.advertId);
    }),
  );

  if (advertIds.length > 0) {
    adStats = await fetchAdsStat(advertIds.slice(0, 50));
  }

  const timestamps = [sales.timestamp, orders.timestamp, stocks.timestamp, ads.timestamp, adStats.timestamp];
  const latest = timestamps.sort().reverse()[0];

  const error =
    sales.error ?? orders.error ?? stocks.error ?? ads.error ?? adStats.error ?? null;

  return {
    sales: sales.data ?? [],
    orders: orders.data ?? [],
    stocks: stocks.data ?? [],
    ads: ads.data,
    adStats: adStats.data ?? [],
    error,
    timestamp: latest,
  };
}
