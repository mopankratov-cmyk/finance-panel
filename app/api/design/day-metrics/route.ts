import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { loadHourlyDashboard } from "@/lib/cache/hourlyDashboard";
import { closedMoscowDates } from "@/lib/wb/sklejki";
import { buildWbFunnelDayMetrics } from "@/lib/wb/funnelMetrics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface FunnelRow { nm_id: number; date: string; open_card: number; add_to_cart: number; orders: number; orders_sum: number }
interface AdRow { nm_id: number; date: string; views: number; clicks: number; spent: number }

// Контракт inferno: {metrics: {nm: {iso: {views, clicks, carts, orders_count, ctr, cr, orders_sum}}}} — посуточные дата-ячейки.
export async function GET(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ metrics: {} });

  const p_cabinet = cabinetIdFromParam(new URL(req.url).searchParams.get("cabinet")); // null → все кабинеты
  if (!(await hasCabinetAccess(p_cabinet))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const allowedNmIds = await requestAllowedNmIds(p_cabinet);
  const since = closedMoscowDates(30)[0];
  const sp = new URL(req.url).searchParams;
  const payload = await loadHourlyDashboard(
    "wb-funnel-day-metrics",
    // Cache schema: 3 did not include cross-cabinet aggregation or card-to-cart CR.
    { cabinetId: p_cabinet, since, schema: 4 },
    async () => {
      const [funnelRows, adRows] = await Promise.all([
        loadAllSupabasePages<FunnelRow>((from, to) => {
          let query = db
            .from("wb_funnel_daily")
            .select("nm_id, date, open_card, add_to_cart, orders, orders_sum")
            .gte("date", since)
            .order("date", { ascending: true })
            .order("nm_id", { ascending: true })
            .range(from, to);
          if (p_cabinet) query = query.eq("cabinet_id", p_cabinet);
          if (allowedNmIds) query = query.in("nm_id", allowedNmIds.size ? [...allowedNmIds] : [-1]);
          return query;
        }, { label: "Воронка WB" }),
        loadAllSupabasePages<AdRow>((from, to) => {
          let query = db
            .from("wb_advert_nm_daily")
            .select("nm_id, date, views, clicks, spent")
            .gte("date", since)
            .order("date", { ascending: true })
            .order("nm_id", { ascending: true })
            .range(from, to);
          if (p_cabinet) query = query.eq("cabinet_id", p_cabinet);
          if (allowedNmIds) query = query.in("nm_id", allowedNmIds.size ? [...allowedNmIds] : [-1]);
          return query;
        }, { label: "Реклама WB" }),
      ]);

  const scopedFunnelRows = funnelRows.filter((row) => requestAllowsNm(allowedNmIds, row.nm_id));
  const scopedAdRows = adRows.filter((row) => requestAllowsNm(allowedNmIds, row.nm_id));
  const metrics = buildWbFunnelDayMetrics(scopedFunnelRows, scopedAdRows);

      return { metrics };
    },
    {
      forceRefresh: sp.get("refresh") === "1",
      backgroundRefresh: sp.get("background") === "1",
    },
  );
  return NextResponse.json(payload, { headers: { "X-Dashboard-Cache": "hourly-snapshot" } });
}
