import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { getWbCommissionForCabinet } from "@/lib/wb/commissions";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";

const WEEKDAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

interface DailyRow {
  d: string;
  orders_count: number;
  orders_sum: number;
  buyouts_count: number;
  buyouts_sum: number;
  ad_spent: number;
}
interface SkuDailyRow extends DailyRow {
  nm_id: number;
}
interface RpcTotal {
  nm_id: number;
  article: string;
  stock: number;
  cost: number | null;
}
interface AdNmRow { nm_id: number; date: string; views: number | null; clicks: number | null }
interface FunnelCartRow { nm_id: number; date: string; add_to_cart: number | null }

// Показы/клики/CTR/корзины по SKU по дням — отдельный источник (wb_advert_nm_daily +
// wb_funnel_daily), не трогаем rnp_daily(_sku) RPC (общий для многих потребителей).
// Вклеивается в начало metrics[] построчно, тем же способом, что gross/margin_pct — сводкой.
function buildFunnelMetrics(days: string[], viewsByDate: Map<string, number>, clicksByDate: Map<string, number>, cartByDate: Map<string, number>): Metric[] {
  const views = days.map((d) => viewsByDate.get(d) ?? 0);
  const clicks = days.map((d) => clicksByDate.get(d) ?? 0);
  const cart = days.map((d) => cartByDate.get(d) ?? 0);
  const ctr = days.map((_, i) => (views[i] > 0 ? Math.round((clicks[i] / views[i]) * 1000) / 10 : null));
  const s = (a: number[]) => a.reduce((x, v) => x + v, 0);
  const totViews = s(views), totClicks = s(clicks);
  return [
    { field: "views", label: "Показы", kind: "int", daily: views, total: totViews, forecast: totViews, group_start: true },
    { field: "clicks", label: "Клики", kind: "int", daily: clicks, total: totClicks, forecast: totClicks },
    { field: "ctr", label: "CTR, %", kind: "pct", daily: ctr, total: totViews > 0 ? Math.round((totClicks / totViews) * 1000) / 10 : 0, forecast: null },
    { field: "cart", label: "В корзину", kind: "int", daily: cart, total: s(cart), forecast: s(cart) },
  ];
}

export interface Metric {
  field: string;
  label: string;
  kind: string;
  daily: (number | null)[];
  total: number;
  forecast: number | null;
  group_start?: boolean;
}

