import { NextResponse } from "next/server";
import { fetchSales, fetchOrders, fetchStocks } from "@/lib/wb/client";
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

  try {
    const [sales, orders, stocks] = await Promise.allSettled([
      fetchSales(dateFrom, dateTo),
      fetchOrders(dateFrom),
      fetchStocks(),
    ]);

    if (sales.status === "fulfilled" && sales.value.data) {
      await setCache(cacheKey(["sales", dateFrom, dateTo, "10000", "0"]), sales.value.data);
    }
    if (orders.status === "fulfilled" && orders.value.data) {
      await setCache(cacheKey(["orders", dateFrom, "0"]), orders.value.data);
    }
    if (stocks.status === "fulfilled" && stocks.value.data) {
      await setCache(cacheKey(["stocks"]), stocks.value.data);
    }

    return NextResponse.json({ ok: true, synced_at: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
