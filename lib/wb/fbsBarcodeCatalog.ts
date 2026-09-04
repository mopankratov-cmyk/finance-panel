// Справочник баркодов кабинета для остатков FBS.
//
// Marketplace API отдаёт остатки склада продавца только по явному списку
// баркодов, а в PIM-снимке (lib/wb/cards.ts) баркодов нет — там размеры и фото.
// Поэтому берём их из того же Content API отдельным лёгким проходом: нам нужны
// только nmID / vendorCode / brand / sizes[].skus. Снимок кэшируется на час
// тем же механизмом, что PIM, — второй экран за час уже не ходит в WB.
//
// Правило то же, что у PIM-снимка (см. lib/wb/cards.ts): пользовательский путь
// читает только готовый снимок (cacheOnly), холодный обход Content API делает
// прогрев. Обход в 80 страниц с обязательной паузой 600 мс между запросами —
// это ~47 секунд одного только сна, в лимит пользовательской функции он не
// влезает, а неуспешный прогон в кэш не попадает: холодный кабинет платил бы
// полный обход при каждом открытии вкладки и не открывал её никогда.

import { fetchWbCardPages } from "@/lib/wb/cardPagination";
import { getWbCabinet, cabinetProductScope, resolveWbToken } from "@/lib/wb/cabinetTokens";
import { allowsProduct } from "@/lib/wb/productScope";
import { loadHourlyDashboard, type HourlyDashboardCacheOptions } from "@/lib/cache/hourlyDashboard";

export interface FbsBarcodeEntry {
  barcode: string;
  nmId: number;
  article: string;
  brand: string;
  size: string;
  /** Характеристика размера в WB — ею адресуются цены и остатки конкретного размера. */
  chrtId: number | null;
  /** Карточки одной модели в разных цветах объединены у WB общим imtID —
   *  по нему склад собирает иерархию «модель → цвет». */
  imtId: number | null;
  /** Характеристика «Цвет» карточки, как её записал продавец. */
  color: string | null;
}

export interface FbsBarcodeCatalog {
  entries: FbsBarcodeEntry[];
  /** false — обход Content API остановлен по лимиту страниц, список неполный. */
  complete: boolean;
}

interface RawCatalogCard {
  nmID?: number;
  imtID?: number;
  vendorCode?: string;
  brand?: string;
  characteristics?: { name?: string; value?: string | string[] }[];
  sizes?: { chrtID?: number; techSize?: string; wbSize?: string; skus?: string[] }[];
}

function colorOf(card: RawCatalogCard): string | null {
  const found = (card.characteristics ?? []).find((item) => /цвет/i.test(String(item.name ?? "")));
  if (!found) return null;
  const value = Array.isArray(found.value) ? found.value.join(", ") : String(found.value ?? "");
  return value.trim() || null;
}

/** Потолок обхода: 100 карточек на страницу × 80 страниц = 8 000 карточек. */
const MAX_PAGES = 80;

async function fetchCatalog(cabinetId: string): Promise<FbsBarcodeCatalog> {
  // getWbCabinet отдаёт только кабинеты Wildberries: для Ozon-кабинета здесь
  // придёт null, и мы вернём пустой каталог, не отправив его ключ в WB.
  const cabinet = await getWbCabinet(cabinetId);
  if (!cabinet) return { entries: [], complete: true };
  const scope = cabinetProductScope(cabinet);
  const page = await fetchWbCardPages<RawCatalogCard>({
    token: resolveWbToken(cabinet, "content"),
    maxPagesThisRun: MAX_PAGES,
  });

  const seen = new Set<string>();
  const entries: FbsBarcodeEntry[] = [];
  for (const card of page.rows) {
    const nmId = Number(card.nmID);
    if (!Number.isFinite(nmId) || nmId <= 0) continue;
    if (!allowsProduct(scope, nmId, card.brand)) continue;
    const article = String(card.vendorCode ?? "").trim();
    const brand = String(card.brand ?? "").trim();
    const imtId = Number.isFinite(Number(card.imtID)) && Number(card.imtID) > 0 ? Number(card.imtID) : null;
    const color = colorOf(card);
    for (const size of card.sizes ?? []) {
      const label = String(size.wbSize ?? size.techSize ?? "").trim();
      for (const sku of size.skus ?? []) {
        const barcode = String(sku ?? "").trim();
        if (!barcode || seen.has(barcode)) continue;
        seen.add(barcode);
        entries.push({
          barcode,
          nmId,
          article,
          brand,
          size: label,
          chrtId: Number.isFinite(Number(size.chrtID)) ? Number(size.chrtID) : null,
          imtId,
          color,
        });
      }
    }
  }
  return { entries, complete: page.caughtUp };
}

/**
 * Снимка баркодов в кэше нет. Бросаем, а не возвращаем пустой список: пустота
 * попала бы в кэш на час и превратилась бы в «на складе ничего нет», хотя
 * остатки есть — мы просто не знаем, по каким баркодам их спрашивать.
 */
export class FbsBarcodeCatalogColdError extends Error {
  constructor() {
    super("Справочник баркодов FBS ещё не прогрет");
    this.name = "FbsBarcodeCatalogColdError";
  }
}

const CATALOG_NAMESPACE = "wb-fbs-barcodes";
/** Ключ снимка обязан совпадать у читателя и у прогрева, иначе прогрев греет мимо. */
const catalogIdentity = (cabinetId: string) => ({ cabinetId, schema: 3 });

export function loadFbsBarcodeCatalogHourly(
  cabinetId: string,
  options: HourlyDashboardCacheOptions & { cacheOnly?: boolean } = {},
): Promise<FbsBarcodeCatalog> {
  if (options.cacheOnly) {
    return loadHourlyDashboard(
      CATALOG_NAMESPACE,
      catalogIdentity(cabinetId),
      async () => { throw new FbsBarcodeCatalogColdError(); },
      options,
    );
  }
  return loadHourlyDashboard(CATALOG_NAMESPACE, catalogIdentity(cabinetId), () => fetchCatalog(cabinetId), options);
}

/**
 * Единственный путь, которому разрешён холодный обход Content API: прогрев.
 * Вызывать из крона (лимит времени там в пять раз больше пользовательского),
 * а не из экрана.
 */
export function warmFbsBarcodeCatalog(cabinetId: string): Promise<FbsBarcodeCatalog> {
  return loadFbsBarcodeCatalogHourly(cabinetId, { forceRefresh: true });
}
