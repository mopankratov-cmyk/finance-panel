import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbCardImageUrl } from "@/lib/wb/cardImage";

export const dynamic = "force-dynamic";

interface RpcRow {
  nm_id: number;
  article: string;
  orders_month: number;
  orders_sum_month: number;
  cost: number | null;
  ad_spend_month: number;
}

// Контракт inferno: {headers:[], rows:[[...]], img_urls:[], source_url, meta_text}
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ headers: [], rows: [], img_urls: [] });

  const [rpcRes, costsRes] = await Promise.all([
    db.rpc("rnp_report"),
    db.from("product_costs").select("article, name"),
  ]);
  const nameByArt = new Map<string, string>();
  for (const c of costsRes.data ?? []) nameByArt.set(c.article as string, (c.name as string) ?? "");

  const rows: (string | number)[][] = [];
  const img_urls: string[] = [];

  const sorted = ((rpcRes.data ?? []) as RpcRow[])
    .slice()
    .sort((a, b) => Number(b.orders_sum_month) - Number(a.orders_sum_month));

  for (const r of sorted) {
    const orders = r.orders_month;
    const rev = Number(r.orders_sum_month);
    const cost = Number(r.cost ?? 0);
    const ad = Number(r.ad_spend_month ?? 0);
    const avgPrice = orders > 0 ? Math.round(rev / orders) : 0;
    const drr = rev > 0 ? Math.round((ad / rev) * 1000) / 10 : 0;
    const marginUnit = orders > 0 ? Math.round(avgPrice - cost - ad / orders) : 0;
    rows.push([
      r.article || String(r.nm_id),
      "", // фото (col index 1)
      nameByArt.get(r.article) || "",
      Math.round(cost),
      avgPrice,
      orders,
      Math.round(rev),
      Math.round(ad),
      drr,
      marginUnit,
    ]);
    img_urls.push(wbCardImageUrl(r.nm_id));
  }

  return NextResponse.json({
    headers: ["Артикул", "", "Название", "Себес ₽", "Ср. цена ₽", "Заказы/мес", "Выручка ₽", "Реклама ₽", "ДРР %", "Маржа/ед ₽"],
    rows,
    img_urls,
    source_url: null,
    meta_text: `Юнит-экономика по ${rows.length} SKU (за 30 дней)`,
  });
}
