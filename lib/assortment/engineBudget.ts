import { BRIGHTDATA_TARGETS, targetSignature, ZARA_PHOTOS, type CollectionTarget, type TargetPart } from "./brightdataCatalog";
import { COLLECTION_WEEKDAYS } from "./collectorSchedule";

/**
 * Сквозной учёт расхода движка тенденций и общий потолок недели (Ф2, решение владельца — $30 в неделю на весь движок). Чистые функции.
 *
 * Весь платный расход движка пишется в одну таблицу `assortment_ai_usage` (строка на день и статью, CHECK на статью нет — миграция не
 * нужна): разбор каталога по фото — то, что списал провайдер (Polza отдаёт рубли в ответе — факт), рилсы и выборки Bright Data —
 * ОЦЕНКА по числу запросов и записей и цене метода (счёт Bright Data в ответах не приходит), старый разбор находок — факт Polza или
 * расчёт по токенам. Неделя — скользящие 7 московских суток, как у бюджета разбора по фото.
 *
 * Потолок проверяется ДО платного запуска. Каталоги в приоритете: у каждой статьи свой «ярус», и ярус может тратить только то, что
 * осталось после невыбранной за неделю нормы ярусов выше. Ярус 0 — готовые наборы Zara и Uniqlo по средам (отказывают последними),
 * ярус 1 — остальные покупки Bright Data (части разделов, ASOS, H&M, фото Zara), ярус 2 — рилсы и разбор по фото (отказывают первыми).
 * У соцсетей ещё и своя строка в потолке (ASSORTMENT_SOCIAL_WEEKLY_USD) — единственный недельный потолок рилсов: потолок запросов недели
 * (ASSORTMENT_SOCIAL_WEEKLY_REQUESTS) — только явное ограничение сверху, переведённое в ту же строку. Это учёт расхода движка в $, а не
 * товарная экономика: цен товаров здесь нет.
 */

export const ENGINE_WEEKLY_BUDGET_DEFAULT_USD = 30;
export const SOCIAL_WEEKLY_DEFAULT_USD = 3;

/**
 * Цены Bright Data, $ за 1 000 — ОЦЕНКА (цены методов на 10.2026; владелец один раз сверяет с кабинетом, расхождение ≤20%).
 * Готовый набор (`/datasets/filter`) — за пришедшие записи, пустая выборка бесплатна; сборщик по ключу или ссылке
 * (`/datasets/v3/trigger`, ASOS и H&M) — за собранные записи; Web Unlocker (рилсы) — за запрос.
 */
export const BRIGHTDATA_USD_PER_1000 = { dataset: 2.5, collector: 1.5, unlocker: 1.5 } as const;

/** Статьи расхода в `assortment_ai_usage.kind`. */
export const ENGINE_KIND = {
  /** Разбор каталога по фото (Polza или Anthropic). */
  catalogAi: "catalog_attributes",
  /** Старый разбор находок (`/api/sync/assortment-ai-attributes`) — только учёт: провайдера не меняем, решения владельца нет. */
  referenceAi: "reference_ai",
  /** Рилсы Instagram через Web Unlocker. */
  social: "brightdata_social",
  /** Зарезервировано: разбор соцфото (Этап 6, не подключён). */
  socialAttributes: "social_attributes",
} as const;

/** Статья Bright Data: раздел бренда, часть раздела или фото Zara. */
export type BrightDataArticle = "zara" | "uniqlo" | "asos" | "hm" | "zara_photos" | TargetPart;

export const brightdataKind = (article: BrightDataArticle): string => `brightdata:${article}`;

const METHOD_ARTICLE: Record<string, BrightDataArticle> = { brightdata_zara: "zara", brightdata_uniqlo: "uniqlo", brightdata_asos: "asos", brightdata_hm: "hm" };

/** Статья цели или пробы Bright Data: часть раздела — своей статьёй, иначе — по бренду (методу). null — метод незнакомый. */
export function targetKind(target: { method: string; part?: TargetPart | string | null }): string | null {
  if (target.part === "zara_chaqueta" || target.part === "uniqlo_collab") return brightdataKind(target.part);
  const article = METHOD_ARTICLE[target.method];
  return article ? brightdataKind(article) : null;
}

