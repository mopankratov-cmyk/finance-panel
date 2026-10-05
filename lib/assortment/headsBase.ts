import { CATALOG_SEEN_DAYS } from "./catalog";
import type { AssortmentDirection } from "./constants";

/**
 * Общий набор моделей раздела: вид голов (миграция 202610050002), модель видна за последние CATALOG_SEEN_DAYS дней и не
 * скрыта кнопкой «Не интересно». Его читают и «Формы» (счёт форм), и каталог с фильтром «Форма» — одним кодом, чтобы число
 * в каталоге не разошлось со строкой формы из-за разных рук в двух местах.
 */
export function baseHeadsFilters<T extends { eq: Function; gte: Function; is: Function }>(builder: T, direction: AssortmentDirection, nowMs: number): T {
  const seenSince = new Date(nowMs - CATALOG_SEEN_DAYS * 24 * 3600 * 1000).toISOString();
  return builder.eq("direction", direction).gte("model_last_seen_at", seenSince).is("model_hidden_at", null) as T;
}
