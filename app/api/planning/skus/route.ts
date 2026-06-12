import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

interface RpcRow {
  nm_id: number;
  article: string;
  stock: number;
}

// Контракт inferno: {skus:[{art,name,cat,ms_stock,wb_stock,wb_own,wb_jc}], count, ...}
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ skus: [], count: 0 });

  const [rpcRes, costsRes] = await Promise.all([
    db.rpc("rnp_report"),
    db.from("product_costs").select("article, name, brand"),
  ]);

  const meta = new Map<string, { name: string; cat: string }>();
  for (const c of costsRes.data ?? []) {
    meta.set(c.article as string, { name: (c.name as string) ?? "", cat: (c.brand as string) || "Без категории" });
  }

  const skus = ((rpcRes.data ?? []) as RpcRow[])
    .map((r) => {
      const m = meta.get(r.article);
      const wb = Number(r.stock ?? 0);
      return {
        art: r.article || String(r.nm_id),
        name: m?.name || r.article || String(r.nm_id),
        cat: m?.cat || "Без категории",
        ms_stock: 0,
        wb_stock: wb,
        wb_own: wb,
        wb_jc: 0,
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
