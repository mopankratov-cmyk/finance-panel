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
  /** Пульс автообхода (миграция 202610020002); без неё — null. */
  lastAttemptAt: string | null;
  lastError: string | null;
}

/** Строка о состоянии автообхода источника; null — источник не обходится. */
export function crawlStatus(source: Pick<AssortmentSource, "lastAttemptAt" | "lastSuccessAt" | "lastError">, nowMs = Date.now()): { text: string; failing: boolean } | null {
  if (!source.lastAttemptAt) return null;
  const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  if (source.lastError) {
    const since = source.lastSuccessAt ? `последний успешный ${when(source.lastSuccessAt)}` : "успешных обходов ещё не было";
    return { text: `Автообход не удался ${when(source.lastAttemptAt)}: ${source.lastError}; ${since}`, failing: true };
  }
  const stale = nowMs - new Date(source.lastAttemptAt).getTime() > 2 * 24 * 3600 * 1000;
  return { text: `Автообход ${when(source.lastAttemptAt)}${stale ? " — давно не запускался" : ""}`, failing: stale };
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
