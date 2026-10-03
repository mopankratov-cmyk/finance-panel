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

/** Лучшее похожее на WB: самое продаваемое среди похожих по фото. */
export function bestRuMatch(candidates: RuSimilarCandidate[]): RuSimilarCandidate | null {
  const withSales = candidates.filter((c) => typeof c.sales === "number" && c.sales > 0);
  if (withSales.length === 0) return null;
  return withSales.sort((a, b) => (b.sales ?? 0) - (a.sales ?? 0) || a.distance - b.distance)[0];
}
