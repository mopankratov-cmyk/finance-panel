import { NextRequest, NextResponse } from "next/server";
import { getActiveOzonCreds } from "@/lib/ozon/cabinet";
import { ozonImages, ozonStocks, type OzonCreds } from "@/lib/ozon/api";
import { ozonSellerFetch, OzonRateLimitError } from "@/lib/ozon/sellerGate";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isOzonAdCabinetTotalSku, isOzonAdServiceSku } from "@/lib/ozon/adDailyMarkers";
import { readOzonAdDaily } from "@/lib/ozon/adDailyRead";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE = "https://api-seller.ozon.ru";
const WEEKDAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

// analytics/data с разбивкой [sku, day] (постранично).
// ВАЖНО: запрашиваем ТОЛЬКО ordered_units + revenue. Метрики воронки (hits_view/hits_tocart)
// доступны лишь в Ozon Premium Plus — без подписки Ozon молча выкидывает их из ответа,
// массив metrics укорачивается и позиции «съезжают» (заказы/выручка читались как 0,
// а показы/в корзину — как мусор → CR 218790%). Базовые ordered_units/revenue есть у всех.
async function fetchDaySku(c: OzonCreds, from: string, to: string) {
  const rows: { sku: string; name: string; day: string; orders: number; revenue: number }[] = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
    const res = await ozonSellerFetch(c.clientId, `${BASE}/v1/analytics/data`, {
      method: "POST",
      headers: { "Client-Id": c.clientId, "Api-Key": c.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        date_from: from, date_to: to,
        metrics: ["ordered_units", "revenue"],
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
      orders: d.metrics[0] ?? 0, revenue: d.metrics[1] ?? 0,
    });
    if (batch.length < 1000) break;
  }
  return rows;
}

