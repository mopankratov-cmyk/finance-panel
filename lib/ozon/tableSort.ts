/**
 * Сортировка таблиц кокпита.
 *
 * «Остатки» и «Заказы» не сортировались вовсе, а «Продажи» и «Реклама» умели
 * только по убыванию из выпадающего списка: найти самый маленький запас или
 * самый ранний заказ было нечем. Правило одно на все экраны, чтобы порядок
 * строк везде вёл себя одинаково.
 */

export type SortDirection = "asc" | "desc";

export interface SortState<K extends string> {
  key: K;
  dir: SortDirection;
}

/**
 * Следующее состояние по клику на заголовок: по убыванию → по возрастанию →
 * порядок сервера. Третий клик важен: он возвращает исходный порядок, который
 * на многих экранах осмысленный (например, критичные запасы сверху).
 */
export function nextSortState<K extends string>(current: SortState<K> | null, key: K): SortState<K> | null {
  if (current?.key !== key) return { key, dir: "desc" };
  if (current.dir === "desc") return { key, dir: "asc" };
  return null;
}

/**
 * Отсортировать строки. Неизвестное значение (null, NaN, пустая строка)
 * всегда внизу — в обе стороны: «нет данных» это не «минус бесконечность».
 */
export function sortRows<T, K extends string>(
  rows: T[],
  state: SortState<K> | null,
  value: (row: T, key: K) => number | string | null | undefined,
): T[] {
  if (!state) return rows;
  const factor = state.dir === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = value(left, state.key);
    const b = value(right, state.key);
    const aEmpty = a == null || a === "" || (typeof a === "number" && !Number.isFinite(a));
    const bEmpty = b == null || b === "" || (typeof b === "number" && !Number.isFinite(b));
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    if (typeof a === "string" || typeof b === "string") {
      return String(a).localeCompare(String(b), "ru-RU") * factor;
    }
    return (Number(a) - Number(b)) * factor;
  });
}