// cost > 0 → добавляем Валовую ₽ и Маржу % (нужна себестоимость). Для сводки cost=0 → эти метрики вклеиваем отдельно (агрегат по SKU).
function buildMetrics(days: string[], byDate: Map<string, DailyRow>, stock: number, stockMoney: number, cost = 0, wbCostPct = 0): Metric[] {
  const pick = (k: keyof DailyRow) => days.map((d) => Number(byDate.get(d)?.[k] ?? 0));
  const s = (a: number[]) => a.reduce((x, v) => x + v, 0);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const oc = pick("orders_count"), os = pick("orders_sum"), bc = pick("buyouts_count"), bs = pick("buyouts_sum"), ad = pick("ad_spent");
  const drr = days.map((d) => { const r = byDate.get(d); return r && r.orders_sum > 0 ? r1((r.ad_spent / r.orders_sum) * 100) : null; });
  // Выкуп % = выкупы шт / заказы шт
  const buyoutPct = days.map((_, i) => (oc[i] > 0 ? r1((bc[i] / oc[i]) * 100) : null));
  const totOs = s(os), totBc = s(bc), totOc = s(oc);
  const out: Metric[] = [
    { field: "orders_count", label: "Заказы, шт", kind: "int", daily: oc, total: totOc, forecast: totOc, group_start: true },
    { field: "orders_sum", label: "Заказы, ₽", kind: "money", daily: os, total: Math.round(totOs), forecast: Math.round(totOs) },
    { field: "buyouts_count", label: "Выкупы, шт", kind: "int", daily: bc, total: totBc, forecast: totBc, group_start: true },
    { field: "buyouts_sum", label: "Выкупы, ₽", kind: "money", daily: bs, total: Math.round(s(bs)), forecast: Math.round(s(bs)) },
    { field: "buyout_pct", label: "Выкуп, %", kind: "pct", daily: buyoutPct, total: totOc > 0 ? r1((totBc / totOc) * 100) : 0, forecast: null },
    { field: "ad_spent", label: "Реклама, ₽", kind: "money", daily: ad, total: Math.round(s(ad)), forecast: Math.round(s(ad)), group_start: true },
    { field: "drr", label: "ДРР, %", kind: "pct", daily: drr, total: totOs > 0 ? r1((s(ad) / totOs) * 100) : 0, forecast: null },
  ];
  let grossTotalForGmroi: number | null = null;
  if (cost > 0) {
    // Маржа после ВСЕХ расходов МП: выкупы₽ − себес×выкупы − wbCost%(комиссия+эквайринг+логистика+
    // хранение+штрафы+приёмка+прочие) − реклама. Всё из ФАКТ-финотчёта. Маржа % = это / выкупы₽.
    const cm = wbCostPct / 100;
    const gross = days.map((_, i) => Math.round(bs[i] - cost * bc[i] - bs[i] * cm - ad[i]));
    const totGross = s(bs) - cost * totBc - s(bs) * cm - s(ad);
    grossTotalForGmroi = totGross;
    const marginPct = days.map((_, i) => (bs[i] > 0 ? r1(((bs[i] - cost * bc[i] - bs[i] * cm - ad[i]) / bs[i]) * 100) : null));
    out.push(
      { field: "gross", label: "Валовая, ₽", kind: "money", daily: gross, total: Math.round(totGross), forecast: Math.round(totGross), group_start: true },
      { field: "margin_pct", label: "Маржа, %", kind: "pct", daily: marginPct, total: s(bs) > 0 ? r1((totGross / s(bs)) * 100) : 0, forecast: null },
    );
  }
  // Оборачиваемость, дней = остаток / (выкупы в день). GMROI % = валовая / деньги в остатках.
  const dailyBuyouts = days.length > 0 ? totBc / days.length : 0;
  const turnover = dailyBuyouts > 0 ? Math.round(stock / dailyBuyouts) : null;
  const gmroi = grossTotalForGmroi != null && stockMoney > 0 ? r1(Math.min(999, (grossTotalForGmroi / stockMoney) * 100)) : null;
  out.push(
    { field: "stock", label: "Остаток, шт", kind: "int", daily: days.map(() => null), total: stock, forecast: null, group_start: true },
    { field: "money", label: "Деньги в остатках, ₽", kind: "money", daily: days.map(() => null), total: Math.round(stockMoney), forecast: null },
    { field: "turnover", label: "Оборачиваемость, дней", kind: "int", daily: days.map(() => null), total: turnover ?? 0, forecast: null },
    { field: "gmroi", label: "GMROI, %", kind: "pct", daily: days.map(() => null), total: gmroi ?? 0, forecast: null },
  );
  return out;
}

export interface RnpTable {
  shop_label: string;
  sku_count: number;
  period: { label: string; period_type: string }[];
  summary: Metric[];
  skus: { nm: number; art: string; name: string; img_url: string; metrics: Metric[] }[];
}

