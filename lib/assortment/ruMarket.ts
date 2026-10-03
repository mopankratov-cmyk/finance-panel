/**
 * «Рынок РФ»: что реально продаётся на Wildberries — топ предметов своих
 * товаров и Lime на WB (запрос владельца 03.10.2026: «чтобы модуль учился»).
 * Чистые функции.
 *
 * Данные — оценка MPSTATS: продажи в штуках, отзывы, рейтинг. Цены и выручку
 * не берём (граница ТЗ). Сайт Lime закрыт антибот-проверкой — его не
 * обходим, берём ассортимент Lime на WB.
 */

import type { AssortmentDirection } from "./constants";

export const RU_SOURCES = {
  wb: {
    source_id: "S128",
    name: "Wildberries — рынок",
    source_group: "Рынок РФ",
    access_note: "Топ продаж предметов WB за 30 дней по MPSTATS (оценка); без цен и выручки",
    seed_urls: [] as string[],
  },
  lime: {
    source_id: "S129",
    name: "Lime на Wildberries",
    source_group: "Рынок РФ",
    access_note: "Ассортимент Lime на WB по MPSTATS (оценка продаж за 30 дней); сайт Lime закрыт антибот-проверкой — не обходим",
    seed_urls: [] as string[],
  },
} as const;

export const RU_SOURCE_IDS: string[] = [RU_SOURCES.wb.source_id, RU_SOURCES.lime.source_id];

export function isRuSource(sourceId: string | null | undefined): boolean {
  return Boolean(sourceId) && RU_SOURCE_IDS.includes(String(sourceId));
}

/** Бренд Lime на WB — так он записан в MPSTATS. */
export const LIME_BRANDS = ["LIME", "Lime"];

const BAGS = /сумк|рюкзак|клатч|шопер|портфел|поясн/i;
const NOT_BAGS = /кошел|косметичк|чехол|визитниц/i;
const JACKETS = /куртк|пуховик|ветровк|пальто|парк|бомбер|жилет|плащ|тренч|анорак|косух|пиджак|жакет/i;

/** Раздел товара WB по предмету и названию; null — не наш (платья, обувь…). */
export function ruDirection(subject: string | null, name: string): AssortmentDirection | null {
  const text = `${subject ?? ""} ${name}`;
  if (BAGS.test(text) && !NOT_BAGS.test(text)) return "bags";
  if (JACKETS.test(text)) return "jackets";
  return null;
}

export function wbProductUrl(nmId: number): string {
  return `https://www.wildberries.ru/catalog/${nmId}/detail.aspx`;
}

export const RU_TOP_PER_SUBJECT = 30;
export const RU_LIME_PER_DIRECTION = 15;
/** Продажи похожего на WB, начиная с которых это сигнал «заходит в РФ». */
export const RU_SALES_SIGNAL = 100;

export interface RuSimilarCandidate {
  referenceId: string;
  distance: number;
  sales: number | null;
  title: string;
  brand: string | null;
  url: string;
}

/**
 * Силуэт сумки или подтип куртки → основы слов, которыми его называют на WB.
 * Живая проверка 03.10: по одному фото «девушка с сумкой» CLIP даёт 90–95%
 * сходства совсем разным сумкам, и «похожим» оказывался просто самый
 * продаваемый тоут. Поэтому сначала совпадение формы, потом фото.
 */
const SHAPE_STEMS: Array<{ match: RegExp; stems: string[] }> = [
  { match: /хобо/, stems: ["хобо"] },
  { match: /тоут|шоп+ер/, stems: ["тоут", "шоппер", "шопер"] },
  { match: /багет/, stems: ["багет"] },
  { match: /кросс-?боди|через плечо/, stems: ["кросс-боди", "кроссбоди", "кросс боди"] },
  { match: /седел|седл/, stems: ["седл"] },
  { match: /ведро|мешок|бакет/, stems: ["ведро", "мешок"] },
  { match: /клатч/, stems: ["клатч"] },
  { match: /полумесяц/, stems: ["полумесяц"] },
  { match: /рюкзак/, stems: ["рюкзак"] },
  { match: /бомбер/, stems: ["бомбер"] },
  { match: /тренч|плащ/, stems: ["тренч", "плащ"] },
  { match: /пуховик/, stems: ["пуховик"] },
  { match: /парк/, stems: ["парка", "парки"] },
  { match: /ветровк|анорак/, stems: ["ветровк", "анорак"] },
  { match: /пальто/, stems: ["пальто"] },
  { match: /косух/, stems: ["косух"] },
  { match: /жилет/, stems: ["жилет"] },
];

/** Основы слов формы зарубежной находки: силуэт сумки или подтип куртки. */
export function shapeStems(direction: AssortmentDirection, attributes: Record<string, string | null>): string[] {
  const value = (direction === "bags" ? attributes.silhouette : attributes.subtype)?.toLowerCase().replace(/ё/g, "е") ?? "";
  if (!value || value === "не видно") return [];
  return SHAPE_STEMS.find((s) => s.match.test(value))?.stems ?? [];
}

export function matchesShape(stems: string[], title: string): boolean {
  const text = title.toLowerCase().replace(/ё/g, "е");
  return stems.some((stem) => text.includes(stem));
}

/** Похожее на WB: та же форма по названию, затем самое близкое по фото. */
export function closestRuMatch(candidates: RuSimilarCandidate[], stems: string[]): RuSimilarCandidate | null {
  if (stems.length === 0) return null;
  const sameShape = candidates.filter((c) => matchesShape(stems, c.title) && typeof c.sales === "number" && c.sales > 0);
  if (sameShape.length === 0) return null;
  return sameShape.sort((a, b) => a.distance - b.distance || (b.sales ?? 0) - (a.sales ?? 0))[0];
}
