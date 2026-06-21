import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchCabinetCards } from "@/lib/wb/cards";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { nicheFor } from "@/lib/factory/contentDisks";
import { nicheFromArticle } from "@/lib/factory/rubric";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Полный список товаров ВСЕХ кабинетов (вкл. куртки NORVIA из Retail Family) с картинкой.
// Картинку берём из каталога WB-фото (проверенный URL), иначе детерминированный wbCardImageUrl.
// Для Шага 1 кокпита: чтобы в списке были все товары и у каждого была картинка.
export async function GET() {
  const cards = await fetchCabinetCards(null);
  // дедуп по артикулу (берём первый nm_id)
  const byArt = new Map<string, { article: string; name: string; nm_id: number; niche: string | null; shop: string }>();
  for (const c of cards) {
    if (!c.article) continue;
    if (!byArt.has(c.article)) byArt.set(c.article, { article: c.article, name: c.name || c.article, nm_id: c.nm_id, niche: nicheFor(c.name, c.article), shop: c.shop });
  }

  // проверенные картинки из каталога (disk='wb') — первая на артикул
  const imgByArt: Record<string, string> = {};
  const db = getSupabaseAdmin();
  if (db) {
    try {
      const arts = Array.from(byArt.keys());
      for (let i = 0; i < arts.length; i += 200) {
        const chunk = arts.slice(i, i + 200);
        const { data } = await db.from("content_assets").select("article,url").eq("disk", "wb").in("article", chunk);
        for (const r of data || []) { if (r.article && r.url && !imgByArt[r.article]) imgByArt[r.article] = r.url as string; }
      }
    } catch { /* каталога нет — упадём на детерминированный URL */ }
  }

  const items = Array.from(byArt.values()).map((p) => ({
    article: p.article,
    name: p.name,
    nm_id: p.nm_id,
    niche: p.niche,                                   // тонкая ниша (cream/…) — для market-модуля
    cniche: nicheFromArticle(p.article, p.name || ""),// КАНОНИЧЕСКАЯ ниша студии (cosmetics/clothing/toys/default)
    shop: p.shop,
    img: imgByArt[p.article] || wbCardImageUrl(p.nm_id),
  }));
  items.sort((a, b) => a.article.localeCompare(b.article));
  return NextResponse.json({ count: items.length, items });
}
