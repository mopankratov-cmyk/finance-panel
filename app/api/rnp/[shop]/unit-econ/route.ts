import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { hasCabinetAccess } from "@/lib/auth/cabinetAccess";
import { requestAllowedNmIds, requestAllowsNm } from "@/lib/wb/requestProductScope";
import { loadRnpReportRows } from "@/lib/rnp/rpcLoaders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RpcRow { nm_id: number; article: string; orders_month: number; orders_sum_month: number; cost: number | null }

// Юнит-экономика по SKU для режима планирования РНП. {econ:{<nm>:{cost,price,margin}}}.
export async function GET(_request: Request, ctx: { params: Promise<{ shop: string }> }) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ econ: {} });
  const { shop } = await ctx.params;
  const { cabinetId } = await resolveShopCabinet(shop);
  if (shop !== "all" && !cabinetId) return NextResponse.json({ error: "WB-кабинет не найден" }, { status: 404 });
  if (!(await hasCabinetAccess(cabinetId))) {
    return NextResponse.json({ error: "Нет доступа к выбранному WB-кабинету" }, { status: 403 });
  }
  const allowedNmIds = await requestAllowedNmIds(cabinetId);
  const data = await loadRnpReportRows<RpcRow>(db, cabinetId, {
    allowedNmIds,
    label: "РНП планирование: юнит-экономика",
  });
  const econ: Record<string, { cost: number; price: number; margin: number | null }> = {};
  for (const r of data) {
    if (!requestAllowsNm(allowedNmIds, r.nm_id)) continue;
    const orders = r.orders_month || 0;
    const price = orders > 0 ? Math.round(Number(r.orders_sum_month || 0) / orders) : 0;
    const cost = Math.round(Number(r.cost ?? 0));
    econ[String(r.nm_id)] = {
      cost,
      price,
      margin: price > 0 && cost > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : null,
    };
  }
  return NextResponse.json({ econ });
}
