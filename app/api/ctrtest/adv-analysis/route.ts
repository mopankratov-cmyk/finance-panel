import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface AdRow { nm_id: number; date: string; views: number; clicks: number; spent: number }
interface FunnelRow { nm_id: number; date: string; orders_sum: number }
interface RpcTotal { nm_id: number; article: string; stock: number }

const r2 = (v: number) => Math.round(v * 100) / 100;

// Рекламная аналитика по SKU за N дней: {items:[{nm,art,views,spend,ctr,cpc,drr,stock}]}.
export async function GET(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ items: [] });
  const sp = new URL(request.url).searchParams;
  const days = Number(sp.get("days")) || 7;
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { cabinetId } = await resolveShopCabinet(sp.get("cabinet") ?? undefined);

  let adQ = db.from("wb_advert_nm_daily").select("nm_id, date, views, clicks, spent").gte("date", since);
  let funnelQ = db.from("wb_funnel_daily").select("nm_id, date, orders_sum").gte("date", since);
  if (cabinetId) { adQ = adQ.eq("cabinet_id", cabinetId); funnelQ = funnelQ.eq("cabinet_id", cabinetId); }
  const [adRes, funnelRes, totalsRes] = await Promise.all([adQ, funnelQ, db.rpc("rnp_report", { p_cabinet: cabinetId })]);

  const acc = new Map<number, { views: number; clicks: number; spent: number; os: number }>();
  const get = (nm: number) => { let a = acc.get(nm); if (!a) { a = { views: 0, clicks: 0, spent: 0, os: 0 }; acc.set(nm, a); } return a; };
  for (const a of (adRes.data ?? []) as AdRow[]) { const x = get(a.nm_id); x.views += a.views || 0; x.clicks += a.clicks || 0; x.spent += Number(a.spent || 0); }
  for (const f of (funnelRes.data ?? []) as FunnelRow[]) { const x = get(f.nm_id); x.os += Number(f.orders_sum || 0); }

  const meta = new Map<number, RpcTotal>();
  for (const t of (totalsRes.data ?? []) as RpcTotal[]) meta.set(t.nm_id, t);

  const items = [...acc.entries()].map(([nm, a]) => {
    const t = meta.get(nm);
    return {
      nm, art: t?.article || String(nm),
      views: a.views,
      spend: Math.round(a.spent),
      ctr: a.views > 0 ? r2((a.clicks / a.views) * 100) : null,
      cpc: a.clicks > 0 ? r2(a.spent / a.clicks) : null,
      drr: a.os > 0 ? r2((a.spent / a.os) * 100) : null,
      stock: Number(t?.stock ?? 0),
    };
  }).filter((r) => r.views > 0 || r.spend > 0).sort((x, y) => y.views - x.views);

  return NextResponse.json({ items, count: items.length, days });
}
