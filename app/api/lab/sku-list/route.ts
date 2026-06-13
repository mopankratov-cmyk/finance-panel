import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { SKU_YANDEX_FOLDER } from "@/lib/lab/skuFolders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RpcTotal { nm_id: number; article: string }

const b64 = (s: string) => Buffer.from(s).toString("base64url");

// Список SKU для контент-лаб. folder_id = base64 пути контента на Яндекс.Диске (если есть).
export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ items: [] });

  const [totalsRes, costsRes] = await Promise.all([
    db.rpc("rnp_report"),
    db.from("product_costs").select("article, name"),
  ]);
  const nameByArt = new Map<string, string>();
  for (const c of costsRes.data ?? []) nameByArt.set(c.article as string, (c.name as string) ?? "");

  const items = ((totalsRes.data ?? []) as RpcTotal[]).map((t) => {
    const art = t.article || String(t.nm_id);
    const yp = SKU_YANDEX_FOLDER[art];
    return { nm: t.nm_id, art, name: nameByArt.get(t.article) || art, shop: "JC", img_url: wbCardImageUrl(t.nm_id), folder_id: yp ? b64(yp) : null, has_content: !!yp };
  });

  // добавить смапленные на Яндекс артикулы, которых нет в rnp_report (напр. сумки без свежих заказов)
  const present = new Set(items.map((i) => i.art));
  for (const [art, yp] of Object.entries(SKU_YANDEX_FOLDER)) {
    if (present.has(art)) continue;
    items.push({ nm: 0, art, name: nameByArt.get(art) || art, shop: "JC", img_url: "", folder_id: b64(yp), has_content: true });
  }

  // SKU с готовым контентом — вперёд
  items.sort((a, b) => Number(b.has_content) - Number(a.has_content));
  return NextResponse.json({ items, count: items.length });
}