export const ZARA_PHOTOS_KIND = brightdataKind("zara_photos");

/** Статьи движка — то, что входит в недельный итог. Замки прогонов (`lock:…`) и чужие назначения — нет. */
export function isEngineKind(kind: string): boolean {
  if (kind.startsWith("lock:")) return false;
  return kind.startsWith("brightdata:") || (Object.values(ENGINE_KIND) as string[]).includes(kind);
}

/** Ярус статьи: 0 — отказывает последним (Zara и Uniqlo по средам), 2 — первым (рилсы, разбор по фото). */
export function kindTier(kind: string): 0 | 1 | 2 {
  if (kind === brightdataKind("zara") || kind === brightdataKind("uniqlo")) return 0;
  if (kind.startsWith("brightdata:")) return 1;
  return 2;
}

const round5 = (n: number) => Math.round(n * 100_000) / 100_000;

/** Оценка расхода по числу записей (запросов) и методу. */
export function brightdataUsd(records: number, method: keyof typeof BRIGHTDATA_USD_PER_1000): number {
  return round5((Math.max(0, records) * BRIGHTDATA_USD_PER_1000[method]) / 1000);
}

/** Сколько записей запуск может принести самое большее — как их ограничивают сами вызовы (filterDataset, triggerCollection). */
export function targetMaxRecords(target: Pick<CollectionTarget, "kind" | "recordsLimit" | "inputs" | "limitPerInput">): number {
  if (target.kind === "dataset") return Math.min(Math.max(1, target.recordsLimit ?? 50), 1000);
  return Math.min(target.inputs.length, 5) * Math.min(Math.max(1, target.limitPerInput), 25);
}

/** Оценка запуска сверху: потолок записей × цена метода. По ней решается, помещается ли запуск в потолок. */
export function targetMaxUsd(target: Pick<CollectionTarget, "kind" | "recordsLimit" | "inputs" | "limitPerInput">): number {
  return brightdataUsd(targetMaxRecords(target), target.kind === "dataset" ? "dataset" : "collector");
}

/** Оценка выборки фото Zara сверху. */
export const ZARA_PHOTOS_MAX_USD = brightdataUsd(ZARA_PHOTOS.recordsLimit, "dataset");

/**
 * Недельная норма каталогов по статьям (оценка сверху): каждая цель × запусков в неделю (набор — раз в свой день, сборщик — в каждый
 * день расписания источника) + выборка фото Zara после среды. Её невыбранная часть — резерв, который ярусы ниже тронуть не могут.
 */
export function catalogWeeklyNeedUsd(targets: readonly CollectionTarget[] = BRIGHTDATA_TARGETS): Record<string, number> {
  const need: Record<string, number> = {};
  for (const target of targets) {
    const kind = targetKind(target);
    if (!kind) continue;
    const runs = target.weekdayUtc !== undefined ? 1 : Math.max(1, COLLECTION_WEEKDAYS[target.sourceId]?.length ?? 1);
    need[kind] = round5((need[kind] ?? 0) + targetMaxUsd(target) * runs);
  }
  need[ZARA_PHOTOS_KIND] = round5((need[ZARA_PHOTOS_KIND] ?? 0) + ZARA_PHOTOS_MAX_USD);
  return need;
}

// ---------------------------------------------------------------------------
// Настройки и неделя

export interface EngineBudgetConfig {
  /** Общий потолок движка, $ за 7 суток (ASSORTMENT_ENGINE_WEEKLY_BUDGET_USD, по умолчанию 30). */
  weeklyUsd: number;
  /**
   * Действующая строка соцсетей, $ за 7 суток: ASSORTMENT_SOCIAL_WEEKLY_USD (по умолчанию 3 ≈ 2 000 запросов), а если владелец явно
   * задал ASSORTMENT_SOCIAL_WEEKLY_REQUESTS и он строже — он, переведённый в $ по цене запроса. Один потолок, а не два.
   */
  socialWeeklyUsd: number;
}

