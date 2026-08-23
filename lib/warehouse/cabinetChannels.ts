// Кабинет как канал сбыта, а не как «кабинет Wildberries».
//
// Модуль склада писался, когда с юрлицами связывались только кабинеты WB, и
// потому везде молча считал, что кабинет — вайлдберрисовый. С подключением Ozon
// это перестало быть правдой: отгружать можно в оба, а читать карточки — только
// из WB, потому что Content API есть только у него.
//
// Отсюда правило: операции над ТОВАРОМ (отгрузка, возврат) работают с любым
// каналом, а операции над СПРАВОЧНИКОМ (размеры, владельцы, импорт карточек) —
// только с Wildberries, и говорят об этом вслух, а не падают с чужой ошибкой.

import type { EntityCabinetLink } from "@/lib/warehouse/entityAccess";

export const MARKETPLACE_LABEL: Record<EntityCabinetLink["marketplace"], string> = {
  wb: "WB",
  ozon: "Ozon",
};

/** Собственные кабинеты Wildberries — единственный источник карточек. */
export const wildberriesOwnCabinets = (links: EntityCabinetLink[]): EntityCabinetLink[] =>
  links.filter((link) => link.relation === "own" && link.marketplace === "wb");

/** Есть ли у юрлица хоть один свой WB-кабинет: по этому гейту включаются кнопки,
 *  которые читают карточки. */
export const hasWildberriesSource = (links: EntityCabinetLink[]): boolean =>
  wildberriesOwnCabinets(links).length > 0;

/**
 * Почему справочник читать неоткуда. Разводит два разных случая, которые раньше
 * сливались в одно техническое «не удалось прочитать карточки»: кабинетов нет
 * вовсе и кабинеты есть, но все чужого маркетплейса.
 */
export function noWildberriesSourceReason(
  entityName: string,
  links: EntityCabinetLink[],
): string {
  const own = links.filter((link) => link.relation === "own");
  if (own.length === 0) return `У юрлица «${entityName}» нет собственных кабинетов`;
  const marketplaces = [...new Set(own.map((link) => MARKETPLACE_LABEL[link.marketplace]))];
  return `У юрлица «${entityName}» нет кабинетов Wildberries — карточки брать неоткуда. `
    + `Есть только ${marketplaces.join(" и ")}, а карточки читаются через Content API Wildberries.`;
}
