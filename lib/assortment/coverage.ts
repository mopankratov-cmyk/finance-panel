import { hasScheduledCollector, staleAfterMs } from "./collectorSchedule";
import { ACCESS_STATUSES, type AccessStatus, type AssortmentDirection } from "./constants";
import { STAGE6_AWAITING_OWNER, STAGE6_CONNECTED, STAGE6_STALE_MS } from "./stage6Sources";

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
  // Этап 6 (соцсети и поиск вне WB): не «доступ не проверен», а «не подключено» — ждёт решения владельца.
  if (STAGE6_AWAITING_OWNER.has(source.sourceId)) return "not_connected";
  // Подключённый источник Этапа 6 (рилсы): пульс — удачный прогон его крона (подставляет загрузчик паспорта из журнала).
  if (STAGE6_CONNECTED[source.sourceId]) {
    const recent = source.lastSuccessAt && nowMs - new Date(source.lastSuccessAt).getTime() <= STAGE6_STALE_MS;
    return recent ? "auto_verified" : "partial";
  }
  const hint = { accessStatus: declared, accessNote: source.accessNote };
  if (!hasScheduledCollector(source.sourceId, hint)) {
    return declared === "auto_verified" ? "manual_only" : declared;
  }
  // Порог — тот же, что у сторожа (freshness.ts): экран не должен писать «работает» там, где сторож уже кричит.
  const recent = source.lastSuccessAt && nowMs - new Date(source.lastSuccessAt).getTime() <= staleAfterMs(source.sourceId, hint);
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
  const limit = staleAfterMs(source.sourceId ?? "");
  const stale = nowMs - new Date(source.lastAttemptAt).getTime() > limit;
  if (stale) return { text: `Автообход ${when(source.lastAttemptAt)} — давно не запускался`, failing: true };
  // Запускается, а собирать перестал: успешного сбора давно нет (сайт сменил разметку и отдаёт ноль).
  // Без этой проверки экран зелёный, пока сторож уже пишет в Telegram.
  if (source.lastSuccessAt && nowMs - new Date(source.lastSuccessAt).getTime() > limit) {
    return { text: `Автообход ${when(source.lastAttemptAt)}, но ничего не собрано с ${when(source.lastSuccessAt)}`, failing: true };
  }
  return { text: `Автообход ${when(source.lastAttemptAt)}`, failing: false };
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