export async function buildRnpTable(from: string, to: string, cabinetId?: string | null, shopLabel?: string): Promise<RnpTable | { error: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { error: "Supabase не настроен" };

  const p_cabinet = cabinetId || null; // null = все кабинеты
  const allowedNmIds = await requestAllowedNmIds(p_cabinet);
  let adQ = db.from("wb_advert_nm_daily").select("nm_id, date, views, clicks").gte("date", from).lte("date", to);
  let funnelQ = db.from("wb_funnel_daily").select("nm_id, date, add_to_cart").gte("date", from).lte("date", to);
  if (p_cabinet) { adQ = adQ.eq("cabinet_id", p_cabinet); funnelQ = funnelQ.eq("cabinet_id", p_cabinet); }
  if (allowedNmIds) {
    const nmIds = allowedNmIds.size ? [...allowedNmIds] : [-1];
    adQ = adQ.in("nm_id", nmIds);
    funnelQ = funnelQ.in("nm_id", nmIds);
  }
  const [dailyRes, skuRes, totalsRes, costsRes, comm, adRes, funnelRes] = await Promise.all([
    db.rpc("rnp_daily", { p_from: from, p_to: to, p_cabinet }),
    db.rpc("rnp_daily_sku", { p_from: from, p_to: to, p_cabinet }),
    db.rpc("rnp_report", { p_cabinet }),
    db.from("product_costs").select("article, name"),
    getWbCommissionForCabinet(p_cabinet, 30),
    adQ,
    funnelQ,
  ]);
  if (dailyRes.error) return { error: dailyRes.error.message };

  // показы/клики/корзины по (nm_id, date) — отдельно от rnp_daily(_sku) RPC
  const viewsByNm = new Map<number, Map<string, number>>();
  const clicksByNm = new Map<number, Map<string, number>>();
  const cartByNm = new Map<number, Map<string, number>>();
  for (const r of (adRes.data ?? []) as AdNmRow[]) {
    if (!requestAllowsNm(allowedNmIds, r.nm_id)) continue;
    const d = String(r.date).slice(0, 10);
    if (!viewsByNm.has(r.nm_id)) { viewsByNm.set(r.nm_id, new Map()); clicksByNm.set(r.nm_id, new Map()); }
    viewsByNm.get(r.nm_id)!.set(d, (viewsByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.views ?? 0));
    clicksByNm.get(r.nm_id)!.set(d, (clicksByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.clicks ?? 0));
  }
  for (const r of (funnelRes.data ?? []) as FunnelCartRow[]) {
    if (!requestAllowsNm(allowedNmIds, r.nm_id)) continue;
    const d = String(r.date).slice(0, 10);
    if (!cartByNm.has(r.nm_id)) cartByNm.set(r.nm_id, new Map());
    cartByNm.get(r.nm_id)!.set(d, (cartByNm.get(r.nm_id)!.get(d) ?? 0) + Number(r.add_to_cart ?? 0));
  }
  // агрегат по всем nm — для сводки строки
  const viewsByDateAll = new Map<string, number>(), clicksByDateAll = new Map<string, number>(), cartByDateAll = new Map<string, number>();
  for (const r of (adRes.data ?? []) as AdNmRow[]) {
    if (!requestAllowsNm(allowedNmIds, r.nm_id)) continue;
    const d = String(r.date).slice(0, 10);
    viewsByDateAll.set(d, (viewsByDateAll.get(d) ?? 0) + Number(r.views ?? 0));
    clicksByDateAll.set(d, (clicksByDateAll.get(d) ?? 0) + Number(r.clicks ?? 0));
  }
  for (const r of (funnelRes.data ?? []) as FunnelCartRow[]) {
    if (!requestAllowsNm(allowedNmIds, r.nm_id)) continue;
    const d = String(r.date).slice(0, 10);
    cartByDateAll.set(d, (cartByDateAll.get(d) ?? 0) + Number(r.add_to_cart ?? 0));
  }
  // полный расход МП на nm = комиссия + эквайринг + прочие удержания (логистика/хранение/штрафы/…) + account-overhead
  const wbCostForNm = (nm: number) => {
    const e = comm.byNm.get(nm);
    return (e?.pct ?? comm.avgPct) + (e?.acqPct ?? comm.avgAcqPct) + (e?.extraPct ?? comm.avgExtraPct) + comm.overheadPct;
  };

  const days: string[] = [];
  const cur = new Date(from), end = new Date(to);
  while (cur <= end) { days.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 1); }
  const period = days.map((d) => { const dt = new Date(d); return { label: `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}`, period_type: WEEKDAY[dt.getDay()] }; });

  const skuDailyRows = ((skuRes.data ?? []) as SkuDailyRow[]).filter((row) => requestAllowsNm(allowedNmIds, row.nm_id));
  const dailyByDate = new Map<string, DailyRow>();
  for (const r of skuDailyRows) {
    const date = String(r.d).slice(0, 10);
    const current = dailyByDate.get(date) ?? { d: date, orders_count: 0, orders_sum: 0, buyouts_count: 0, buyouts_sum: 0, ad_spent: 0 };
    current.orders_count += Number(r.orders_count ?? 0);
    current.orders_sum += Number(r.orders_sum ?? 0);
    current.buyouts_count += Number(r.buyouts_count ?? 0);
    current.buyouts_sum += Number(r.buyouts_sum ?? 0);
    current.ad_spent += Number(r.ad_spent ?? 0);
    dailyByDate.set(date, current);
  }
  const totals = ((totalsRes.data ?? []) as RpcTotal[]).filter((row) => requestAllowsNm(allowedNmIds, row.nm_id));
  const stockTotal = totals.reduce((a, r) => a + Number(r.stock ?? 0), 0);
  const stockMoneyTotal = totals.reduce((a, r) => a + Number(r.stock ?? 0) * Number(r.cost ?? 0), 0);

  const nameByArt = new Map<string, string>();
  for (const c of costsRes.data ?? []) nameByArt.set(c.article as string, (c.name as string) ?? "");
  const totalByNm = new Map<number, RpcTotal>();
  for (const t of totals) totalByNm.set(t.nm_id, t);
  const byNm = new Map<number, Map<string, DailyRow>>();
  for (const r of skuDailyRows) {
    if (!byNm.has(r.nm_id)) byNm.set(r.nm_id, new Map());
    byNm.get(r.nm_id)!.set(String(r.d).slice(0, 10), r);
  }

  const skus = [...totalByNm.values()]
    .map((t) => {
      const dmap = byNm.get(t.nm_id) ?? new Map<string, DailyRow>();
      const metrics = buildMetrics(days, dmap, Number(t.stock ?? 0), Math.round(Number(t.stock ?? 0) * Number(t.cost ?? 0)), Number(t.cost ?? 0), wbCostForNm(t.nm_id));
      metrics.unshift(...buildFunnelMetrics(days, viewsByNm.get(t.nm_id) ?? new Map(), clicksByNm.get(t.nm_id) ?? new Map(), cartByNm.get(t.nm_id) ?? new Map()));
      const orders = metrics.find((m) => m.field === "orders_count")?.total ?? 0;
      return { nm: t.nm_id, art: t.article || String(t.nm_id), name: nameByArt.get(t.article) || t.article || String(t.nm_id), img_url: wbCardImageUrl(t.nm_id), metrics, _o: orders };
    })
    .sort((a, b) => b._o - a._o)
    .map(({ _o, ...rest }) => { void _o; return rest; });

  // Сводка: базовые метрики из дневной агрегации + Валовая/Маржа вклеиваем суммой по SKU (себес разный)
  const summary = buildMetrics(days, dailyByDate, stockTotal, Math.round(stockMoneyTotal));
  summary.unshift(...buildFunnelMetrics(days, viewsByDateAll, clicksByDateAll, cartByDateAll));
  const sumDaily = (field: string) => days.map((_, i) => {
    let acc = 0, any = false;
    for (const sk of skus) { const m = sk.metrics.find((x) => x.field === field); const v = m?.daily[i]; if (v != null) { acc += Number(v); any = true; } }
    return any ? Math.round(acc) : null;
  });
  const grossDaily = sumDaily("gross");
  const grossTotal = skus.reduce((a, sk) => a + (sk.metrics.find((x) => x.field === "gross")?.total ?? 0), 0);
  const buyoutsSumTotal = summary.find((m) => m.field === "buyouts_sum")?.total ?? 0;
  const buyoutsSumDaily = summary.find((m) => m.field === "buyouts_sum")?.daily ?? days.map(() => 0);
  const adIdx = summary.findIndex((m) => m.field === "drr");
  summary.splice(adIdx + 1, 0,
    { field: "gross", label: "Валовая, ₽", kind: "money", daily: grossDaily, total: Math.round(grossTotal), forecast: Math.round(grossTotal), group_start: true },
    { field: "margin_pct", label: "Маржа, %", kind: "pct", daily: days.map((_, i) => { const bsv = Number(buyoutsSumDaily[i] ?? 0); const g = grossDaily[i]; return bsv > 0 && g != null ? Math.round((g / bsv) * 1000) / 10 : null; }), total: buyoutsSumTotal > 0 ? Math.round((grossTotal / buyoutsSumTotal) * 1000) / 10 : 0, forecast: null },
  );
  // GMROI сводки — из агрегированной валовой / деньги в остатках
  const gmroiM = summary.find((m) => m.field === "gmroi");
  if (gmroiM) gmroiM.total = stockMoneyTotal > 0 ? Math.round(Math.min(999, (grossTotal / stockMoneyTotal) * 100) * 10) / 10 : 0;

  return { shop_label: shopLabel || "Все кабинеты", sku_count: skus.length, period, summary, skus };
}
