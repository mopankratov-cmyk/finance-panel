// Чей товар — вопрос с ответом в данных, а не в догадке.
//
// Товары приехали из `product_costs`, где владелец записан текстом («Retail
// Family», «ИП ПАНКРАТОВ»), и половина строк осталась вообще без юрлица. При
// этом настоящее свидетельство лежит рядом: карточка WB живёт в кабинете, а
// кабинет связан с юрлицом. Отсюда порядок доверия:
//
//   1. nmID из карточки собственного кабинета — самое сильное: номер карточки
//      в WB глобально уникален, двум продавцам одна карточка не принадлежит.
//   2. Артикул (vendorCode) — слабее: он уникален только внутри продавца, и
//      совпадение засчитывается, лишь когда на артикул претендует один кабинет.
//   3. Текстовая метка из финансов — последняя опора для товара, у которого
//      карточки WB нет вовсе (шлёпанцы и кремы без выхода на маркетплейс).
//
// Агентские кабинеты в свидетельства не идут: там 90% карточек чужих продавцов,
// и «наш товар лежит в этом кабинете» о собственности ничего не говорит.

export interface OwnerCard {
  nmId: number;
  article: string;
}

export interface OwnerSource {
  /** Юрлицо, которому принадлежит собственный кабинет. */
  entityId: string;
  cabinetName: string;
  cards: OwnerCard[];
}

export interface OwnerCandidate {
  id: string;
  article: string;
  nmId: number | null;
  legalEntityId: string | null;
  /** Владелец текстом из финансов — `product_costs.entity`. */
  label: string | null;
}

export type OwnerVia = "nm" | "article" | "label";

export interface OwnerAssignment {
  productId: string;
  article: string;
  entityId: string;
  via: OwnerVia;
  /** Кабинет или метка, на которой держится вывод. */
  evidence: string;
}

export interface OwnerConflict {
  productId: string;
  article: string;
  currentEntityId: string;
  foundEntityId: string;
  evidence: string;
}

export interface OwnerResolution {
  assignments: OwnerAssignment[];
  conflicts: OwnerConflict[];
  /** Товары, про которых ни карточка, ни метка ничего не сказали. */
  unresolved: { productId: string; article: string }[];
  /** Товары, у которых юрлицо уже стояло и подтвердилось. */
  confirmed: number;
}

const key = (value: string) => value.trim().toLowerCase();

/**
 * @param labelToEntity метка из финансов → юрлицо. Метка бывает и названием
 *   кабинета («Retail Family»), и названием юрлица («ИП ПАНКРАТОВ»), поэтому
 *   словарь собирает вызывающий, а не мы.
 */
export function resolveProductOwners(
  products: OwnerCandidate[],
  sources: OwnerSource[],
  labelToEntity: Map<string, string> = new Map(),
): OwnerResolution {
  const byNm = new Map<number, { entityId: string; cabinetName: string }>();
  const byArticle = new Map<string, { entityId: string; cabinetName: string } | null>();

  for (const source of sources) {
    for (const card of source.cards) {
      const claim = { entityId: source.entityId, cabinetName: source.cabinetName };
      if (Number.isFinite(card.nmId) && card.nmId > 0 && !byNm.has(card.nmId)) byNm.set(card.nmId, claim);

      const article = key(card.article ?? "");
      if (!article) continue;
      const seen = byArticle.get(article);
      if (seen === undefined) byArticle.set(article, claim);
      // На один артикул претендуют разные юрлица — свидетельство сгорело.
      else if (seen && seen.entityId !== source.entityId) byArticle.set(article, null);
    }
  }

  const resolution: OwnerResolution = { assignments: [], conflicts: [], unresolved: [], confirmed: 0 };

  for (const product of products) {
    const fromNm = product.nmId ? byNm.get(product.nmId) : undefined;
    const fromArticle = fromNm ? undefined : byArticle.get(key(product.article ?? "")) ?? undefined;
    const fromLabel = fromNm || fromArticle || !product.label
      ? undefined
      : labelToEntity.get(key(product.label));

    const found = fromNm ?? fromArticle;
    const entityId = found?.entityId ?? fromLabel;
    if (!entityId) {
      if (product.legalEntityId) resolution.confirmed += 1;
      else resolution.unresolved.push({ productId: product.id, article: product.article });
      continue;
    }

    const via: OwnerVia = fromNm ? "nm" : fromArticle ? "article" : "label";
    const evidence = found ? found.cabinetName : `метка «${product.label}»`;

    if (product.legalEntityId === entityId) { resolution.confirmed += 1; continue; }
    if (product.legalEntityId) {
      // Чужое юрлицо не перетираем молча: это либо ошибка в метке, либо товар
      // действительно переехал — решать должен человек.
      resolution.conflicts.push({
        productId: product.id,
        article: product.article,
        currentEntityId: product.legalEntityId,
        foundEntityId: entityId,
        evidence,
      });
      continue;
    }
    resolution.assignments.push({ productId: product.id, article: product.article, entityId, via, evidence });
  }

  return resolution;
}
