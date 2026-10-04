/**
 * Ручной порядок кабинетов в переключателе «Кабинет данных» (шапка WB).
 *
 * Сервер отдаёт кабинеты по дате подключения, и новый кабинет всегда оказывался
 * последним, даже если с ним работают чаще всех. Порядок — личное представление
 * сотрудника (у каждого свой набор кабинетов), поэтому живёт в браузере, а не в
 * базе: у сотрудника с двумя кабинетами чужой порядок из шести был бы шумом.
 */

export const CABINET_ORDER_STORAGE_KEY = "fp_cab_wb_order";

/**
 * Кабинеты из сохранённого порядка — первыми и в нём; остальные (подключённые
 * после настройки) — следом, в серверном порядке. Неизвестные id из
 * сохранённого списка пропускаются: кабинет мог быть отключён или недоступен.
 */
export function applyCabinetOrder<T extends { id: string }>(cabinets: T[], order: readonly string[]): T[] {
  if (order.length === 0) return cabinets;
  const rank = new Map<string, number>();
  order.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });
  return cabinets
    .map((cabinet, index) => ({ cabinet, index, rank: rank.get(cabinet.id) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.cabinet);
}

/**
 * Сдвиг кабинета на одну позицию в ВИДИМОМ списке. Возвращает полный новый
 * порядок видимых id — его и сохраняем, чтобы порядок не зависел от того,
 * какие кабинеты были настроены раньше.
 */
export function moveCabinet(visibleIds: readonly string[], id: string, direction: "up" | "down"): string[] {
  const next = [...visibleIds];
  const from = next.indexOf(id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= next.length) return next;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Разбор сохранённого значения; мусор и чужой формат — пустой порядок. */
export function parseCabinetOrder(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0).slice(0, 200);
  } catch {
    return [];
  }
}
