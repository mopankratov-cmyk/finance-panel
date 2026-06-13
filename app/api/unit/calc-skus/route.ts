import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RpcRow { nm_id: number; article: string; orders_month: number; orders_sum_month: number; cost: number | null }

// Список SKU для калькулятора цены (inferno pickCalcSku): {skus:[{art,nm,category,cur_price,cogs,ff,comm_optima,shop}]}.
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ skus: [] });

  const [rpcRes, costsRes] = await Promise.all([
    db.rpc("rnp_report"),
    db.from("product_costs").select("article, name"),
  ]);
  const nameByArt = new Map<string, string>();
  for (const c of costsRes.data ?? []) nameByArt.set(c.article as string, (c.name as string) ?? "");

  const skus = ((rpcRes.data ?? []) as RpcRow[]).map((r) => {
    const orders = r.orders_month || 0;
    const rev = Number(r.orders_sum_month || 0);
    return {
      art: r.article || String(r.nm_id),
      nm: r.nm_id,
      category: nameByArt.get(r.article) || "",
      cur_price: orders > 0 ? Math.round(rev / orders) : null,
      cogs: r.cost != null ? Math.round(Number(r.cost)) : 0,
      ff: null, // фулфилмент вводится вручную
      comm_optima: null, // комиссия по категории — файл Optima отложен
      shop: "Магазин",
    };
  });

  return NextResponse.json({ skus, count: skus.length });
}
