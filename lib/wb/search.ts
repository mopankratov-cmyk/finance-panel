import { wbCardImageUrl } from "./cardImage";

export interface CompProduct { nm: number; name: string; brand: string; rating: number | null; feedbacks: number | null; img: string }

// Best-effort серверный поиск WB (часто 429 с датацентр-IP — тогда полагаемся на список от клиента).
export async function wbSearch(query: string, limit = 20): Promise<CompProduct[]> {
  const url = `https://search.wb.ru/exactmatch/ru/common/v9/search?ab_testing=false&appType=1&curr=rub&dest=-1257786&query=${encodeURIComponent(query)}&resultset=catalog&sort=popular&spp=30`;
  try {
    const r = await fetch(url, { headers: { Accept: "*/*", "User-Agent": "Mozilla/5.0 (iPhone)", Origin: "https://www.wildberries.ru", Referer: "https://www.wildberries.ru/" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const j = (await r.json()) as { data?: { products?: { id: number; name: string; brand: string; reviewRating?: number; rating?: number; feedbacks?: number }[] } };
    return (j.data?.products ?? []).slice(0, limit).map((p) => ({ nm: p.id, name: p.name, brand: p.brand, rating: p.reviewRating ?? p.rating ?? null, feedbacks: p.feedbacks ?? null, img: wbCardImageUrl(p.id) }));
  } catch { return []; }
}

// Нормализовать список, пришедший от клиента (браузерный поиск).
export function normalizeClientProducts(raw: unknown[], limit = 20): CompProduct[] {
  return (raw || []).slice(0, limit).map((p) => {
    const o = p as Record<string, unknown>;
    const nm = Number(o.id ?? o.nm ?? 0);
    return { nm, name: String(o.name ?? ""), brand: String(o.brand ?? ""), rating: o.reviewRating != null ? Number(o.reviewRating) : o.rating != null ? Number(o.rating) : null, feedbacks: o.feedbacks != null ? Number(o.feedbacks) : null, img: wbCardImageUrl(nm) };
  }).filter((p) => p.nm > 0);
}
