import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface FunnelRow { nm_id: number; date: string; open_card: number; add_to_cart: number; orders: number; orders_sum: number }
interface AdRow { nm_id: number; date: string; views: number; clicks: number; spent: number }

const r2 = (v: number) => Math.round(v * 100) / 100;

// Контракт inferno: {metrics: {nm: {iso: {views, clicks, carts, orders_count, ctr, cr, orders_sum}}}} — посуточные дата-ячейки.
export async function GET(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ metrics: {} });

  const p_cabinet = cabinetIdFromParam(new URL(req.url).searchParams.get("cabinet")); // null → все кабинеты
  if (!(await hasCabinetAccess(p_cabinet))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const allowedNmIds = await requestAllowedNmIds(p_cabinet);
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  let funnelQ = db.from("wb_funnel_daily").select("nm_id, date, open_card, add_to_cart, orders, orders_sum").gte("date", since);
  let adQ = db.from("wb_advert_nm_daily").select("nm_id, date, views, clicks, spent").gte("date", since);
  if (p_cabinet) { funnelQ = funnelQ.eq("cabinet_id", p_cabinet); adQ = adQ.eq("cabinet_id", p_cabinet); }
  if (allowedNmIds) {
    const nmIds = allowedNmIds.size ? [...allowedNmIds] : [-1];
    funnelQ = funnelQ.in("nm_id", nmIds);
    adQ = adQ.in("nm_id", nmIds);
  }
  const [funnelRes, adRes] = await Promise.all([funnelQ, adQ]);

  const metrics: Record<number, Record<string, Record<string, number | null>>> = {};
  const cell = (nm: number, iso: string) => {
    (metrics[nm] ||= {});
    return (metrics[nm][iso] ||= {});
  };

  for (const a of (adRes.data ?? []) as AdRow[]) {
    if (!requestAllowsNm(allowedNmIds, a.nm_id)) continue;
    const iso = String(a.date).slice(0, 10);
    const c = cell(a.nm_id, iso);
    c.views = a.views || 0;
    c.clicks = a.clicks || 0;
    c.advert_sum = Math.round(Number(a.spent || 0));
    c.ctr = a.views > 0 ? r2((a.clicks / a.views) * 100) : null;
    c._spent = Number(a.spent || 0);
  }
  for (const f of (funnelRes.data ?? []) as FunnelRow[]) {
    if (!requestAllowsNm(allowedNmIds, f.nm_id)) continue;
    const iso = String(f.date).slice(0, 10);
    const c = cell(f.nm_id, iso);
    c.carts = f.add_to_cart || 0;
    c.orders_count = f.orders || 0;
    c.orders_sum = Math.round(Number(f.orders_sum || 0));
    c.cr = f.add_to_cart > 0 ? r2((f.orders / f.add_to_cart) * 100) : null;
    const os = Number(f.orders_sum || 0);
    c.drr = os > 0 ? r2((Number(c._spent || 0) / os) * 100) : null;
  }
  // убрать служебное поле
  for (const nm of Object.keys(metrics)) for (const iso of Object.keys(metrics[+nm])) delete metrics[+nm][iso]._spent;

  return NextResponse.json({ metrics });
}
