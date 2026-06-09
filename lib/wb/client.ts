import type { WbAdCount, WbAdStat, WbApiResponse, WbOrder, WbReportRow, WbStock } from "./types";

const TIMEOUT_MS = 15000;

async function fetchApi<T>(path: string, init?: RequestInit): Promise<WbApiResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(path, { ...init, cache: "no-store", signal: controller.signal });
    clearTimeout(timer);
    return res.json() as Promise<WbApiResponse<T>>;
  } catch (e: unknown) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return { data: null as T, error: `Timeout/network: ${msg}`, timestamp: new Date().toISOString() };
  }
}

export async function fetchSales(
  dateFrom: string,
  dateTo: string,
): Promise<WbApiResponse<WbReportRow[]>> {
  const params = new URLSearchParams({ dateFrom, dateTo, limit: "10000", rrdid: "0" });
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
  const results = await Promise.allSettled([
    fetchSales(dateFrom, dateTo),
    fetchOrders(dateFrom),
    fetchStocks(),
    fetchAds(),
  ]);

  const sales = results[0].status === "fulfilled" ? results[0].value : { data: [], error: "Sales fetch failed", timestamp: new Date().toISOString() };
  const orders = results[1].status === "fulfilled" ? results[1].value : { data: [], error: null, timestamp: new Date().toISOString() };
  const stocks = results[2].status === "fulfilled" ? results[2].value : { data: [], error: null, timestamp: new Date().toISOString() };
  const ads = results[3].status === "fulfilled" ? results[3].value : { data: null, error: null, timestamp: new Date().toISOString() };

  let adStats: WbApiResponse<WbAdStat[]> = {
    data: [],
    error: null,
    timestamp: new Date().toISOString(),
  };
  const advertIds: number[] = [];
  ads.data?.adverts?.forEach((a: { advert_list?: { advertId?: number }[] }) =>
    a.advert_list?.forEach((ad) => {
      if (ad.advertId) advertIds.push(ad.advertId);
    }),
  );
  if (advertIds.length > 0) {
    adStats = await fetchAdsStat(advertIds.slice(0, 50));
  }

  const timestamps = [sales.timestamp, orders.timestamp, stocks.timestamp, ads.timestamp, adStats.timestamp];
  const latest = timestamps.sort().reverse()[0];
  const error = sales.error ?? orders.error ?? stocks.error ?? ads.error ?? adStats.error ?? null;

  return {
    sales: (sales.data as WbReportRow[]) ?? [],
    orders: (orders.data as WbOrder[]) ?? [],
    stocks: (stocks.data as WbStock[]) ?? [],
    ads: ads.data as WbAdCount | null,
    adStats: (adStats.data as WbAdStat[]) ?? [],
    error,
    timestamp: latest,
  };
}
