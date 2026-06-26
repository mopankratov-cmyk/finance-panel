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
  try {
    const cards = await fetchCabinetCards(null);
    // дедуп по артикулу (берём первый nm_id)
    const byArt = new Map<string, { article: string; name: string; nm_id: number; niche: string | null; shop: string }>();
    for (const c of cards) {
      if (!c.article) continue;
      if (!byArt.has(c.article)) byArt.set(c.article, { article: c.article, name: c.name || c.article, nm_id: c.nm_id, niche: nicheFor(c.name, c.article), shop: c.shop });
    }

    // проверенные картинки из каталога (disk='wb') — первая на артикул
    const imgByArt: Record<string, string> = {};
    const statByArt: Record<string, { realFrames: number; gens: number; hasWinner: boolean; bestOtk: number | null; lastOtk: number | null }> = {};
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
      try {
        const arts = Array.from(byArt.keys());
        for (let i = 0; i < arts.length; i += 200) {
          const chunk = arts.slice(i, i + 200);
          const { data } = await db.from("content_assets")
            .select("article,disk,is_winner")
            .in("article", chunk)
            .not("url", "is", null)
            .limit(2000);
          for (const r of data || []) {
            if (!r.article) continue;
            const s = statByArt[r.article] || { realFrames: 0, gens: 0, hasWinner: false, bestOtk: null, lastOtk: null };
            if (r.disk === "gen") s.gens += 1;
            else if (r.disk !== "wb") s.realFrames += 1;
            if (r.is_winner) s.hasWinner = true;
            statByArt[r.article] = s;
          }
        }
      } catch {
        /* статистика опциональна: старые БД могут быть без is_winner/analysis */
      }
      try {
        const arts = Array.from(byArt.keys());
        for (let i = 0; i < arts.length; i += 200) {
          const chunk = arts.slice(i, i + 200);
          const { data } = await db.from("node_recipes")
            .select("article,status,otk_score")
            .in("article", chunk)
            .not("otk_score", "is", null)
            .limit(2000);
          for (const r of data || []) {
            if (!r.article) continue;
            const s = statByArt[r.article] || { realFrames: 0, gens: 0, hasWinner: false, bestOtk: null, lastOtk: null };
            const otk = Number(r.otk_score);
            if (Number.isFinite(otk)) {
              s.bestOtk = s.bestOtk == null ? otk : Math.max(s.bestOtk, otk);
              s.lastOtk = otk;
            }
            statByArt[r.article] = s;
          }
        }
      } catch {
        /* рецепты могут отсутствовать в старой схеме */
      }
    }

    const items = Array.from(byArt.values()).map((p) => ({
      article: p.article,
      name: p.name,
      nm_id: p.nm_id,
      niche: p.niche,                                   // тонкая ниша (cream/…) — для market-модуля
      cniche: nicheFromArticle(p.article, p.name || ""),// КАНОНИЧЕСКАЯ ниша студии (cosmetics/clothing/toys/default)
      shop: p.shop,
      img: imgByArt[p.article] || wbCardImageUrl(p.nm_id),
      realFrames: statByArt[p.article]?.realFrames || 0,
      gens: statByArt[p.article]?.gens || 0,
      hasWinner: !!statByArt[p.article]?.hasWinner,
      bestOtk: statByArt[p.article]?.bestOtk ?? null,
      lastOtk: statByArt[p.article]?.lastOtk ?? null,
    }));
    items.sort((a, b) => a.article.localeCompare(b.article));
    return NextResponse.json({ count: items.length, items });
  } catch (e) {
    return NextResponse.json({ warning: "каталог товаров временно недоступен: " + String((e as Error)?.message || e).slice(0, 180), count: 0, items: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
