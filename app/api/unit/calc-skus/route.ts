import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveShopCabinet } from "@/lib/rnp/resolveShop";
import { getWbCabinet, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { getWbCommission, getWbCommissionMerged } from "@/lib/wb/commissions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RpcRow { nm_id: number; article: string; orders_month: number; orders_sum_month: number; cost: number | null }

// Список SKU для калькулятора цены (inferno pickCalcSku): {skus:[{art,nm,category,cur_price,cogs,ff,comm_optima,shop}]}.
// comm_optima = ФАКТ-комиссия % по nm из финотчёта выбранного кабинета (раньше был хардкод JoyCity 38.5%).
export async function GET(request: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ skus: [] });

  const { cabinetId, label } = await resolveShopCabinet(new URL(request.url).searchParams.get("cabinet") ?? undefined);

  // токен выбранного кабинета для факт-комиссии (иначе ENV)
  const cab = cabinetId ? await getWbCabinet(cabinetId) : null;
  const commToken = cab ? resolveWbToken(cab, "statistics") : undefined;

  const [rpcRes, costsRes, comm] = await Promise.all([
    db.rpc("rnp_report", { p_cabinet: cabinetId }),
    db.from("product_costs").select("article, name"),
    // конкретный кабинет → его финотчёт; «Все» → мердж по всем кабинетам (ENV пуст)
    cabinetId ? getWbCommission(30, { token: commToken, cacheKey: cabinetId }) : getWbCommissionMerged(30),
  ]);
  const nameByArt = new Map<string, string>();
  for (const c of costsRes.data ?? []) nameByArt.set(c.article as string, (c.name as string) ?? "");

  const shopLabel = label || "Все кабинеты";
  const skus = ((rpcRes.data ?? []) as RpcRow[]).map((r) => {
    const orders = r.orders_month || 0;
    const rev = Number(r.orders_sum_month || 0);
    const factPct = comm.byNm.get(r.nm_id)?.pct ?? (comm.avgPct > 0 ? comm.avgPct : null);
    return {
      art: r.article || String(r.nm_id),
      nm: r.nm_id,
      category: nameByArt.get(r.article) || "",
      cur_price: orders > 0 ? Math.round(rev / orders) : null,
      cogs: r.cost != null ? Math.round(Number(r.cost)) : 0,
      ff: null, // фулфилмент вводится вручную
      comm_optima: factPct, // факт-комиссия % из финотчёта кабинета (фолбэк — средняя по кабинету)
      shop: shopLabel,
    };
  });

  return NextResponse.json({ skus, count: skus.length });
}
