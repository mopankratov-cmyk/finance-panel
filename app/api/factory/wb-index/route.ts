import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getWbCardImages } from "@/lib/wb/cardImage";
import { nicheFor } from "@/lib/factory/contentDisks";
import { fetchCabinetCards } from "@/lib/wb/cards";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Row { disk: string; path: string; name: string; kind: "image"; niche: string | null; article: string; color: null; url: string }

// Простой пул конкуррентности.
async function pool<T, R>(items: T[], limit: number, fn: (it: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

// Каталог ВСЕХ фото карточек WB по артикулам (disk='wb', точная привязка к article).
// Источник — Content API всех кабинетов (или ?cabinet=<id>): полнее, чем rnp активного.
// URL карточек публичны и стабильны — байты не качаем, складываем ссылки (FAL фетчит .webp напрямую).
export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    if (!db) return NextResponse.json({ error: "Supabase не настроен" }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const cabinet: string | null = body.cabinet || null;

    const cards = await fetchCabinetCards(cabinet);
    const products = cards.filter((c) => c.nm_id && c.article).map((c) => ({ article: c.article, nm_id: c.nm_id, name: `${c.name} ${c.subject} ${c.color}`.trim() }));
    // дедуп по nm_id
    const seen = new Set<number>();
    const uniq = products.filter((p) => (seen.has(p.nm_id) ? false : (seen.add(p.nm_id), true)));
    if (!uniq.length) return NextResponse.json({ ok: false, reason: "нет карточек (content-токен кабинета?)" });

    const rows: Row[] = [];
    const perProduct = await pool(uniq, 8, async (p) => {
      const imgs = await getWbCardImages(p.nm_id);
      imgs.forEach((url, k) => {
        rows.push({
          disk: "wb",
          path: `${p.nm_id}/${k + 1}`,
          name: `${p.article} · фото ${k + 1}`,
          kind: "image",
          niche: nicheFor(p.name, p.article),
          article: p.article,
          color: null,
          url,
        });
      });
      return imgs.length;
    });

    if (!rows.length) return NextResponse.json({ ok: false, reason: "карточки без доступных фото", products: uniq.length });

    // upsert пачками (Supabase лимит на размер запроса)
    let saved = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error: upErr } = await db.from("content_assets").upsert(chunk, { onConflict: "disk,path", ignoreDuplicates: false });
      if (upErr) return NextResponse.json({ error: upErr.message, saved, hint: "миграция 20260619_content_catalog.sql применена?" }, { status: 500 });
      saved += chunk.length;
    }

    const withPhotos = perProduct.filter((n) => n > 0).length;
    return NextResponse.json({ ok: true, products: uniq.length, products_with_photos: withPhotos, photos_indexed: saved, avg_per_card: Math.round((saved / Math.max(withPhotos, 1)) * 10) / 10 });
  } catch (e) {
    return NextResponse.json({ error: "wb-index crash: " + String((e as Error)?.message || e).slice(0, 180) }, { status: 500 });
  }
}
