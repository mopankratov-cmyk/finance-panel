import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";
import { requireApiSession } from "@/lib/auth/apiGuard";
import { loadRnpReportRows } from "@/lib/rnp/rpcLoaders";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface AdRow { nm_id: number; date: string; views: number; clicks: number; spent: number }
interface FunnelRow { nm_id: number; date: string; orders_sum: number }
interface RpcTotal { nm_id: number; article: string; stock: number }

const r2 = (v: number) => Math.round(v * 100) / 100;

// Рекламная аналитика по SKU за N дней: {items:[{nm,art,views,spend,ctr,cpc,drr,stock}]}.
export async function GET(request: NextRequest) {
  const gate = await requireApiSession();
  if (gate) return gate;
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const sp = new URL(request.url).searchParams;
  const days = Math.min(90, Math.max(1, Math.trunc(Number(sp.get("days")) || 7)));
  // Произвольный диапазон (?date_from=&date_to=) в дополнение к пресету ?days=.
  const dateFrom = sp.get("date_from");
  const dateTo = sp.get("date_to");
  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  const customDays = dateFrom && dateTo ? Math.ceil((Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86_400_000) + 1 : 0;
  const useCustom = Boolean(dateFrom && dateTo && ISO_RE.test(dateFrom) && ISO_RE.test(dateTo) && dateFrom <= dateTo && customDays > 0 && customDays <= 90);
  const since = useCustom ? dateFrom : new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { cabinetId } = await resolveShopCabinet(sp.get("cabinet") ?? undefined);
  if (!cabinetId) return NextResponse.json({ error: "Выберите один реальный WB-кабинет" }, { status: 400 });
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const allowedNmIds = await requestAllowedNmIds(cabinetId);

  // Факты по дням читаются постранично: 90 дней на сотне артикулов — это девять
  // тысяч строк, а Supabase молча отдаёт первую тысячу. Обрезанная выборка не
  // отличается от честной: CTR просто считается по куску периода.
  const nmIds = allowedNmIds ? (allowedNmIds.size ? [...allowedNmIds] : [-1]) : null;
  const withScope = <Q extends { lte: (column: string, value: string) => Q; in: (column: string, values: number[]) => Q }>(query: Q) => {
    let scoped = query;
    if (useCustom) scoped = scoped.lte("date", dateTo!);
    if (nmIds) scoped = scoped.in("nm_id", nmIds);
    return scoped;
  };
  const [adRes, funnelRes, totals] = await Promise.all([
    loadAllSupabasePages<AdRow>((from, to) => withScope(db
      .from("wb_advert_nm_daily")
      .select("nm_id, date, views, clicks, spent")
      .gte("date", since)
      .eq("cabinet_id", cabinetId)
      .order("date", { ascending: true })
      .order("nm_id", { ascending: true })
      .range(from, to)), { label: "CTR-тест: реклама по дням", maxPages: 100 }),
    loadAllSupabasePages<FunnelRow>((from, to) => withScope(db
      .from("wb_funnel_daily")
      .select("nm_id, date, orders_sum")
      .gte("date", since)
      .eq("cabinet_id", cabinetId)
      .order("date", { ascending: true })
      .order("nm_id", { ascending: true })
      .range(from, to)), { label: "CTR-тест: воронка по дням", maxPages: 100 }),
    loadRnpReportRows<RpcTotal>(db, cabinetId, {
      allowedNmIds,
      label: "CTR-тест: товары WB",
    }),
  ]);

  const acc = new Map<number, { views: number; clicks: number; spent: number; os: number }>();
  const get = (nm: number) => { let a = acc.get(nm); if (!a) { a = { views: 0, clicks: 0, spent: 0, os: 0 }; acc.set(nm, a); } return a; };
  for (const a of adRes) { if (!requestAllowsNm(allowedNmIds, a.nm_id)) continue; const x = get(a.nm_id); x.views += a.views || 0; x.clicks += a.clicks || 0; x.spent += Number(a.spent || 0); }
  for (const f of funnelRes) { if (!requestAllowsNm(allowedNmIds, f.nm_id)) continue; const x = get(f.nm_id); x.os += Number(f.orders_sum || 0); }

  const meta = new Map<number, RpcTotal>();
  for (const t of totals) if (requestAllowsNm(allowedNmIds, t.nm_id)) meta.set(t.nm_id, t);

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
