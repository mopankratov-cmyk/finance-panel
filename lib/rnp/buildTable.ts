import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbCardImageUrl } from "@/lib/wb/cardImage";

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

export interface Metric {
  field: string;
  label: string;
  kind: string;
  daily: (number | null)[];
  total: number;
  forecast: number | null;
  group_start?: boolean;
}

function buildMetrics(days: string[], byDate: Map<string, DailyRow>, stock: number, stockMoney: number): Metric[] {
  const pick = (k: keyof DailyRow) => days.map((d) => Number(byDate.get(d)?.[k] ?? 0));
  const s = (a: number[]) => a.reduce((x, v) => x + v, 0);
  const oc = pick("orders_count"), os = pick("orders_sum"), bc = pick("buyouts_count"), bs = pick("buyouts_sum"), ad = pick("ad_spent");
  const drr = days.map((d) => { const r = byDate.get(d); return r && r.orders_sum > 0 ? Math.round((r.ad_spent / r.orders_sum) * 1000) / 10 : null; });
  const totOs = s(os);
  return [
    { field: "orders_count", label: "Заказы, шт", kind: "int", daily: oc, total: s(oc), forecast: s(oc), group_start: true },
    { field: "orders_sum", label: "Заказы, ₽", kind: "money", daily: os, total: Math.round(totOs), forecast: Math.round(totOs) },
    { field: "buyouts_count", label: "Выкупы, шт", kind: "int", daily: bc, total: s(bc), forecast: s(bc), group_start: true },
    { field: "buyouts_sum", label: "Выкупы, ₽", kind: "money", daily: bs, total: Math.round(s(bs)), forecast: Math.round(s(bs)) },
    { field: "ad_spent", label: "Реклама, ₽", kind: "money", daily: ad, total: Math.round(s(ad)), forecast: Math.round(s(ad)), group_start: true },
    { field: "drr", label: "ДРР, %", kind: "pct", daily: drr, total: totOs > 0 ? Math.round((s(ad) / totOs) * 1000) / 10 : 0, forecast: null },
    { field: "stock", label: "Остаток, шт", kind: "int", daily: days.map(() => null), total: stock, forecast: null, group_start: true },
    { field: "money", label: "Деньги в остатках, ₽", kind: "money", daily: days.map(() => null), total: Math.round(stockMoney), forecast: null },
  ];
}

export interface RnpTable {
  shop_label: string;
  sku_count: number;
  period: { label: string; period_type: string }[];
  summary: Metric[];
  skus: { nm: number; art: string; name: string; img_url: string; metrics: Metric[] }[];
}

export async function buildRnpTable(from: string, to: string): Promise<RnpTable | { error: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { error: "Supabase не настроен" };

  const [dailyRes, skuRes, totalsRes, costsRes] = await Promise.all([
    db.rpc("rnp_daily", { p_from: from, p_to: to }),
    db.rpc("rnp_daily_sku", { p_from: from, p_to: to }),
    db.rpc("rnp_report"),
    db.from("product_costs").select("article, name"),
  ]);
  if (dailyRes.error) return { error: dailyRes.error.message };

  const days: string[] = [];
  const cur = new Date(from), end = new Date(to);
  while (cur <= end) { days.push(cur.toISOString().slice(0, 10)); cur.setDate(cur.getDate() + 1); }
  const period = days.map((d) => { const dt = new Date(d); return { label: `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}`, period_type: WEEKDAY[dt.getDay()] }; });

  const dailyByDate = new Map<string, DailyRow>();
  for (const r of (dailyRes.data ?? []) as DailyRow[]) dailyByDate.set(String(r.d).slice(0, 10), r);
  const totals = (totalsRes.data ?? []) as RpcTotal[];
  const stockTotal = totals.reduce((a, r) => a + Number(r.stock ?? 0), 0);
  const stockMoneyTotal = totals.reduce((a, r) => a + Number(r.stock ?? 0) * Number(r.cost ?? 0), 0);
  const summary = buildMetrics(days, dailyByDate, stockTotal, Math.round(stockMoneyTotal));

  const nameByArt = new Map<string, string>();
  for (const c of costsRes.data ?? []) nameByArt.set(c.article as string, (c.name as string) ?? "");
  const totalByNm = new Map<number, RpcTotal>();
  for (const t of totals) totalByNm.set(t.nm_id, t);
  const byNm = new Map<number, Map<string, DailyRow>>();
  for (const r of (skuRes.data ?? []) as SkuDailyRow[]) {
    if (!byNm.has(r.nm_id)) byNm.set(r.nm_id, new Map());
    byNm.get(r.nm_id)!.set(String(r.d).slice(0, 10), r);
  }

  const skus = [...totalByNm.values()]
    .map((t) => {
      const dmap = byNm.get(t.nm_id) ?? new Map<string, DailyRow>();
      const metrics = buildMetrics(days, dmap, Number(t.stock ?? 0), Math.round(Number(t.stock ?? 0) * Number(t.cost ?? 0)));
      return { nm: t.nm_id, art: t.article || String(t.nm_id), name: nameByArt.get(t.article) || t.article || String(t.nm_id), img_url: wbCardImageUrl(t.nm_id), metrics, _o: metrics[0]?.total ?? 0 };
    })
    .sort((a, b) => b._o - a._o)
    .map(({ _o, ...rest }) => { void _o; return rest; });

  return { shop_label: "Магазин", sku_count: skus.length, period, summary, skus };
}
