import { plural } from "@/lib/warehouse/plural";
import type { FactorySourceStatus, PriceTier } from "./factories1688";
import type { FactoryIndicator, IndicatorKey } from "./factoryCards";
import { FACTORY_SOURCE_LABEL, type FactorySource } from "./factoryGuide";

/**
 * «Фабрики сумок (1688)» — подписи экрана и чистые помощники. Модуль без node:crypto, базы и клиента 1688: его импортирует клиентский экран
 * (components/assortment/FactoriesView.tsx), а сервер (factoryShortlist.ts) берёт отсюда статусы и чек-лист — словарь один.
 *
 * Общего балла фабрики нет нигде: показатели — по одному, со своей меткой источника; пункты чек-листа — раздельно, без суммы; флаги —
 * отдельными чипами, без счётчика. Статусы ставит только человек: рекомендация ≠ решение о закупке.
 */

export const FACTORIES_TAB_LABEL = "Фабрики (1688)";

/** Что видит человек без права правки (wb_manager): шорт-лист — да, поиск и правка — нет (прячем, а не серим). */
export const FACTORY_READ_ONLY_WORDS = "Искать фабрики, проверять компании и вести шорт-лист может закупщик или директор — у вас просмотр шорт-листа.";

// ---------------------------------------------------------------------------
// Статусы шорт-листа (ставит только человек)

export const FACTORY_STATUSES = ["candidate", "contacted", "video_call", "sample_ordered", "sample_received", "approved", "rejected"] as const;
export type FactoryStatus = (typeof FACTORY_STATUSES)[number];

export const FACTORY_STATUS_LABEL: Record<FactoryStatus, string> = {
  candidate: "Кандидат",
  contacted: "Написали",
  video_call: "Видеозвонок",
  sample_ordered: "Образец заказан",
  sample_received: "Образец получен",
  approved: "Одобрена",
  rejected: "Отклонена",
};

export function parseFactoryStatus(value: unknown): FactoryStatus | null {
  return FACTORY_STATUSES.find((s) => s === value) ?? null;
}

/**
 * Смена статуса на экране: «Сохранить статус» есть, только когда есть что сохранить (прячем, а не серим); «Отклонена» — только с причиной
 * (без неё кнопки нет, а есть подсказка).
 */
export function statusEditState(current: { status: FactoryStatus; rejectReason: string | null }, status: FactoryStatus, reason: string): { changed: boolean; ready: boolean; needReason: boolean } {
  const rejecting = status === "rejected";
  const text = reason.trim();
  const changed = status !== current.status || (rejecting && text !== (current.rejectReason ?? ""));
  return { changed, ready: changed && (!rejecting || text.length > 0), needReason: changed && rejecting && text.length === 0 };
}

// ---------------------------------------------------------------------------
// Ручной чек-лист: каждый пункт отдельно, без суммы

export type ChecklistKind = "yesno" | "number" | "grade";

export const FACTORY_CHECKLIST = [
  { key: "license_production", kind: "yesno", label: "Лицензия: производство по сумкам (生产/加工 箱包·皮具 в 经营范围)" },
  { key: "insured_staff", kind: "number", label: "Число застрахованных сотрудников (参保人数)" },
  { key: "badges_report", kind: "yesno", label: "Значки на странице магазина и отчёт проверки фабрики не старше 12 месяцев" },
  { key: "video_call", kind: "yesno", label: "Видеозвонок из цеха" },
  { key: "answers", kind: "yesno", label: "Ответы на вопросы получены и конкретны" },
  { key: "sample_material", kind: "grade", label: "Образец: материал" },
  { key: "sample_hardware", kind: "grade", label: "Образец: фурнитура" },
  { key: "sample_stitching", kind: "grade", label: "Образец: швы" },
  { key: "sample_edges", kind: "grade", label: "Образец: кромка (边油)" },
  { key: "sample_lining", kind: "grade", label: "Образец: подклад" },
] as const satisfies ReadonlyArray<{ key: string; kind: ChecklistKind; label: string }>;

export type ChecklistKey = (typeof FACTORY_CHECKLIST)[number]["key"];

export const CHECKLIST_VALUES: Record<Exclude<ChecklistKind, "number">, readonly string[]> = {
  yesno: ["yes", "no", "unknown"],
  grade: ["good", "acceptable", "bad", "unknown"],
};

export const CHECKLIST_VALUE_LABEL: Record<string, string> = {
  yes: "да", no: "нет", unknown: "не ясно", good: "хорошо", acceptable: "приемлемо", bad: "плохо",
};

/** Значение отметки словами: «да», «хорошо», «12» (число застрахованных — как есть). */
export function checklistValueText(value: string | number): string {
  return typeof value === "number" ? value.toLocaleString("ru-RU") : CHECKLIST_VALUE_LABEL[value] ?? value;
}

// ---------------------------------------------------------------------------
// Показатели карточки: что на лицевой стороне, что — в «Все показатели»

