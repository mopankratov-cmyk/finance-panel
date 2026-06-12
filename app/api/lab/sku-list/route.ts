import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbCardImageUrl } from "@/lib/wb/cardImage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RpcTotal { nm_id: number; article: string }

// Список SKU для выбора в CTR-тестах / контент-лаб. Контракт: {items:[{nm,art,name,shop,img_url}]}.
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ items: [] });

  const [totalsRes, costsRes] = await Promise.all([
    db.rpc("rnp_report"),
    db.from("product_costs").select("article, name"),
  ]);
  const nameByArt = new Map<string, string>();
  for (const c of costsRes.data ?? []) nameByArt.set(c.article as string, (c.name as string) ?? "");

  const items = ((totalsRes.data ?? []) as RpcTotal[]).map((t) => ({
    nm: t.nm_id,
    art: t.article || String(t.nm_id),
    name: nameByArt.get(t.article) || t.article || String(t.nm_id),
    shop: "JC",
    img_url: wbCardImageUrl(t.nm_id),
  }));

  return NextResponse.json({ items, count: items.length });
}
