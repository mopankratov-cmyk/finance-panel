import { NextResponse } from "next/server";
import { fetchSales, fetchOrders, fetchStocks, fetchAds, fetchAdsStat } from "@/lib/wb/client";
import { setCache, cacheKey } from "@/lib/wb/cache";

export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  const dateFrom = from.toISOString().split("T")[0];
  const dateTo = to.toISOString().split("T")[0];

  const results: Record<string, string> = {};

  // Sales
  try {
    const sales = await fetchSales(dateFrom, dateTo);
    if (sales.data) {
      await setCache(cacheKey(["sales", dateFrom, dateTo, "10000", "0"]), sales.data);
      results.sales = "ok";
    } else {
      results.sales = sales.error ?? "no data";
    }
  } catch (e) { results.sales = String(e); }

  // Orders
  try {
    const orders = await fetchOrders(dateFrom);
    if (orders.data) {
      await setCache(cacheKey(["orders", dateFrom, "0"]), orders.data);
      results.orders = "ok";
    } else {
      results.orders = orders.error ?? "no data";
    }
  } catch (e) { results.orders = String(e); }

  // Stocks
  try {
    const stocks = await fetchStocks();
    if (stocks.data) {
      await setCache(cacheKey(["stocks"]), stocks.data);
      results.stocks = "ok";
    } else {
      results.stocks = stocks.error ?? "no data";
    }
  } catch (e) { results.stocks = String(e); }

  // Ads
  try {
    const ads = await fetchAds();
    if (ads.data) {
      await setCache(cacheKey(["ads"]), ads.data);
      results.ads = "ok";

      // Ads stats
      const advertIds: number[] = [];
      ads.data?.adverts?.forEach((a: { advert_list?: { advertId?: number }[] }) =>
        a.advert_list?.forEach((ad) => {
          if (ad.advertId) advertIds.push(ad.advertId);
        }),
      );
      if (advertIds.length > 0) {
        const adStats = await fetchAdsStat(advertIds.slice(0, 50));
        if (adStats.data) {
          await setCache(cacheKey(["adStats", advertIds.slice(0, 50).join(",")]), adStats.data);
          results.adStats = "ok";
        } else {
          results.adStats = adStats.error ?? "no data";
        }
      } else {
        results.adStats = "no ads";
      }
    } else {
      results.ads = ads.error ?? "no data";
    }
  } catch (e) { results.ads = String(e); }

  return NextResponse.json({ ok: true, synced_at: new Date().toISOString(), results });
}