/** Ноль — значение (владелец ставит 0, чтобы остановить расход), мусор и минус — по умолчанию. */
function nonNegative(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function engineBudgetConfig(env: Record<string, string | undefined> = process.env): EngineBudgetConfig {
  const socialUsd = nonNegative(env.ASSORTMENT_SOCIAL_WEEKLY_USD, SOCIAL_WEEKLY_DEFAULT_USD);
  // Потолок запросов недели — только явный: не задан — строка соцсетей в $ решает одна.
  const requests = nonNegative(env.ASSORTMENT_SOCIAL_WEEKLY_REQUESTS, Number.POSITIVE_INFINITY);
  const byRequests = Number.isFinite(requests) ? round5((Math.floor(requests) * BRIGHTDATA_USD_PER_1000.unlocker) / 1000) : Number.POSITIVE_INFINITY;
  return {
    weeklyUsd: nonNegative(env.ASSORTMENT_ENGINE_WEEKLY_BUDGET_USD, ENGINE_WEEKLY_BUDGET_DEFAULT_USD),
    socialWeeklyUsd: Math.min(socialUsd, byRequests),
  };
}

/** Сколько запросов Web Unlocker в неделю даёт строка соцсетей (оценка по цене запроса). */
export function socialWeeklyRequests(config: Pick<EngineBudgetConfig, "socialWeeklyUsd">): number {
  return Math.floor((config.socialWeeklyUsd * 1000) / BRIGHTDATA_USD_PER_1000.unlocker + 1e-6);
}

/** Расход движка за 7 суток по статьям. */
export interface EngineWeek {
  byKind: Record<string, number>;
  total: number;
}

export const emptyWeek = (): EngineWeek => ({ byKind: {}, total: 0 });

/** Строки учёта → неделя: только статьи движка; замки и чужие назначения — мимо. */
export function engineWeek(rows: ReadonlyArray<{ kind: string; cost_usd: number | string | null }>): EngineWeek {
  const byKind: Record<string, number> = {};
  for (const row of rows) {
    const kind = String(row.kind ?? "");
    if (!isEngineKind(kind)) continue;
    const usd = Number(row.cost_usd ?? 0);
    if (!Number.isFinite(usd) || usd <= 0) continue;
    byKind[kind] = round5((byKind[kind] ?? 0) + usd);
  }
  return { byKind, total: round5(Object.values(byKind).reduce((sum, v) => sum + v, 0)) };
}

/** Прибавить расход статьи (оплаченный, но ещё не записанный в учёт, — пробы в очереди, покупки этого запуска). */
export function addToWeek(week: EngineWeek, kind: string, usd: number): EngineWeek {
  if (!(usd > 0)) return week;
  return { byKind: { ...week.byKind, [kind]: round5((week.byKind[kind] ?? 0) + usd) }, total: round5(week.total + usd) };
}

/** Невыбранная за неделю норма ярусов выше `tier`: её статья этого яруса тронуть не может. */
export function engineReserveUsd(week: EngineWeek, tier: 0 | 1 | 2, need: Record<string, number> = catalogWeeklyNeedUsd()): number {
  let reserve = 0;
  for (const [kind, usd] of Object.entries(need)) {
    if (kindTier(kind) >= tier) continue;
    reserve += Math.max(0, usd - (week.byKind[kind] ?? 0));
  }
  return round5(reserve);
}

/** Сколько ещё может потратить статья за эту неделю: потолок − итог − резерв ярусов выше; у рилсов — ещё и не больше своей строки. */
export function engineRoomUsd(week: EngineWeek, kind: string, config: EngineBudgetConfig, need: Record<string, number> = catalogWeeklyNeedUsd()): number {
  let room = config.weeklyUsd - week.total - engineReserveUsd(week, kindTier(kind), need);
  if (kind === ENGINE_KIND.social) room = Math.min(room, config.socialWeeklyUsd - (week.byKind[kind] ?? 0));
  return Math.max(0, round5(room));
}

/** Остаток рилсов и во что он упирается: в строку соцсетей (своя недельная норма) или в общий потолок (резерв под каталоги). */
export function socialRoomUsd(week: EngineWeek, config: EngineBudgetConfig, need: Record<string, number> = catalogWeeklyNeedUsd()): { usd: number; by: "social_line" | "engine" } {
  const general = Math.max(0, round5(config.weeklyUsd - week.total - engineReserveUsd(week, kindTier(ENGINE_KIND.social), need)));
  const line = Math.max(0, round5(config.socialWeeklyUsd - (week.byKind[ENGINE_KIND.social] ?? 0)));
  return line <= general ? { usd: line, by: "social_line" } : { usd: general, by: "engine" };
}

const usd = (n: number) => `$${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Помещается ли запуск в потолок; нет — причина словами (для «Источников» и журнала): оценка запуска, остаток статьи, итог недели и
 * резерв под каталоги. null — помещается.
 */
export function engineRefusal(week: EngineWeek, kind: string, estimateUsd: number, config: EngineBudgetConfig, need: Record<string, number> = catalogWeeklyNeedUsd()): string | null {
  const room = engineRoomUsd(week, kind, config, need);
  if (estimateUsd <= room + 1e-9) return null;
  const reserve = engineReserveUsd(week, kindTier(kind), need);
  const socialLine = kind === ENGINE_KIND.social && config.socialWeeklyUsd - (week.byKind[kind] ?? 0) <= room + 1e-9;
  const why = socialLine
    ? `строка соцсетей ${usd(config.socialWeeklyUsd)} в неделю выбрана (${usd(week.byKind[kind] ?? 0)})`
    : `за 7 дней ${usd(week.total)} из ${usd(config.weeklyUsd)}${reserve > 0 ? `, под каталоги отложено ${usd(reserve)}` : ""}`;
  return `общий потолок движка: запуск ≈${usd(estimateUsd)} (оценка) не помещается в остаток ${usd(room)} — ${why}`;
}

/** Подписи статей для полоски «На чём стоят цифры». */
export const ENGINE_KIND_LABEL: Record<string, string> = {
  [ENGINE_KIND.catalogAi]: "разбор по фото",
  [ENGINE_KIND.referenceAi]: "старый разбор находок",
  [ENGINE_KIND.social]: "рилсы Instagram",
  [ENGINE_KIND.socialAttributes]: "разбор соцфото",
  [brightdataKind("zara")]: "Zara",
  [brightdataKind("uniqlo")]: "Uniqlo",
  [brightdataKind("asos")]: "ASOS",
  [brightdataKind("hm")]: "H&M",
  [brightdataKind("zara_photos")]: "фото Zara",
  [brightdataKind("zara_chaqueta")]: "Zara CHAQUETA",
  [brightdataKind("uniqlo_collab")]: "коллаборации Uniqlo",
};

/** Порядок статей Bright Data в строке: как в подписи, незнакомые — по коду в конце. */
export const BRIGHTDATA_KIND_ORDER = ["zara", "zara_chaqueta", "zara_photos", "uniqlo", "uniqlo_collab", "asos", "hm"].map((a) => brightdataKind(a as BrightDataArticle));

/**
 * Оценка оплаченной, но ещё не собранной пробы сверху (её расход запишет сбор): набор — по потолку выборки, сборщик — по своей цели.
 * Нужна платному запуску: второй запуск в тот же день иначе видел бы потолок свободным.
 */
export function pendingMaxUsd(p: { kind?: "collect" | "dataset"; recordsLimit?: number; datasetId: string; direction: string; targetKey?: string }, targets: readonly CollectionTarget[] = BRIGHTDATA_TARGETS): number {
  if (p.kind === "dataset") return brightdataUsd(Math.min(Math.max(1, p.recordsLimit ?? 50), 1000), "dataset");
  const target = targets.find((t) => t.kind !== "dataset" && t.datasetId === p.datasetId && t.direction === p.direction && targetSignature(t) === p.targetKey);
  return target ? targetMaxUsd(target) : 0;
}
