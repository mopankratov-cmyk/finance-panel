import { normalizeWbBrand } from "@/lib/wb/productScope";
import type { BrandProfile } from "./brandProfiles";
import { formOf } from "./forms";

/**
 * «У нас N»: сколько собственных моделей бренда на WB приходится на каждую форму — третья нога решения рядом с долей поисков
 * и долей каталогов. Чистые функции. Форма — по названию карточки WB тем же правилом, что в каталогах брендов (по названию,
 * не по фото). Артикулы и номера WB наружу не отдаются: только числа.
 *
 * Бренд берётся из поля бренда WB, а не из префикса артикула: HT- не определяет бренд (часть HT- карточек — HEATON, часть — NORVIA).
 * Если карточек бренда в базе нет вовсе, это «не проверено» (под другим названием бренда или кабинет не подключён), а не «0 моделей».
 */

export interface OwnCard {
  cabinet_id: string | null;
  nm_id: number | string;
  imt_id: number | string | null;
  name: string | null;
  brand: string | null;
}

export interface OwnModelsReport {
  brandKey: string;
  displayName: string;
  /** Нашлись ли вообще карточки бренда; нет — «у нас» не проверено. */
  found: boolean;
  /** Карточек WB (по номерам) и моделей (карточки с общим imt_id — одна модель). */
  cards: number;
  models: number;
  /** Моделей по ключам форм раздела. */
  byForm: Record<string, number>;
  /** Название формы не называет (брюки, аксессуары, «женская зимняя»…). */
  unrecognized: number;
}

/** Модель карточки: общий imt_id объединяет цвета и размеры одной модели; без него — сама карточка. */
const modelOf = (card: OwnCard) => (card.imt_id != null && String(card.imt_id) !== "" ? `imt:${card.imt_id}` : `nm:${card.nm_id}`);

export function ownModelsFor(profile: Pick<BrandProfile, "brandKey" | "direction" | "displayName" | "wbBrandNames">, cards: readonly OwnCard[]): OwnModelsReport {
  const brands = new Set(profile.wbBrandNames.map(normalizeWbBrand).filter(Boolean));
  const mine = cards.filter((c) => brands.has(normalizeWbBrand(c.brand)));
  const nmIds = new Set<string>();
  // Форма модели — по первой (по номеру) карточке: порядок не зависит от порядка строк в базе.
  const firstCard = new Map<string, OwnCard>();
  for (const card of mine.slice().sort((a, b) => Number(a.nm_id) - Number(b.nm_id))) {
    nmIds.add(String(card.nm_id));
    const key = modelOf(card);
    if (!firstCard.has(key)) firstCard.set(key, card);
  }
  const byForm: Record<string, number> = {};
  let unrecognized = 0;
  for (const card of firstCard.values()) {
    const rule = formOf(profile.direction, card.name);
    if (!rule) unrecognized += 1;
    else byForm[rule.key] = (byForm[rule.key] ?? 0) + 1;
  }
  return { brandKey: profile.brandKey, displayName: profile.displayName, found: nmIds.size > 0, cards: nmIds.size, models: firstCard.size, byForm, unrecognized };
}
