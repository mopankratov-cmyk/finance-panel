import { ACCESS_STATUSES, type AccessStatus, type AssortmentDirection } from "./constants";

/**
 * Паспорт источника (таблица assortment_sources, ID S001–S127 из приложения
 * к ТЗ). Чистые функции без доступа к базе: их импортирует и экран.
 */
export interface AssortmentSource {
  sourceId: string;
  name: string;
  group: string | null;
  categories: AssortmentDirection[];
  region: string | null;
  priority: string | null;
  adapterType: string | null;
  accessStatus: AccessStatus;
  accessNote: string | null;
  lastSuccessAt: string | null;
}

/** Сначала то, что реально работает, затем по приоритету проверки и ID. */
export function sortSources(sources: AssortmentSource[]): AssortmentSource[] {
  const statusRank = (s: AccessStatus) => ACCESS_STATUSES.indexOf(s);
  return [...sources].sort((a, b) =>
    statusRank(a.accessStatus) - statusRank(b.accessStatus)
    || (a.priority ?? "P9").localeCompare(b.priority ?? "P9")
    || a.sourceId.localeCompare(b.sourceId));
}

/**
 * Строка «что отслеживается»: интерфейс всегда показывает покрытие, а не
 * «анализирует весь интернет» (ТЗ §3).
 */
export function summarizeCoverage(sources: AssortmentSource[]) {
  const names = (status: AccessStatus) => sources.filter((s) => s.accessStatus === status).map((s) => s.name);
  return {
    auto: names("auto_verified"),
    partial: names("partial"),
    manual: names("manual_only"),
  };
}
