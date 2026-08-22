import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadHourlyDashboard } from "@/lib/cache/hourlyDashboard";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";
import { loadRnpDailySkuRows } from "@/lib/rnp/rpcLoaders";

export const dynamic = "force-dynamic";

interface DailyRow { d: string; orders_count: number; orders_sum: number; buyouts_count: number; buyouts_sum: number; ad_spent: number }
interface DailySkuRow extends DailyRow { nm_id: number }

// Динамика период-к-периоду (WoW/MoM): текущее окно vs предыдущее + дневной ряд для спарклайнов.
export async function GET(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const sp = new URL(req.url).searchParams;
  const win = Math.min(30, Math.max(7, Number(sp.get("window")) || 7));
  const p_cabinet = cabinetIdFromParam(sp.get("cabinet"));
  if (!(await hasCabinetAccess(p_cabinet))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const allowedNmIds = await requestAllowedNmIds(p_cabinet);
  const refresh = sp.get("refresh") === "1";

  // Часовой снимок: динамика считается тем же rnp_daily_sku за двойное окно и
  // раньше пересчитывалась на каждый заход — 5.6 секунды на крупном кабинете.
  // Данные суточной свежести, поэтому час здесь ничего не искажает.
  return NextResponse.json(await loadHourlyDashboard(
    "wb-trends",
    { cabinetId: p_cabinet, window: win, schema: 1, extra: allowedNmIds ? [...allowedNmIds].sort().join(",") : "all" },
    () => buildTrends(db, p_cabinet, allowedNmIds, win),
    refresh ? { forceRefresh: true } : {},
  ));
}

async function buildTrends(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  p_cabinet: string | null,
  allowedNmIds: Set<number> | null,
  win: number,
) {

  const to = new Date();
  const from = new Date(Date.now() - (win * 2 - 1) * 86400000);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  let data: DailySkuRow[];
  try {
    data = await loadRnpDailySkuRows<DailySkuRow>(db, {
      from: fromStr,
      to: toStr,
      cabinetId: p_cabinet,
      allowedNmIds,
      label: "Динамика WB: заказы по SKU",
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error("Не удалось загрузить динамику WB");
  }

  const byDate = new Map<string, DailyRow>();
  for (const r of data) {
    if (!requestAllowsNm(allowedNmIds, r.nm_id)) continue;
    const date = String(r.d).slice(0, 10);
    const current = byDate.get(date) ?? { d: date, orders_count: 0, orders_sum: 0, buyouts_count: 0, buyouts_sum: 0, ad_spent: 0 };
    current.orders_count += Number(r.orders_count ?? 0);
    current.orders_sum += Number(r.orders_sum ?? 0);
    current.buyouts_count += Number(r.buyouts_count ?? 0);
    current.buyouts_sum += Number(r.buyouts_sum ?? 0);
    current.ad_spent += Number(r.ad_spent ?? 0);
    byDate.set(date, current);
  }

  // полный список дней (2×окно), делим на prev | current
  const days: string[] = [];
  const cur = new Date(from);
  while (cur <= to) { days.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 1); }
  const prevDays = days.slice(0, win);
  const curDays = days.slice(-win);

  const sumOver = (ds: string[], pick: (r: DailyRow) => number) => ds.reduce((s, d) => s + (byDate.get(d) ? pick(byDate.get(d)!) : 0), 0);
  const series = (ds: string[], pick: (r: DailyRow) => number) => ds.map((d) => (byDate.get(d) ? Math.round(pick(byDate.get(d)!)) : 0));
  const delta = (c: number, p: number) => (p > 0 ? Math.round(((c - p) / p) * 1000) / 10 : c > 0 ? 100 : 0);

  const rev = (r: DailyRow) => r.orders_sum;
  const ord = (r: DailyRow) => r.orders_count;
  const bs = (r: DailyRow) => r.buyouts_sum;
  const ad = (r: DailyRow) => r.ad_spent;

  const curRev = sumOver(curDays, rev), prevRev = sumOver(prevDays, rev);
  const curOrd = sumOver(curDays, ord), prevOrd = sumOver(prevDays, ord);
  const curAd = sumOver(curDays, ad), prevAd = sumOver(prevDays, ad);
  const curBs = sumOver(curDays, bs), prevBs = sumOver(prevDays, bs);
  const curDrr = curRev > 0 ? (curAd / curRev) * 100 : 0, prevDrr = prevRev > 0 ? (prevAd / prevRev) * 100 : 0;

  // direction: для ДРР рост = плохо (good=false)
  const metrics = [
    { key: "revenue", label: "Выручка, ₽", kind: "money", goodUp: true, current: Math.round(curRev), previous: Math.round(prevRev), deltaPct: delta(curRev, prevRev), series: series(curDays, rev) },
    { key: "orders", label: "Заказы, шт", kind: "int", goodUp: true, current: curOrd, previous: prevOrd, deltaPct: delta(curOrd, prevOrd), series: series(curDays, ord) },
    { key: "buyouts_sum", label: "Выкупы, ₽", kind: "money", goodUp: true, current: Math.round(curBs), previous: Math.round(prevBs), deltaPct: delta(curBs, prevBs), series: series(curDays, bs) },
    { key: "ad", label: "Реклама, ₽", kind: "money", goodUp: false, current: Math.round(curAd), previous: Math.round(prevAd), deltaPct: delta(curAd, prevAd), series: series(curDays, ad) },
    { key: "drr", label: "ДРР, %", kind: "pct", goodUp: false, current: Math.round(curDrr * 10) / 10, previous: Math.round(prevDrr * 10) / 10, deltaPct: delta(curDrr, prevDrr), series: curDays.map((d) => { const r = byDate.get(d); return r && r.orders_sum > 0 ? Math.round((r.ad_spent / r.orders_sum) * 1000) / 10 : 0; }) },
  ];

  return { window: win, current: { from: curDays[0], to: curDays[curDays.length - 1] }, previous: { from: prevDays[0], to: prevDays[prevDays.length - 1] }, metrics };
}
