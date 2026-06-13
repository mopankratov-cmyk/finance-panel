import { NextRequest, NextResponse } from "next/server";
import { getActiveOzonCreds } from "@/lib/ozon/cabinet";
import { ozonImages, ozonStocks, type OzonCreds } from "@/lib/ozon/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE = "https://api-seller.ozon.ru";
const WEEKDAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

// analytics/data с разбивкой [day, sku] (постранично).
async function fetchDaySku(c: OzonCreds, from: string, to: string) {
  const rows: { sku: string; name: string; day: string; views: number; cart: number; orders: number; revenue: number }[] = [];
  for (let offset = 0; offset < 5000; offset += 1000) {
    const res = await fetch(`${BASE}/v1/analytics/data`, {
      method: "POST",
      headers: { "Client-Id": c.clientId, "Api-Key": c.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        date_from: from, date_to: to,
        metrics: ["hits_view", "hits_tocart", "ordered_units", "revenue"],
        dimension: ["sku", "day"], limit: 1000, offset,
      }),
      next: { revalidate: 1800 },
    });
    if (!res.ok) {
      if (offset === 0) throw new Error(`Ozon ${res.status}: ${(await res.text()).slice(0, 120)}`);
      break;
    }
    const j = (await res.json()) as { result?: { data?: { dimensions: { id: string; name: string }[]; metrics: number[] }[] } };
    const batch = j.result?.data ?? [];
    for (const d of batch) rows.push({
      sku: d.dimensions[0]?.id ?? "", name: d.dimensions[0]?.name ?? "",
      day: d.dimensions[1]?.id ?? d.dimensions[1]?.name ?? "",
      views: d.metrics[0] ?? 0, cart: d.metrics[1] ?? 0, orders: d.metrics[2] ?? 0, revenue: d.metrics[3] ?? 0,
    });
    if (batch.length < 1000) break;
  }
  return rows;
}

// Ozon РНП: матрица метрик (Заказы шт / Выручка ₽ / Показы) × даты по каждому SKU.
export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  const days = Math.min(30, Math.max(3, Number(sp.get("days")) || 14));
  const cab = await getActiveOzonCreds(sp.get("cabinet"));
  if (!cab.ok) return NextResponse.json({ skus: [], period: [], error: cab.error, noCabinet: true });

  const to = new Date().toISOString().slice(0, 10);
  const fromD = new Date(Date.now() - (days - 1) * 86400000);
  const from = fromD.toISOString().slice(0, 10);

  let raw;
  try { raw = await fetchDaySku(cab.creds, from, to); }
  catch (e) { return NextResponse.json({ skus: [], period: [], error: String(e instanceof Error ? e.message : e) }, { status: 502 }); }

  // оси
  const dates: string[] = [];
  for (let i = 0; i < days; i++) dates.push(new Date(fromD.getTime() + i * 86400000).toISOString().slice(0, 10));
  const period = dates.map((d) => { const dt = new Date(d); return { label: `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}`, period_type: WEEKDAY[dt.getDay()] }; });

  // группировка по sku
  type Day = { views: number; cart: number; orders: number; revenue: number };
  const bySku = new Map<string, { name: string; byDay: Map<string, Day> }>();
  for (const r of raw) {
    if (!bySku.has(r.sku)) bySku.set(r.sku, { name: r.name, byDay: new Map() });
    bySku.get(r.sku)!.byDay.set(r.day.slice(0, 10), { views: r.views, cart: r.cart, orders: r.orders, revenue: r.revenue });
  }

  // остатки + карта sku→offer для джойна (фото тоже отсюда)
  const [{ bySku: imgBySku, skuToOffer }, stk] = await Promise.all([ozonImages(cab.creds), ozonStocks(cab.creds)]);
  const freeByOffer: Record<string, number> = {};
  if (stk.ok) for (const s of stk.rows) freeByOffer[s.article] = (freeByOffer[s.article] ?? 0) + s.free;
  const stockOfSku = (sku: string) => freeByOffer[skuToOffer[sku] ?? ""] ?? 0;

  const buildMetrics = (byDay: Map<string, Day>, stock: number) => {
    const pick = (k: keyof Day) => dates.map((d) => Math.round(byDay.get(d)?.[k] ?? 0));
    const sum = (a: number[]) => a.reduce((x, v) => x + v, 0);
    const orders = pick("orders"), revenue = pick("revenue"), views = pick("views"), cart = pick("cart");
    return [
      { field: "orders", label: "Заказы, шт", kind: "int", daily: orders, total: sum(orders), group_start: true },
      { field: "revenue", label: "Выручка, ₽", kind: "money", daily: revenue, total: sum(revenue) },
      { field: "cart", label: "В корзину", kind: "int", daily: cart, total: sum(cart), group_start: true },
      { field: "views", label: "Показы", kind: "int", daily: views, total: sum(views) },
      { field: "stock", label: "Остаток, шт", kind: "int", daily: dates.map(() => 0), total: stock, group_start: true },
    ];
  };

  const skus = [...bySku.entries()]
    .map(([sku, v]) => ({ sku, name: v.name, img_url: imgBySku[sku] ?? null, metrics: buildMetrics(v.byDay, stockOfSku(sku)), _o: [...v.byDay.values()].reduce((s, x) => s + x.revenue, 0) }))
    .sort((a, b) => b._o - a._o)
    .map(({ _o, ...rest }) => { void _o; return rest; });

  // сводка
  const allDays = new Map<string, Day>();
  for (const r of raw) {
    const d = r.day.slice(0, 10);
    const e = allDays.get(d) ?? { views: 0, cart: 0, orders: 0, revenue: 0 };
    e.views += r.views; e.cart += r.cart; e.orders += r.orders; e.revenue += r.revenue;
    allDays.set(d, e);
  }
  const totalStock = Object.values(freeByOffer).reduce((s, v) => s + v, 0);
  const summary = buildMetrics(allDays, totalStock);

  return NextResponse.json({ cabinet: cab.name, period, summary, skus, sku_count: skus.length });
}
