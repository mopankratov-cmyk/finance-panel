import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getWbCommissionMerged } from "@/lib/wb/commissions";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { cabinetIdFromParam } from "@/lib/rnp/resolveShop";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RpcRow {
  nm_id: number; article: string;
  orders_month: number; orders_sum_month: number;
  buyouts_month: number; buyouts_sum_month: number;
  stock: number; cost: number | null; ad_spend_month: number;
}

const TAX = 7;

// ABC-анализ прибыли: какие SKU дают основную долю чистой прибыли (A/B/C) + убыточный «хвост».
export async function GET(req: NextRequest) {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
  const p_cabinet = cabinetIdFromParam(new URL(req.url).searchParams.get("cabinet"));

  const [rpcRes, costsRes, comm] = await Promise.all([
    db.rpc("rnp_report", { p_cabinet }),
    db.from("product_costs").select("article, name"),
    getWbCommissionMerged(30),
  ]);
  const nameByArt = new Map<string, string>();
  for (const c of costsRes.data ?? []) nameByArt.set(c.article as string, (c.name as string) ?? "");
  const acq = comm.avgAcqPct > 0 ? comm.avgAcqPct : 1.5;
  const commForNm = (nm: number) => comm.byNm.get(nm)?.pct ?? (comm.avgPct > 0 ? comm.avgPct : 25);

  const items = ((rpcRes.data ?? []) as RpcRow[]).map((r) => {
    const bs = Number(r.buyouts_sum_month ?? 0);
    const bc = Number(r.buyouts_month ?? 0);
    const cost = Number(r.cost ?? 0);
    const ad = Number(r.ad_spend_month ?? 0);
    const c = commForNm(r.nm_id);
    // чистая прибыль за 30 дней = выручка с выкупов − себес − комиссия% − эквайринг% − налог% − реклама
    const profit = Math.round(bs - cost * bc - bs * (c + acq + TAX) / 100 - ad);
    const rev = Math.round(Number(r.orders_sum_month ?? 0));
    return {
      nm: r.nm_id, art: r.article || String(r.nm_id), name: nameByArt.get(r.article) || "",
      img_url: wbCardImageUrl(r.nm_id), revenue: rev, profit,
      margin: bs > 0 ? Math.round((profit / bs) * 1000) / 10 : null,
    };
  });

  // ранжируем по прибыли; накопительная доля по положительной прибыли → классы A/B/C
  const profitable = items.filter((i) => i.profit > 0).sort((a, b) => b.profit - a.profit);
  const losers = items.filter((i) => i.profit <= 0).sort((a, b) => a.profit - b.profit);
  const totalProfit = profitable.reduce((s, i) => s + i.profit, 0);

  let cum = 0;
  const ranked = profitable.map((i) => {
    cum += i.profit;
    const cumPct = totalProfit > 0 ? (cum / totalProfit) * 100 : 0;
    const cls = cumPct <= 80 ? "A" : cumPct <= 95 ? "B" : "C";
    return { ...i, cumPct: Math.round(cumPct * 10) / 10, share: totalProfit > 0 ? Math.round((i.profit / totalProfit) * 1000) / 10 : 0, cls };
  });
  const tail = losers.map((i) => ({ ...i, cumPct: null, share: null, cls: "D" }));

  const counts = { A: 0, B: 0, C: 0, D: tail.length };
  for (const r of ranked) counts[r.cls as "A" | "B" | "C"]++;

  return NextResponse.json({
    rows: [...ranked, ...tail],
    totalProfit,
    counts,
    skuTotal: items.length,
    aShareOfSku: items.length > 0 ? Math.round((counts.A / items.length) * 1000) / 10 : 0,
    period_days: 30,
  });
}
