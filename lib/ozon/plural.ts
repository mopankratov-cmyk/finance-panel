import { plural } from "@/lib/warehouse/plural";

/**
 * Число вместе с русской формой слова: «14 дней», «1 день», «22 дня».
 *
 * Само правило склонения живёт в lib/warehouse/plural.ts и переиспользуется:
 * два одинаковых правила в одном репозитории разъезжаются на первой же правке.
 */
export function withPlural(count: number, one: string, few: string, many: string): string {
  return `${Math.round(count).toLocaleString("ru-RU")} ${plural(count, one, few, many)}`;
}

export const days = (count: number) => withPlural(count, "день", "дня", "дней");
export const cabinets = (count: number) => withPlural(count, "кабинет", "кабинета", "кабинетов");

export { plural };
