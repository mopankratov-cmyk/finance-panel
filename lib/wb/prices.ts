// Текущие каталожные цены WB через официальный Discounts-Prices API.
// GET /api/v2/list/goods/filter — постранично все товары кабинета (или один по filterNmID).
// Цена = sizes[].price (каталожная, до скидки WB/СПП), плюс текущая скидка %.

const BASE = "https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter";

export class WbPriceScopeError extends Error {
  constructor() {
    super("Нет доступа к ценам (скоуп «Цены и скидки»)");
    this.name = "WbPriceScopeError";
  }
}

export interface WbPrice { nmId: number; price: number; discount: number; vendorCode: string }

interface GoodSize { price?: number; discountedPrice?: number }
interface Good { nmID?: number; vendorCode?: string; discount?: number; sizes?: GoodSize[] }

// Цены кабинета по списку nmID. Тянем постранично и фильтруем по нужным nm.
// 401/403 → WbPriceScopeError (у токена нет скоупа «Цены и скидки»).
export async function fetchWbCatalogPrices(token: string, wantNms: Set<number>): Promise<Map<number, WbPrice>> {
  const out = new Map<number, WbPrice>();
  const limit = 1000;
  for (let offset = 0; offset < 50_000; offset += limit) {
    const url = `${BASE}?limit=${limit}&offset=${offset}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: token }, cache: "no-store" });
    } catch {
      break; // сеть — отдаём что успели
    }
    if (res.status === 401 || res.status === 403) throw new WbPriceScopeError();
    if (!res.ok) break;
    const j = (await res.json().catch(() => null)) as { data?: { listGoods?: Good[] } } | null;
    const list = j?.data?.listGoods ?? [];
    if (!list.length) break;
    for (const g of list) {
      const nm = Number(g.nmID);
      if (!nm) continue;
      const size = (g.sizes ?? [])[0] ?? {};
      const price = Number(size.price ?? 0);
      out.set(nm, { nmId: nm, price, discount: Number(g.discount ?? 0), vendorCode: g.vendorCode ?? "" });
    }
    // как только собрали все нужные — прекращаем листать
    if ([...wantNms].every((n) => out.has(n))) break;
    if (list.length < limit) break;
  }
  return out;
}
