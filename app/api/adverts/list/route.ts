import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbCardImageUrl } from "@/lib/wb/cardImage";

export const dynamic = "force-dynamic";

const WB_ADV_TOKEN = process.env.WB_TOKEN_ADVERT;
const ADV_BASE = "https://advert-api.wildberries.ru";

interface RpcRow {
  nm_id: number;
  article: string;
}
interface StatRow {
  advert_id: number;
  date: string;
  sum_spent: number;
  views: number;
  clicks: number;
  sum_orders: number;
}

// Контракт inferno: {ok, articles:[{nm,art,photo,spend,campaigns:[{...}]}], balance, count, spend_today_total, spend_yest_total, today, yest, cap_rub}
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" });

  const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const [advRes, statRes, rpcRes] = await Promise.all([
    db.from("wb_adverts").select("advert_id, name, status, daily_budget, nm_ids").in("status", [9, 11]),
    db.from("wb_advert_stats").select("advert_id, date, sum_spent, views, clicks, sum_orders").gte("date", since).limit(5000),
    db.rpc("rnp_report"),
  ]);
  if (advRes.error) return NextResponse.json({ ok: false, error: advRes.error.message });

  // даты «сегодня/вчера» по последним данным
  const dates = [...new Set((statRes.data ?? []).map((s) => String(s.date).slice(0, 10)))].sort();
  const today = dates[dates.length - 1] ?? "";
  const yest = dates[dates.length - 2] ?? "";

  // агрегаты по кампании за 14д + spend today/yest
  const byAdv = new Map<number, { spent14: number; views: number; clicks: number; ordSum: number; today: number; yest: number }>();
  for (const s of (statRes.data ?? []) as StatRow[]) {
    const a = byAdv.get(s.advert_id) ?? { spent14: 0, views: 0, clicks: 0, ordSum: 0, today: 0, yest: 0 };
    a.spent14 += Number(s.sum_spent ?? 0);
    a.views += Number(s.views ?? 0);
    a.clicks += Number(s.clicks ?? 0);
    a.ordSum += Number(s.sum_orders ?? 0);
    const d = String(s.date).slice(0, 10);
    if (d === today) a.today += Number(s.sum_spent ?? 0);
    if (d === yest) a.yest += Number(s.sum_spent ?? 0);
    byAdv.set(s.advert_id, a);
  }

  // посуточные ряды по кампании для панели статистики (adverts.sel.days)
  const daysByAdv = new Map<number, { ts: string; spend: number; clicks: number; views: number; orders: number }[]>();
  for (const s of (statRes.data ?? []) as StatRow[]) {
    const arr = daysByAdv.get(s.advert_id) ?? [];
    arr.push({
      ts: String(s.date).slice(0, 10),
      spend: Math.round(Number(s.sum_spent ?? 0)),
      clicks: Number(s.clicks ?? 0),
      views: Number(s.views ?? 0),
      orders: Number(s.sum_orders ?? 0),
    });
    daysByAdv.set(s.advert_id, arr);
  }
  for (const arr of daysByAdv.values()) arr.sort((a, b) => a.ts.localeCompare(b.ts));

  const artByNm = new Map<number, string>();
  for (const r of (rpcRes.data ?? []) as RpcRow[]) artByNm.set(r.nm_id, r.article);

  // группируем кампании по основному nm → article
  const artMap = new Map<number, { nm: number; art: string; photo: string; spend: number; campaigns: Record<string, unknown>[] }>();
  for (const a of advRes.data ?? []) {
    const nm = (a.nm_ids as number[])?.[0];
    if (!nm) continue;
    const st = byAdv.get(a.advert_id) ?? { spent14: 0, views: 0, clicks: 0, ordSum: 0, today: 0, yest: 0 };
    const drr = st.ordSum > 0 ? Math.round((st.spent14 / st.ordSum) * 1000) / 10 : null;
    const campaign = {
      id: a.advert_id,
      name: a.name ?? `Кампания ${a.advert_id}`,
      status: a.status,
      status_id: a.status,
      enabled: a.status === 9,
      nm,
      bid_type: "unified",
      budget: a.daily_budget ?? 0,
      spend_today: Math.round(st.today),
      drr,
      photo: wbCardImageUrl(nm),
      category: "",
      hours: [],
      payment: "cpm",
      cab: "JC",
      days: daysByAdv.get(a.advert_id) ?? [],
    };
    let g = artMap.get(nm);
    if (!g) {
      g = { nm, art: artByNm.get(nm) || String(nm), photo: wbCardImageUrl(nm), spend: 0, campaigns: [] };
      artMap.set(nm, g);
    }
    g.spend += Math.round(st.today);
    g.campaigns.push(campaign);
  }

  const articles = [...artMap.values()].sort((a, b) => b.spend - a.spend);
  const spendTodayTotal = articles.reduce((s, a) => s + a.spend, 0);
  const spendYestTotal = [...byAdv.values()].reduce((s, a) => s + a.yest, 0);

  // баланс кабинета
  let balance: number | null = null;
  if (WB_ADV_TOKEN) {
    try {
      const res = await fetch(`${ADV_BASE}/adv/v1/balance`, { headers: { Authorization: WB_ADV_TOKEN }, cache: "no-store" });
      if (res.ok) {
        const j = await res.json();
        balance = (j.balance ?? 0) + (j.net ?? 0);
      }
    } catch {
      /* необязательно */
    }
  }

  return NextResponse.json({
    ok: true,
    articles,
    count: advRes.data?.length ?? 0,
    cap_rub: 5000,
    balance,
    spend_today_total: spendTodayTotal,
    spend_yest_total: Math.round(spendYestTotal),
    today,
    yest,
  });
}
