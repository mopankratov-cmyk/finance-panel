import { NextRequest, NextResponse } from "next/server";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";
import { loadRnpReportRows } from "@/lib/rnp/rpcLoaders";

export const dynamic = "force-dynamic";

interface RpcRow {
  nm_id: number;
  article: string;
  orders_week: number;
  orders_sum_week: number;
  orders_month: number;
  orders_sum_month: number;
  stock: number;
}

// Контракт inferno: {skus:[{art,name,cat,ms_stock,wb_stock,wb_own,wb_jc}], count, ...}
export async function GET(request: NextRequest) {
  const { cabinetId } = await resolveShopCabinet(new URL(request.url).searchParams.get("cabinet") ?? undefined);
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к кабинету" }, { status: 403 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ skus: [], count: 0 });
  const allowedNmIds = await requestAllowedNmIds(cabinetId);

  const [rpcRes, costsRes] = await Promise.all([
    loadRnpReportRows<RpcRow>(db, cabinetId, {
      allowedNmIds,
      label: "Планирование WB: товары",
    }),
    db.from("product_costs").select("article, name, brand"),
  ]);

  const meta = new Map<string, { name: string; cat: string }>();
  for (const c of costsRes.data ?? []) {
    meta.set(c.article as string, { name: (c.name as string) ?? "", cat: (c.brand as string) || "Без категории" });
  }

  const skus = rpcRes
    .filter((row) => requestAllowsNm(allowedNmIds, row.nm_id))
    .map((r) => {
      const m = meta.get(r.article);
      const wb = Number(r.stock ?? 0);
      return {
        nm_id: r.nm_id,
        external_id: String(r.nm_id),
        art: r.article || String(r.nm_id),
        name: m?.name || r.article || String(r.nm_id),
        cat: m?.cat || "Без категории",
        ms_stock: 0,
        wb_stock: wb,
        wb_own: wb,
        wb_jc: 0,
        orders_week: Number(r.orders_week ?? 0),
        orders_sum_week: Number(r.orders_sum_week ?? 0),
        orders_month: Number(r.orders_month ?? 0),
        orders_sum_month: Number(r.orders_sum_month ?? 0),
        avg_daily_7: Number(r.orders_week ?? 0) / 7,
        avg_price_month: Number(r.orders_month ?? 0) > 0 ? Number(r.orders_sum_month ?? 0) / Number(r.orders_month ?? 0) : 0,
        seasonality_factor: 1,
        demand_factor: 1,
      };
    })
    .sort((a, b) => a.art.localeCompare(b.art));

  return NextResponse.json({
    skus,
    count: skus.length,
    wb_stock_date: new Date().toISOString().slice(0, 10),
    jc_stock_date: null,
    ms_matched: 0,
    wb_matched: skus.length,
    wb_jc_matched: 0,
  });
}
