import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
export async function GET(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "Supabase не настроен" });

  // ?cabinet=<uuid|all> — срез рекламы по выбранному кабинету (данные уже синканы с cabinet_id)
  const { cabinetId, label } = await resolveShopCabinet(new URL(request.url).searchParams.get("cabinet") ?? undefined);

  let advQ = db.from("wb_adverts").select("advert_id, name, status, daily_budget, nm_ids").in("status", [9, 11]);
  let statQ = db.from("wb_advert_stats").select("advert_id, date, sum_spent, views, clicks, sum_orders").gte("date", new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)).limit(5000);
  if (cabinetId) { advQ = advQ.eq("cabinet_id", cabinetId); statQ = statQ.eq("cabinet_id", cabinetId); }

  // Баланс продвижения зависит только от cabinetId — считаем его цепочку параллельно
  // с тяжёлыми БД-запросами, а не после них (иначе латентность складывается).
  const balancePromise: Promise<number | null> = cabinetId
    ? getWbCabinet(cabinetId).then(async (cab) => {
        const advToken = cab ? resolveWbToken(cab, "advert") : null;
        if (!advToken) return null;
        try {
          const res = await fetch(`${ADV_BASE}/adv/v1/balance`, { headers: { Authorization: advToken }, cache: "no-store" });
          if (!res.ok) return null;
          const j = await res.json();
          return (j.balance ?? 0) + (j.net ?? 0);
        } catch {
          return null;
        }
      })
    : Promise.resolve(null);

  const [advRes, statRes, rpcRes, balance] = await Promise.all([advQ, statQ, db.rpc("rnp_report", { p_cabinet: cabinetId }), balancePromise]);
  if (advRes.error) return NextResponse.json({ ok: false, error: advRes.error.message });

  // «Сегодня/вчера» — календарные даты, а не последняя синканная. Если сегодняшний
  // синк рекламы ещё не прошёл — покажем 0 за реальное сегодня, а не подменим его вчерашним днём.
  const today = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

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

  const cabLabel = label || "Все кабинеты";

  // группируем кампании по основному nm → article. spendYestTotal считаем в ТОМ ЖЕ
  // проходе и над той же популяцией (только кампании с nm), что и spendTodayTotal —
  // иначе «% к вчера» сравнивает разные множества кампаний.
  const artMap = new Map<number, { nm: number; art: string; photo: string; spend: number; campaigns: Record<string, unknown>[] }>();
  let spendYestTotal = 0;
  for (const a of advRes.data ?? []) {
    const nm = (a.nm_ids as number[])?.[0];
    if (!nm) continue;
    const st = byAdv.get(a.advert_id) ?? { spent14: 0, views: 0, clicks: 0, ordSum: 0, today: 0, yest: 0 };
    spendYestTotal += st.yest;
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
      cab: cabLabel,
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

  return NextResponse.json({
    ok: true,
    cabinet: cabLabel,
    articles,
    // «Активных» = именно статус 9 (11 — на паузе, но остаётся в выборке для истории/аналитики)
    count: (advRes.data ?? []).filter((a) => a.status === 9).length,
    cap_rub: 5000,
    balance,
    spend_today_total: spendTodayTotal,
    spend_yest_total: Math.round(spendYestTotal),
    today,
    yest,
  });
}
