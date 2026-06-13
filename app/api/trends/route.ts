import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

interface DailyRow { d: string; orders_count: number; orders_sum: number; buyouts_count: number; buyouts_sum: number; ad_spent: number }

// Динамика период-к-периоду (WoW/MoM): текущее окно vs предыдущее + дневной ряд для спарклайнов.
export async function GET(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const win = Math.min(30, Math.max(7, Number(new URL(req.url).searchParams.get("window")) || 7));

  const to = new Date();
  const from = new Date(Date.now() - (win * 2 - 1) * 86400000);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);
  const { data, error } = await db.rpc("rnp_daily", { p_from: fromStr, p_to: toStr });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byDate = new Map<string, DailyRow>();
  for (const r of (data ?? []) as DailyRow[]) byDate.set(String(r.d).slice(0, 10), r);

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

  return NextResponse.json({ window: win, current: { from: curDays[0], to: curDays[curDays.length - 1] }, previous: { from: prevDays[0], to: prevDays[prevDays.length - 1] }, metrics });
}
