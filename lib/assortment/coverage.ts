import { hasScheduledCollector, staleAfterMs } from "./collectorSchedule";
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
  /** Статус для экрана: итог пробы, сверенный с работой сборщика (effectiveAccessStatus). */
  accessStatus: AccessStatus;
  /** Что записано в паспорте (результат пробы этапа 0), если отличается от показанного. */
  declaredAccessStatus?: AccessStatus;
  accessNote: string | null;
  lastSuccessAt: string | null;
  /** Пульс автообхода (миграция 202610020002); без неё — null. */
  lastAttemptAt: string | null;
  lastError: string | null;
}

/**
 * Статус источника для экрана — по фактам, а не по паспорту этапа 0.
 *
 * Паспорт хранит итог пробы («сайт отдал данные»), а не факт работы сборщика.
 * Если у источника есть сборщик и он недавно успешно собрал — «автосбор
 * работает», какой бы ни была запись в паспорте (Uniqlo, ASOS, H&M, Zara).
 * Если записано «автосбор проверен», а сборщика нет (Charles & Keith) — это
 * «только вручную»: обещание без дела хуже честного статуса.
 */
export function effectiveAccessStatus(
  source: Pick<AssortmentSource, "sourceId" | "accessStatus" | "accessNote" | "lastSuccessAt">,
  nowMs = Date.now(),
): AccessStatus {
  const declared = source.accessStatus;
  if (declared === "disabled" || declared === "unavailable") return declared;
  const shopify = declared === "auto_verified" && /products\.json/i.test(source.accessNote ?? "");
  if (!hasScheduledCollector(source.sourceId) && !shopify) {
    return declared === "auto_verified" ? "manual_only" : declared;
  }
  const recent = source.lastSuccessAt && nowMs - new Date(source.lastSuccessAt).getTime() <= 3 * staleAfterMs(source.sourceId);
  if (recent) return "auto_verified";
  // Сборщик есть, но давно ничего не собрал: «проверен» фактом не подтверждено.
  return declared === "auto_verified" ? "partial" : declared;
}

/** Строка о состоянии автообхода источника; null — источник не обходится. */
export function crawlStatus(source: Pick<AssortmentSource, "lastAttemptAt" | "lastSuccessAt" | "lastError"> & { sourceId?: string }, nowMs = Date.now()): { text: string; failing: boolean } | null {
  if (!source.lastAttemptAt) return null;
  const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  if (source.lastError) {
    const since = source.lastSuccessAt ? `последний успешный ${when(source.lastSuccessAt)}` : "успешных обходов ещё не было";
    return { text: `Автообход не удался ${when(source.lastAttemptAt)}: ${source.lastError}; ${since}`, failing: true };
  }
  // Порог — по расписанию источника: у недельных он больше, чем у ежедневных.
  const stale = nowMs - new Date(source.lastAttemptAt).getTime() > staleAfterMs(source.sourceId ?? "");
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