// Ozon РНП: матрица метрик (Заказы шт / Выручка ₽ / Показы) × даты по каждому SKU.
export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  const requestedYear = Number(sp.get("year"));
  const requestedMonth = Number(sp.get("month"));
  const hasCalendarMonth = Number.isInteger(requestedYear)
    && requestedYear >= 2020
    && requestedYear <= 2100
    && Number.isInteger(requestedMonth)
    && requestedMonth >= 1
    && requestedMonth <= 12;
  const fallbackDays = Math.min(30, Math.max(3, Number(sp.get("days")) || 14));
  const cab = await getActiveOzonCreds(sp.get("cabinet"));
  if (!cab.ok) return NextResponse.json({ skus: [], period: [], error: cab.error, noCabinet: true });

  const today = new Date().toISOString().slice(0, 10);
  const requestedFrom = hasCalendarMonth
    ? `${requestedYear}-${String(requestedMonth).padStart(2, "0")}-01`
    : new Date(Date.now() - (fallbackDays - 1) * 86400000).toISOString().slice(0, 10);
  const requestedTo = hasCalendarMonth
    ? `${requestedYear}-${String(requestedMonth).padStart(2, "0")}-${String(new Date(Date.UTC(requestedYear, requestedMonth, 0)).getUTCDate()).padStart(2, "0")}`
    : today;
  if (requestedFrom > today) {
    return NextResponse.json({ cabinet: cab.name, period: [], summary: [], skus: [], sku_count: 0, perfAvailable: false });
  }
  const from = requestedFrom;
  const to = requestedTo < today ? requestedTo : today;
  const fromD = new Date(`${from}T00:00:00.000Z`);
  const toD = new Date(`${to}T00:00:00.000Z`);
  const days = Math.floor((toD.getTime() - fromD.getTime()) / 86400000) + 1;

  // DEBUG: сырой ответ Ozon (analytics/data + образец postings) — понять, что реально приходит
  if (sp.get("debug") === "1") {
    const h = { "Client-Id": cab.creds.clientId, "Api-Key": cab.creds.apiKey, "Content-Type": "application/json" };
    const aRes = await ozonSellerFetch(cab.creds.clientId, `${BASE}/v1/analytics/data`, { method: "POST", headers: h, body: JSON.stringify({ date_from: from, date_to: to, metrics: ["hits_view", "hits_tocart", "ordered_units", "revenue"], dimension: ["sku", "day"], limit: 5, offset: 0 }) });
    const aTxt = await aRes.text();
    let aJson: unknown; try { aJson = JSON.parse(aTxt); } catch { aJson = aTxt.slice(0, 500); }
    const pRes = await ozonSellerFetch(cab.creds.clientId, `${BASE}/v2/posting/fbo/list`, { method: "POST", headers: h, body: JSON.stringify({ dir: "DESC", filter: { since: from + "T00:00:00.000Z", to: to + "T23:59:59.999Z", status: "" }, limit: 3, offset: 0, with: {} }) });
    const pTxt = await pRes.text();
    let pJson: unknown; try { pJson = JSON.parse(pTxt); } catch { pJson = pTxt.slice(0, 500); }
    return NextResponse.json({ analytics_status: aRes.status, analytics: aJson, postings_status: pRes.status, postings: pJson });
  }

  let raw;
  try { raw = await fetchDaySku(cab.creds, from, to); }
  catch (e) {
    // Лимит Ozon — это «зайдите позже», а не поломка интеграции: показываем
    // человеческий текст, а не сырой JSON маркетплейса.
    const error = e instanceof OzonRateLimitError ? e.message : String(e instanceof Error ? e.message : e);
    return NextResponse.json({ skus: [], period: [], error, rateLimited: e instanceof OzonRateLimitError }, { status: 502 });
  }

  // оси
  const dates: string[] = [];
  for (let i = 0; i < days; i++) dates.push(new Date(fromD.getTime() + i * 86400000).toISOString().slice(0, 10));
  const period = dates.map((d) => { const dt = new Date(d); return { label: `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}`, period_type: WEEKDAY[dt.getDay()] }; });

  // группировка по sku
  type Day = { orders: number; revenue: number };
  const bySku = new Map<string, { name: string; byDay: Map<string, Day> }>();
  for (const r of raw) {
    if (!bySku.has(r.sku)) bySku.set(r.sku, { name: r.name, byDay: new Map() });
    bySku.get(r.sku)!.byDay.set(r.day.slice(0, 10), { orders: r.orders, revenue: r.revenue });
  }

  // остатки + карта sku→offer для джойна (фото тоже отсюда)
  const [{ bySku: imgBySku, skuToOffer }, stk] = await Promise.all([ozonImages(cab.creds), ozonStocks(cab.creds)]);
  const freeByOffer: Record<string, number> = {};
  if (stk.ok) for (const s of stk.rows) freeByOffer[s.article] = (freeByOffer[s.article] ?? 0) + s.free;
  const stockOfSku = (sku: string) => freeByOffer[skuToOffer[sku] ?? ""] ?? 0;

  // Расход рекламы по дням из истории (`ozon_ad_daily`).
  //
  // Раньше читался скользящий кэш «последние N дней» с фильтром
  // `days = длина месяца`, а этот кэш существует только для 14 дней — колонка
  // рекламы в плане-факте была пустой ВСЕГДА. История хранит конкретные даты,
  // поэтому подходит любому периоду и даёт расход по каждому дню, а не одним
  // числом за месяц.
  const adBySku = new Map<string, Map<string, number>>();
  const adCabinetByDay = new Map<string, number>();
  {
    const db = getSupabaseAdmin();
    if (db) {
      const { rows: adRows } = await readOzonAdDaily(
        db,
        [cab.creds.clientId],
        dates[0],
        dates[dates.length - 1],
        "client_id, sku, date, spent, orders_money",
      );
      for (const row of adRows) {
        const day = String(row.date).slice(0, 10);
        const spent = Number(row.spent ?? 0);
        if (isOzonAdCabinetTotalSku(row.sku)) {
          adCabinetByDay.set(day, (adCabinetByDay.get(day) ?? 0) + spent);
          continue;
        }
        if (isOzonAdServiceSku(row.sku)) continue;
        const sku = String(row.sku);
        const byDay = adBySku.get(sku) ?? new Map<string, number>();
        byDay.set(day, (byDay.get(day) ?? 0) + spent);
        adBySku.set(sku, byDay);
      }
    }
  }

  const buildMetrics = (byDay: Map<string, Day>, stock: number, adByDay?: Map<string, number>) => {
    const pick = (k: keyof Day) => dates.map((d) => Math.round(byDay.get(d)?.[k] ?? 0));
    const sum = (a: number[]) => a.reduce((x, v) => x + v, 0);
    const orders = pick("orders"), revenue = pick("revenue");
    const revTotal = sum(revenue);
    const oV = sum(orders);
    // ср. цена заказа (выручка/заказы) — единственная производная, что можем без воронки
    const avg = dates.map((_, i) => (orders[i] > 0 ? Math.round(revenue[i] / orders[i]) : 0));
    const m = [
      { field: "orders", label: "Заказы, шт", kind: "int", daily: orders, total: oV, group_start: true },
      { field: "revenue", label: "Выручка, ₽", kind: "money", daily: revenue, total: revTotal },
      { field: "avg_check", label: "Ср. цена, ₽", kind: "money", daily: avg, total: oV > 0 ? Math.round(revTotal / oV) : 0 },
      { field: "stock", label: "Остаток, шт", kind: "int", daily: dates.map(() => 0), total: stock, group_start: true },
    ];
    if (adByDay) {
      const adDaily = dates.map((d) => Math.round(adByDay.get(d) ?? 0));
      const adTotal = sum(adDaily);
      // Расход без выручки — не «ДРР 0%». Помечаем предельным значением,
      // чтобы такой день не выглядел лучшим в строке.
      const drrDaily = dates.map((_day, index) => (revenue[index] > 0 ? Math.round((adDaily[index] / revenue[index]) * 1000) / 10 : adDaily[index] > 0 ? 999 : 0));
      m.push({ field: "ad", label: "Реклама, ₽", kind: "money", daily: adDaily, total: adTotal, group_start: true });
      m.push({ field: "drr", label: "ДРР, %", kind: "pct", daily: drrDaily, total: revTotal > 0 ? Math.round((adTotal / revTotal) * 1000) / 10 : 0 });
    }
    return m;
  };

  const skus = [...bySku.entries()]
    // art — артикул продавца (offer_id). Без него план продаж не находил факт:
    // план ведётся по артикулам, а аналитика Ozon отдаёт только числовой sku.
    // Карта sku→offer уже загружена выше для остатков, просто не попадала в ответ.
    .map(([sku, v]) => ({ sku, art: skuToOffer[sku] ?? null, name: v.name, img_url: imgBySku[sku] ?? null, metrics: buildMetrics(v.byDay, stockOfSku(sku), adBySku.get(sku)), _o: [...v.byDay.values()].reduce((s, x) => s + x.revenue, 0) }))
    .sort((a, b) => b._o - a._o)
    .map(({ _o, ...rest }) => { void _o; return rest; });

  // сводка
  const allDays = new Map<string, Day>();
  for (const r of raw) {
    const d = r.day.slice(0, 10);
    const e = allDays.get(d) ?? { orders: 0, revenue: 0 };
    e.orders += r.orders; e.revenue += r.revenue;
    allDays.set(d, e);
  }
  const totalStock = Object.values(freeByOffer).reduce((s, v) => s + v, 0);
  const summary = buildMetrics(allDays, totalStock);

  // Реклама ₽ + ДРР по дням (Performance API, уровень кабинета) — добавляем в сводку
  let perfAvailable = false;
  // Сегодняшнего дня в истории нет никогда — он ещё идёт.
  const todayIso = new Date().toISOString().slice(0, 10);
  const historyDates = dates.filter((d) => d < todayIso);
  const storedCoversPeriod = historyDates.length > 0 && historyDates.every((d) => adCabinetByDay.has(d));
  if (storedCoversPeriod) {
    // История покрывает период целиком — живой запрос не нужен. Частичную
    // историю за полный факт выдавать нельзя: непокрытые дни превратились бы
    // в нули, а месяц — в заниженный расход.
    perfAvailable = true;
    const revDaily = summary.find((m) => m.field === "revenue")?.daily ?? dates.map(() => 0);
    const adDaily = dates.map((d) => Math.round(adCabinetByDay.get(d) ?? 0));
    // День с расходом и без выручки — это не «ДРР 0%», а «отдачи нет».
    // Ноль в такой клетке делал худший день похожим на лучший.
    const drrDaily = dates.map((_, i) => (revDaily[i] > 0 ? Math.round((adDaily[i] / revDaily[i]) * 1000) / 10 : adDaily[i] > 0 ? 999 : 0));
    const adTotal = adDaily.reduce((s, v) => s + v, 0);
    const revTotal = revDaily.reduce((s, v) => s + v, 0);
    summary.push({ field: "ad", label: "Реклама, ₽", kind: "money", daily: adDaily, total: adTotal, group_start: true });
    summary.push({ field: "drr", label: "ДРР, %", kind: "pct", daily: drrDaily, total: revTotal > 0 ? Math.round((adTotal / revTotal) * 1000) / 10 : 0 });
  } else if (cab.perf) {
    const { perfDailySpend } = await import("@/lib/ozon/performance");
    const ps = await perfDailySpend(cab.perf, from, to);
    if (ps) {
      perfAvailable = true;
      const revDaily = summary.find((m) => m.field === "revenue")?.daily ?? dates.map(() => 0);
      const adDaily = dates.map((d) => Math.round(ps.byDate[d]?.spent ?? 0));
      const drrDaily = dates.map((_, i) => (revDaily[i] > 0 ? Math.round((adDaily[i] / revDaily[i]) * 1000) / 10 : 0));
      const adTotal = adDaily.reduce((s, v) => s + v, 0);
      const revTotal = revDaily.reduce((s, v) => s + v, 0);
      summary.push({ field: "ad", label: "Реклама, ₽", kind: "money", daily: adDaily, total: adTotal, group_start: true });
      summary.push({ field: "drr", label: "ДРР, %", kind: "pct", daily: drrDaily, total: revTotal > 0 ? Math.round((adTotal / revTotal) * 1000) / 10 : 0 });
    }
  }

  return NextResponse.json({ cabinet: cab.name, period, summary, skus, sku_count: skus.length, perfAvailable });
}