/**
 * Лицевая сторона карточки — в одном и том же порядке у всех фабрик (их сравнивают глазами): регион и кластер, заявления продавца, стаж,
 * повторные покупатели, приёмка, возвраты по качеству, заказы. Пустые — «нет данных» на своём месте, а не пропуск: иначе строки съезжают.
 */
export const MAIN_INDICATORS: readonly IndicatorKey[] = [
  "region", "cluster", "oem", "manufacture", "proofing", "shopYears", "repeatRate", "inspection", "qualityRefunds", "orders30d",
];

/** Показатели, у которых своё место в карточке: № в выдаче — в шапке, цены и партия — в блоке цен. */
export const OWN_PLACE_INDICATORS: readonly IndicatorKey[] = ["rank", "prices", "moq"];

export interface IndicatorSplit {
  main: FactoryIndicator[];
  /** Остальные с данными — в «Все показатели». */
  more: FactoryIndicator[];
  /** Остальные без данных — одной строкой «Нет данных: …». */
  empty: FactoryIndicator[];
}

export function splitIndicators(list: readonly FactoryIndicator[]): IndicatorSplit {
  const main = MAIN_INDICATORS.map((key) => list.find((i) => i.key === key)).filter((i): i is FactoryIndicator => Boolean(i));
  const rest = list.filter((i) => !MAIN_INDICATORS.includes(i.key) && !OWN_PLACE_INDICATORS.includes(i.key));
  return { main, more: rest.filter((i) => !i.empty), empty: rest.filter((i) => i.empty) };
}

export const indicatorOf = (list: readonly FactoryIndicator[], key: IndicatorKey): FactoryIndicator | null => list.find((i) => i.key === key) ?? null;

export function sourceTitle(source: FactorySource): string {
  return FACTORY_SOURCE_LABEL[source];
}

/** Метки источников одной строкой — легенда над выдачей (на касании title не виден, пояснение должно быть текстом). */
export const SOURCE_LEGEND: ReadonlyArray<{ source: FactorySource; label: string }> = (["Ф", "З", "О", "Р", "Ч"] as const).map((source) => ({ source, label: FACTORY_SOURCE_LABEL[source] }));

// ---------------------------------------------------------------------------
// Числа и даты

const yuan = (n: number) => `¥${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}`;

/** Ступени цены от партии: «от 100 шт. — ¥88; от 500 шт. — ¥80,5». Пусто — null (ступеней 1688 не прислал). */
export function priceTiersText(tiers: readonly PriceTier[]): string | null {
  if (!tiers.length) return null;
  return [...tiers].sort((a, b) => a.minQty - b.minQty).map((t) => `от ${t.minQty.toLocaleString("ru-RU")} шт. — ${yuan(t.price)}`).join("; ");
}

/** Цена карточки товара: «¥12» или «¥12–15»; нет — null. */
export function offerPriceText(min: number | null, max: number | null): string | null {
  if (min == null) return null;
  return max != null && max > min ? `${yuan(min)}–${max.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}` : yuan(min);
}

const MSK = "Europe/Moscow";

/** «07.10.2026, 14:32» по Москве (время записи хранится в UTC). */
export function dateTimeRu(iso: string | null | undefined): string {
  const ms = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(ms)) return "—";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: MSK, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
}

/** «07.10.2026» из «2026-10-07». */
export function dateRu(day: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day ?? ""));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "—";
}

// ---------------------------------------------------------------------------
// Состояние источников выдачи — словами

export interface SourceStateLike {
  status: FactorySourceStatus;
  reason: string | null;
  count: number | null;
}

/**
 * Строка о том, как ответил источник: «Поиск поставщиков: 5 фабрик», «Поиск поставщиков: этот навык 1688 нашим ключом недоступен — ниже
 * только продавцы из выдачи товаров». tone: ok — ответил, warn — не ответил или пусто.
 */
export function sourceStateLine(kind: "suppliers" | "products", state: SourceStateLike): { text: string; tone: "ok" | "warn" } {
  const name = kind === "suppliers" ? "Поиск поставщиков" : "Поиск товаров";
  if (state.status === "ok" && state.count) {
    const what = kind === "suppliers" ? plural(state.count, "фабрика", "фабрики", "фабрик") : plural(state.count, "карточка", "карточки", "карточек");
    return { text: `${name}: ${state.count.toLocaleString("ru-RU")} ${what}`, tone: "ok" };
  }
  const reason = state.reason ?? (state.status === "ok" ? "пусто" : "не ответил");
  const tail = state.status !== "ok" && kind === "suppliers" ? " — ниже только продавцы из выдачи товаров" : state.status !== "ok" ? " — ниже только фабрики поиска поставщиков" : "";
  return { text: `${name}: ${reason}${tail}`, tone: "warn" };
}

/** Число фабрик словами для заголовков блоков: «5 фабрик», «1 продавец». */
export const factoriesCount = (n: number) => `${n.toLocaleString("ru-RU")} ${plural(n, "фабрика", "фабрики", "фабрик")}`;
export const sellersCount = (n: number) => `${n.toLocaleString("ru-RU")} ${plural(n, "продавец", "продавца", "продавцов")}`;
