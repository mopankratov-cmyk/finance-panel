import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getActiveOzonCreds } from "@/lib/ozon/cabinet";
import { ozonPrices, ozonImages } from "@/lib/ozon/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Ozon юнит-экономика: цена, комиссия, логистика, себес (МойСклад/product_costs), маржа на ед.
export async function GET(request: NextRequest) {
  const cab = await getActiveOzonCreds(new URL(request.url).searchParams.get("cabinet"));
  if (!cab.ok) return NextResponse.json({ rows: [], error: cab.error, noCabinet: true });

  const r = await ozonPrices(cab.creds);
  if (!r.ok) return NextResponse.json({ rows: [], error: r.error }, { status: 502 });

  // себес по артикулу (offer_id) из product_costs
  const db = getSupabaseAdmin();
  const costByArt = new Map<string, number>();
  const nameByArt = new Map<string, string>();
  if (db) {
    const { data } = await db.from("product_costs").select("article, name, cost_rub");
    for (const c of data ?? []) {
      costByArt.set(c.article as string, Number(c.cost_rub ?? 0));
      nameByArt.set(c.article as string, (c.name as string) ?? "");
    }
  }

  const { byOffer } = await ozonImages(cab.creds);
  const rows = r.rows.map((p) => {
    const cost = costByArt.get(p.offer_id) ?? 0;
    const commissionRub = Math.round((p.price * p.commissionPct) / 100);
    const profit = Math.round(p.price - cost - commissionRub - p.logistics - p.acquiring);
    const margin = p.price > 0 ? Math.round((profit / p.price) * 1000) / 10 : null;
    return {
      art: p.offer_id, product_id: p.product_id, name: nameByArt.get(p.offer_id) || p.offer_id, img_url: byOffer[p.offer_id] ?? null,
      price: Math.round(p.price), cost: Math.round(cost),
      commission_pct: p.commissionPct, commission_rub: commissionRub,
      logistics: Math.round(p.logistics), acquiring: Math.round(p.acquiring),
      profit, margin,
    };
  }).filter((x) => x.price > 0).sort((a, b) => (b.margin ?? -999) - (a.margin ?? -999));

  return NextResponse.json({ cabinet: cab.name, rows, count: rows.length });
}
