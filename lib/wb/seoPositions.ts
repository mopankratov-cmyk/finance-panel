// Ежедневный замер SEO-позиций WB по всем SKU кабинета.
//
// Что мерим. WB search-texts отдаёт частотность запроса и МЕДИАНУ позиции за
// заданный период. Раньше медиану за 14 дней клали в снимок «на сегодня», и
// только когда кто-то открывал карточку: «посуточный» ряд был набором
// четырнадцатидневных медиан, а день существовал лишь у открытых артикулов.
// Теперь крон меряет ВЧЕРАШНИЙ закрытый день по Москве (start = end = D) и
// пишет значение в snapshot_date = D. Старые строки не удаляются: у них
// synced_at приходится на тот же московский день, что и snapshot_date, а у
// ночных он всегда следующий — по этому признаку читатель их различает
// (isClosedDaySnapshot).
//
// Что не проверено живьём (WB в разработке не вызывали):
//   1. однодневный период start = end — спека разрешает, пример WB такой же;
//   2. limit считается на КАЖДЫЙ артикул пакета, а не на весь пакет.
// Оба места устроены так, чтобы проверить себя сами. Непринятый период даёт 400 на КАЖДЫЙ
// запрос: ничего не пишется и день не закрывается (пакеты с 400 становятся дырами), а после
// SEO_SYSTEMATIC_400_REQUESTS НЕЗАВИСИМЫХ отказов прогона (непересекающиеся пакеты) без единого
// принятого ответа, все — 400, прогон кабинета останавливается со статусом error и громким
// журналом, не тратя квоту продавца на остаток ночи. Один ядовитый артикул так не выглядит: его
// деление пополам и тот же артикул в другой день — вложенные диапазоны, они считаются за один. Общий лимит узнаётся по ответу ровно в limit строк на пакет
// из нескольких артикулов — тогда замер переходит на режим «по одному артикулу».
//
// День никогда не закрывается молча. Закрытый день (doneDays) — это день, по
// которому ВСЕ артикулы спрошены и ответ принят. Пакет, не прошедший три раза
// подряд (или ответивший 400 — он детерминирован), не «проскакивается»: он
// становится ДЫРОЙ дня (state.holes), день с дырой остаётся открытым
// (state.partial), дыры перепроверяются раньше догрузки истории (за прогон на дыры
// вчерашнего дня уходит не больше SEO_HOLE_REQUESTS_YESTERDAY запросов, на дыры всех
// старых дней вместе — SEO_HOLE_REQUESTS_OLDER, давно не пробованные первыми), а после
// SEO_HOLE_MAX_NIGHTS ночей день закрывается с записью об отказе. День, по
// которому WB не вернул ни одной строки при живых артикулах, тоже не закрывается
// (state.emptyDays): пустой ответ на весь день — это симптом, а не результат.
// Один и тот же охранник (settleDay) стоит и в конце прохода, и там, где день
// закрывают перепроверкой дыр; отложенные дни не залипают: не чаще раза в
// SEO_EMPTY_PROBE_EVERY_MS и раза за прогон их проверяет ОДИН запрос (probe), и как
// только WB снова отдаёт строки, все отложенные дни возвращаются в работу.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SyncTarget } from "@/lib/sync/cabinets";
import { moscowToday, shiftIsoDay } from "@/lib/sync/moscowDay";
import { loadAllSupabasePages } from "@/lib/supabase/loadAllPages";
import { fetchWbFunnelHistory } from "./funnelRequest";
import { allowsNm } from "./productScope";
import { closedMoscowDates } from "./sklejki";
import type { WbSyncState } from "./syncState";

export const SEO_POSITIONS_JOB = "seo-positions";
export const SEARCH_TEXTS_URL = "https://seller-analytics-api.wildberries.ru/api/v2/search-report/product/search-texts";
/** nmIds maxItems по спеке search-texts. */
export const SEO_NM_BATCH = 50;
/** Максимум «Стандартного» тарифа Джема; экран и так показывает топ-30 запросов. */
export const SEO_TEXT_LIMIT = 30;
/** Окно истории экрана: столько закрытых дней показывает таблица позиций. */
export const SEO_HISTORY_DAYS = 30;
/** Лимит WB на продавца: 3 запроса в минуту, интервал 20 с; полсекунды запаса. */
export const SEO_REQUEST_SPACING_MS = 20_500;
/** После 403 кабинет пробуем раз в ночь: подключат Джем — замер начнётся сам. */
export const SEO_UNAVAILABLE_COOLDOWN_MS = 20 * 3_600_000;
/** Прогон длится не дольше 300 с, следующий через 30 минут. */
export const SEO_LEASE_SECONDS = 10 * 60;
/** Столько неудач подряд на одном месте курсора, после чего пакет пропускаем. */
export const SEO_BATCH_MAX_ATTEMPTS = 3;
/** «Активный» SKU: за это число дней были переходы в карточку или корзины. */
export const SEO_ACTIVE_DAYS = 14;
/** Столько ночей дыры дня перепроверяются; потом день закрывается с записью об отказе. */
export const SEO_HOLE_MAX_NIGHTS = 3;
/**
 * Дыра из нескольких артикулов делится пополам после стольких неудачных перепроверок
 * (любого рода: 5xx, таймаут, обрезанный ответ); 400 делит сразу — он детерминирован.
 */
export const SEO_HOLE_SPLIT_AFTER = 2;
/**
 * Потолки запросов за прогон на перепроверку дыр. Без них перепроверка шла с начала списка до конца
 * бюджета, хвост не получал запроса никогда, ночь не засчитывалась, а догрузка истории стояла.
 * Вчерашний день важнее — ему больше; на ВСЕ старые дни вместе — столько, чтобы история шла дальше.
 */
export const SEO_HOLE_REQUESTS_YESTERDAY = 6;
export const SEO_HOLE_REQUESTS_OLDER = 4;
/** Отложенный пустой день проверяется не чаще (прогоны идут раз в 30 минут: проба — через прогон). */
export const SEO_EMPTY_PROBE_EVERY_MS = 50 * 60_000;
/** Если воронка не назвала живых артикулов, пустой день подозрителен, пока кабинет писал строки не позже этого числа дней назад. */
export const SEO_EMPTY_GUARD_DAYS = 7;
/**
 * Столько НЕЗАВИСИМЫХ отказов прогона без единого принятого ответа и ровно с 400 — признак того, что WB не
 * принимает сам запрос (период start = end, схему тела), а не один плохой артикул: дальше прогон не идёт.
 * Считаются не запросы, а отказы непересекающихся пакетов. Ядовитый артикул отвергает пакет, а потом его
 * половины, четверти и одиночку — все эти диапазоны вложены друг в друга и содержат один и тот же артикул,
 * поэтому считаются за один (так же — он же в другой день). Первая версия считала запросы и останавливала
 * кабинет из-за ОДНОГО плохого артикула: 0 из 40 измерено при 39 здоровых. Системный отказ отвергает
 * непересекающиеся пакеты — их три и больше. Если три плохих артикула легли в три разных пакета, прогон
 * остановится раньше, но пакеты с 400 уже станут дырами и следующий прогон пойдёт дальше с курсора.
 */
export const SEO_SYSTEMATIC_400_REQUESTS = 3;
/**
 * Запрос к WB не ждём дольше, чем бюджет прогона + это; группа отсекается позже
 * (SEO_GROUP_CUTOFF_AFTER_DEADLINE_MS), чтобы оборванный запрос успел записать свою неудачу.
 */
export const SEO_REQUEST_OVERRUN_MS = 20_000;
/** Группа, не вернувшаяся к этому сроку после конца бюджета, отдаётся как зависшая. */
export const SEO_GROUP_CUTOFF_AFTER_DEADLINE_MS = 30_000;
const SEO_RATE_LIMIT_FALLBACK_MS = 21_000;

export interface SearchTextItem {
  text?: string;
  nmId?: number;
  frequency?: { current?: number };
  weekFrequency?: number;
  medianPosition?: { current?: number };
  avgPosition?: { current?: number };
}

export type SeoPositionRow = {
  nm_id: number;
  keyword: string;
  frequency: number | null;
  median_position: number | null;
  cabinet_id: string | null;
  snapshot_date: string;
  synced_at: string;
};

export type SeoUnavailableReason = "no_jam" | "token_scope" | "base_token" | "unauthorized" | "forbidden";
export type SeoMode = "batch" | "batch-confirmed" | "single";

/**
 * `message` — полный текст для журнала (обрезанный, без секретов), `status` — то,
 * что можно показать пользователю: тело ответа WB на экран не идёт.
 */
export type SeoWbFailure =
  | { kind: "rate_limit" }
  | { kind: "unavailable"; reason: SeoUnavailableReason; message: string }
  | { kind: "bad_request"; message: string; status: number }
  | { kind: "server"; message: string; status?: number };

/**
 * Дыра дня: пакет артикулов, который не удалось измерить. Хранится диапазоном
 * значений nmId, а не списком: набор артикулов кабинета к повтору может измениться.
 */
export interface SeoHole {
  from: number;
  to: number;
  /** Сколько артикулов было в пакете. */
  count: number;
  /**
   * Сколько раз перепроверка дыры не прошла. С SEO_HOLE_SPLIT_AFTER дыра из нескольких артикулов
   * делится пополам без запроса; пакет, ответивший 400, рождается уже с этим значением.
   */
  tries: number;
  /** Когда дыру спрашивали в последний раз (ISO): по нему давно не пробованные идут первыми. */
  triedAt?: string;
}

export interface SeoPositionsState extends Record<string, unknown> {
  /** Измеряемый сейчас день и последний обработанный в нём nmId (курсор). */
  day?: string;
  afterNm?: number;
  /** Дни окна, по которым прошли все SKU кабинета (и дни, от которых отказались, см. holes). */
  doneDays?: string[];
  mode?: SeoMode;
  totalSku?: number;
  processedSku?: number;
  /**
   * Строк записано по дням, которые ещё не закрыты (проход и перепроверка дыр вместе): ноль при
   * живых артикулах — подозрительный день, закрывать его нельзя ни в конце прохода, ни после дыр.
   */
  dayRowsByDay?: Record<string, number>;
  /** Дата последней ночи, когда кабинет записал строки: пустой день при пустой воронке подозрителен, пока она свежая. */
  lastRowsAt?: string;
  /** Дыры по дням. У дня из doneDays они значат «от них отказались»: ленивый роут может спросить WB сам. */
  holes?: Record<string, SeoHole[]>;
  /** Дни, чей проход закончен, но дыры остались → даты ночей, когда дыры перепроверяли. */
  partial?: Record<string, string[]>;
  /** Дни, по которым WB не вернул ни одной строки при живых артикулах → время последней проверки (ISO). */
  emptyDays?: Record<string, string>;
  /** single: курсор ротации между ночами, день начинается с него и идёт по кругу. */
  rotation?: number;
  dayStartNm?: number;
  wrapped?: boolean;
  unavailableAt?: string;
  reason?: SeoUnavailableReason;
  rateLimitedAt?: string;
  lastRunAt?: string;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------- чистые функции

/** Тело запроса на ОДИН закрытый день. Поля offset у метода нет и пагинации тоже. */
export function searchTextsDayBody(nmIds: number[], day: string, limit = SEO_TEXT_LIMIT): string {
  return JSON.stringify({
    currentPeriod: { start: day, end: day },
    nmIds,
    topOrderBy: "openCard",
    orderBy: { field: "openCard", mode: "desc" },
    limit,
  });
}

/** Вчерашний закрытый день по Москве — день, который меряет ночной крон. */
export function seoYesterday(nowMs = Date.now()): string {
  return closedMoscowDates(1, nowMs)[0];
}

// WB иногда присылает 0 там, где данных нет: ноль позиции — это «нет данных», а не первое место.
function positiveWhole(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.max(1, Math.round(value));
}

function nonNegativeWhole(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

/**
 * Строки таблицы из ответа WB. Медиана важнее среднего; ноль — «нет данных»;
 * чужие артикулы (не из пакета или не из контура кабинета) и пустые запросы
 * отбрасываются; повтор (nm, keyword) убран — иначе upsert с двумя строками
 * одного ключа в одной пачке падает целиком.
 */
export function seoRowsFromItems(
  items: readonly SearchTextItem[],
  o: {
    day: string;
    cabinetId: string | null;
    requested: ReadonlySet<number>;
    allowNm: (nm: number) => boolean;
    syncedAt: string;
  },
): SeoPositionRow[] {
  const seen = new Set<string>();
  const rows: SeoPositionRow[] = [];
  for (const item of items) {
    const nm = Number(item.nmId);
    if (!Number.isInteger(nm) || !o.requested.has(nm) || !o.allowNm(nm)) continue;
    const keyword = typeof item.text === "string" ? item.text.trim() : "";
    if (!keyword) continue;
    const key = `${nm}\u0000${keyword}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      nm_id: nm,
      keyword,
      frequency: nonNegativeWhole(item.frequency?.current),
      median_position: positiveWhole(item.medianPosition?.current) ?? positiveWhole(item.avgPosition?.current),
      cabinet_id: o.cabinetId,
      snapshot_date: o.day,
      synced_at: o.syncedAt,
    });
  }
  return rows;
}

function failureDetail(body: string): string {
  return body
    .replace(/\s+/g, " ")
    // Токен в журнал не попадает, даже если WB его вернёт в тексте ошибки.
    .replace(/eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/g, "[токен скрыт]")
    .trim()
    .slice(0, 200);
}

const JAM_TEXT = /jam|subscription|подписк/i;

/**
 * Что значит ответ WB на search-texts. Раньше любой 403 выдавали за «нет Джема»,
 * хотя 403 бывает и от токена без категории «Аналитика», и от базового токена.
 * 429 на этом методе всегда лимитер (общий, по продавцу, или пустое тело).
 */
export function classifySearchTextsFailure(status: number, body: string): SeoWbFailure {
  const message = `WB ${status}: ${failureDetail(body)}`;
  if (status === 429) return { kind: "rate_limit" };
  if (status === 403) {
    if (/scope is not allowed/i.test(body)) return { kind: "unavailable", reason: "token_scope", message };
    if (/base token is not allowed/i.test(body)) return { kind: "unavailable", reason: "base_token", message };
    if (JAM_TEXT.test(body)) return { kind: "unavailable", reason: "no_jam", message };
    return { kind: "unavailable", reason: "forbidden", message };
  }
  if (status === 401) return { kind: "unavailable", reason: "unauthorized", message };
  // Про подписку WB пишет не только в 403: по SDK-описанию search-texts без Джема отвечает и 400,
  // а старый роут узнавал «Джем» в любом непустом тексте ошибки. Иначе кабинет без подписки
  // получил бы ошибку в каждом прогоне, три неудачи и «пропущенный» пакет вместо паузы.
  if ((status === 400 || (status >= 402 && status <= 404)) && JAM_TEXT.test(body)) {
    return { kind: "unavailable", reason: "no_jam", message };
  }
  if (status >= 400 && status < 500) return { kind: "bad_request", message, status };
  return { kind: "server", message, status };
}

/** Тексты для экрана: общие у крона и ленивого роута, чтобы они не разошлись. */
export function seoUnavailableMessage(reason: SeoUnavailableReason): string {
  switch (reason) {
    case "no_jam":
      return "Поисковая аналитика WB — только по подписке «Джем» (Аналитика → Джем в кабинете WB этого юрлица). Без неё позиции по запросам недоступны.";
    case "token_scope":
      return "У токена этого кабинета нет категории «Аналитика»: выпустите токен с этой категорией в кабинете WB.";
    case "base_token":
      return "Базовый токен WB не подходит для поисковой аналитики: нужен персональный или сервисный токен с категорией «Аналитика».";
    case "unauthorized":
      return "WB не принял токен кабинета (401): проверьте, что токен действителен.";
    case "forbidden":
      return "WB отказал в доступе к поисковой аналитике (403): проверьте категорию «Аналитика» у токена и подписку «Джем».";
  }
}

/**
 * Сообщение пользователю по сбою ЖИВОГО запроса ленивого роута. Тело ответа WB
 * (title, detail, requestId, а то и HTML) на экран не выводим — только статус;
 * полный текст остаётся в lastError крона.
 */
export function seoFailureMessage(failure: SeoWbFailure): string {
  if (failure.kind === "unavailable") return seoUnavailableMessage(failure.reason);
  if (failure.kind === "rate_limit") return "Лимит запросов WB: позиции за вчера появятся после ночного замера.";
  return failure.status ? `WB ${failure.status}` : "WB не ответил";
}

/**
 * Строка относится к закрытому дню, если записана позже конца своего московского
 * дня. У старых «ленивых» строк (14-дневная медиана, подписанная днём открытия)
 * snapshot_date и московская дата synced_at совпадают — их читатель не показывает.
 */
export function isClosedDaySnapshot(row: { snapshot_date: string; synced_at: string | null }): boolean {
  if (!row.synced_at) return false;
  const syncedMs = Date.parse(row.synced_at);
  if (!Number.isFinite(syncedMs)) return false;
  return moscowToday(syncedMs) > row.snapshot_date.slice(0, 10);
}

/** Дни окна, которые ещё предстоит измерить: вчера первым, затем назад. */
export function seoDaysToMeasure(doneDays: readonly string[], nowMs: number, historyDays = SEO_HISTORY_DAYS): string[] {
  const done = new Set(doneDays);
  return closedMoscowDates(historyDays, nowMs).reverse().filter((day) => !done.has(day));
}

/** Следующий пакет после курсора. Список — по возрастанию; курсор — значение, а не индекс. */
export function nextSeoBatch(sortedNmIds: readonly number[], afterNm: number, size: number): number[] {
  const batch: number[] = [];
  for (const nm of sortedNmIds) {
    if (nm <= afterNm) continue;
    batch.push(nm);
    if (batch.length >= size) break;
  }
  return batch;
}

/**
 * Ответ ровно в limit строк на пакет из нескольких артикулов — признак того,
 * что limit общий на пакет и ответ обрезан. При limit на каждый артикул строк
 * в ответе на пакет заведомо больше limit.
 */
export function looksTruncated(batchSize: number, itemsCount: number, limit: number): boolean {
  return batchSize > 1 && itemsCount === limit;
}

/** Кабинет стоит на паузе после 403: пробуем не чаще раза за SEO_UNAVAILABLE_COOLDOWN_MS. */
export function isSeoUnavailablePause(
  saved: { status: string; state: SeoPositionsState } | null,
  nowMs: number,
): boolean {
  if (saved?.status !== "unavailable" || !saved.state.unavailableAt) return false;
  const at = Date.parse(saved.state.unavailableAt);
  return Number.isFinite(at) && nowMs - at < SEO_UNAVAILABLE_COOLDOWN_MS;
}

/**
 * Нужен ли ленивому роуту живой запрос к WB за вчера. Квоты WB (3 запроса в минуту
 * на продавца) едва хватает ночному замеру, поэтому живой запрос — последнее средство:
 * только если вчерашнего значения по товару нет, ночной замер до него не дошёл
 * (иначе он уже спросил WB и получил пустой день) и кабинет не на паузе после 403.
 */
export function seoLivePlan(input: {
  haveYesterday: boolean;
  measuredByNight: boolean;
  paused: boolean;
}): "have" | "measured" | "paused" | "live" {
  if (input.haveYesterday) return "have";
  if (input.measuredByNight) return "measured";
  if (input.paused) return "paused";
  return "live";
}

function trimDoneDays(doneDays: readonly string[], nowMs: number): string[] {
  const oldest = closedMoscowDates(SEO_HISTORY_DAYS, nowMs)[0];
  return [...new Set(doneDays)].filter((day) => day >= oldest).sort();
}

/** Записи по дням живут не дольше окна истории: дальше экран их не читает. */
function trimDayRecord<T>(record: Record<string, T> | undefined, nowMs: number): Record<string, T> {
  const oldest = closedMoscowDates(SEO_HISTORY_DAYS, nowMs)[0];
  return Object.fromEntries(Object.entries(record ?? {}).filter(([day]) => day >= oldest));
}

/** Артикул попадает в дыру, если его значение лежит в диапазоне одного из пакетов. */
export function holeCovers(holes: readonly SeoHole[] | undefined, nm: number): boolean {
  return (holes ?? []).some((hole) => nm >= hole.from && nm <= hole.to);
}

/**
 * Сколько артикулов осталось без замера: дыры дней, которые ещё не закрыты.
 * Дыры закрытого дня («отказались») сюда не входят — о них журнал сказал один раз.
 */
export function seoUnresolvedHoleCount(state: SeoPositionsState, day?: string): number {
  const done = new Set(state.doneDays ?? []);
  return Object.entries(state.holes ?? {})
    .filter(([holeDay]) => (day === undefined || holeDay === day) && !done.has(holeDay))
    .reduce((sum, [, holes]) => sum + holes.reduce((inner, hole) => inner + hole.count, 0), 0);
}

/**
 * Режим «по одному» не успевает за ночь весь список, поэтому меряет ЛОМОТЬ: ночь
 * начинается с курсора прошлой ночи (startNm) и идёт по кругу. Раньше каждая ночь
 * начиналась с нуля, и дальше первых ~95 артикулов дело не шло никогда.
 * Возвращает следующий артикул и новое положение курсора; пустой batch — круг пройден.
 */
export function nextSeoSingle(
  sortedNmIds: readonly number[],
  afterNm: number,
  startNm: number,
  wrapped: boolean,
): { batch: number[]; afterNm: number; wrapped: boolean } {
  let cursor = afterNm;
  let didWrap = wrapped;
  for (;;) {
    const upper = didWrap ? startNm : Number.POSITIVE_INFINITY;
    const next = sortedNmIds.find((nm) => nm > cursor && nm <= upper);
    if (next !== undefined) return { batch: [next], afterNm: cursor, wrapped: didWrap };
    if (didWrap || startNm <= 0) return { batch: [], afterNm: cursor, wrapped: didWrap };
    didWrap = true;
    cursor = 0;
  }
}

/**
 * Сколько ждать ответ WB: не дольше минуты и не дольше, чем через SEO_REQUEST_OVERRUN_MS
 * после конца бюджета прогона (функция живёт 300 с, бюджет 250). Запас меньше отсечки группы
 * (SEO_GROUP_CUTOFF_AFTER_DEADLINE_MS): оборванный запрос успевает записать свою неудачу
 * ДО того, как роут бросит группу, и устаревшая запись состояния не ляжет поверх чужого прогона.
 */
export function seoRequestTimeoutMs(deadline: number, nowMs: number): number {
  return Math.max(1_000, Math.min(60_000, deadline - nowMs + SEO_REQUEST_OVERRUN_MS));
}

/**
 * Ждать работу не дольше ms; потом вернуть запасной результат. Если одна группа
 * продавца подвисла, итог остальных и запись в sync_log не должны пропасть.
 */
export async function settleWithin<T>(work: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cutoff = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), Math.max(0, ms));
  });
  try {
    return await Promise.race([work, cutoff]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Сброс состояния кабинета для повторного замера после диагноза: один день
 * (`day`) или всё окно (`null`). Паузу после 403 не трогает — её снимает ?force=1.
 */
export function resetSeoState(state: SeoPositionsState, day: string | null): SeoPositionsState {
  const next: SeoPositionsState = { ...state };
  const dropDay = (record: Record<string, unknown> | undefined): Record<string, never> | undefined => {
    if (!record || day === null) return undefined;
    return Object.fromEntries(Object.entries(record).filter(([key]) => key !== day)) as Record<string, never>;
  };
  next.doneDays = day === null ? [] : (state.doneDays ?? []).filter((value) => value !== day);
  next.holes = dropDay(state.holes) as SeoPositionsState["holes"];
  next.partial = dropDay(state.partial) as SeoPositionsState["partial"];
  next.emptyDays = dropDay(state.emptyDays) as SeoPositionsState["emptyDays"];
  next.dayRowsByDay = dropDay(state.dayRowsByDay) as SeoPositionsState["dayRowsByDay"];
  for (const key of ["holes", "partial", "emptyDays", "dayRowsByDay"] as const) {
    if (!next[key] || Object.keys(next[key]).length === 0) delete next[key];
  }
  if (day === null || state.day === day) {
    delete next.day;
    delete next.afterNm;
    delete next.processedSku;
    delete next.dayStartNm;
    delete next.wrapped;
  }
  if (day === null) {
    delete next.mode;
    delete next.rotation;
  }
  return next;
}

/**
 * Что крон-роут пишет в wb_sync_state при ?remeasure / ?reset. Пауза после 403 переживает сброс:
 * статус «unavailable» (а с ним и lastError с причиной) остаётся, иначе первая же запись «pending» молча
 * сняла бы паузу, и следующий прогон ушёл бы в WB без Джема. Паузу снимает только ?force=1.
 */
export function seoResetWrite(
  saved: { status: string; lastError: string | null; state: SeoPositionsState },
  day: string | null,
): { cursor: null; status: string; attempts: number; lastError: string | null; state: SeoPositionsState } {
  const paused = saved.status === "unavailable";
  return {
    cursor: null,
    status: paused ? "unavailable" : "pending",
    attempts: 0,
    lastError: paused ? saved.lastError : null,
    state: resetSeoState(saved.state, day),
  };
}

/** Сколько дней старше вчерашнего отложено как пустые: журнал не должен забывать о них, пока они не измерены. */
export function seoEmptyOlderCount(state: SeoPositionsState, yesterday: string): number {
  return Object.keys(state.emptyDays ?? {}).filter((day) => day < yesterday).length;
}

// ---------------------------------------------------------------- ленивый роут: решения

export interface SeoSnapRow {
  keyword: string;
  frequency: number | null;
  median_position: number | null;
  snapshot_date: string;
  synced_at: string | null;
}

export interface SeoKeywordsPayload {
  words: Array<{ keyword: string; shows: number; daily: Array<{ pos: number | null }> }>;
  days: string[];
  note?: string;
  error?: string;
}

/** Окно, которое экран читает из таблицы: 30 закрытых дней, последний — вчера. */
export function seoHistoryWindow(yesterday: string): { from: string; to: string } {
  return { from: shiftIsoDay(yesterday, -(SEO_HISTORY_DAYS - 1)), to: yesterday };
}

/**
 * Что из прочитанного показывать на экране: только закрытые дни окна. Старые
 * «ленивые» строки (14-дневная медиана под днём открытия) и всё, что позже вчера, отсекаются.
 * Окно проверяется и здесь, а не только запросом к базе: решение не должно зависеть от того,
 * что роут не забыл фильтр.
 */
export function selectClosedHistory<T extends { snapshot_date: string; synced_at: string | null }>(
  rows: readonly T[],
  yesterday: string,
): T[] {
  const window = seoHistoryWindow(yesterday);
  return rows.filter((row) => {
    const day = row.snapshot_date.slice(0, 10);
    return day >= window.from && day <= window.to && isClosedDaySnapshot(row);
  });
}

/**
 * Измерил ли ночной замер этот артикул за вчера. День закрыт — да, кроме артикулов из
 * дыр, от которых отказались. День с дырами и законченным проходом — да для всех, кроме
 * самих дыр: остальные артикулы ночь уже спросила. Проход не закончен или день пустой — нет.
 */
export function seoMeasuredByNight(
  state: SeoPositionsState | null | undefined,
  yesterday: string,
  nmId: number,
): boolean {
  if (!state) return false;
  const holes = state.holes?.[yesterday];
  if (holeCovers(holes, nmId)) return false;
  if ((state.doneDays ?? []).includes(yesterday)) return true;
  return state.partial?.[yesterday] !== undefined;
}

// Нет снимков и нет ошибки — значит WB сам ответил пустотой: ночной замер за вчера прошёл без запросов по товару
// либо только что так ответил живой запрос. «Данные накапливаются» здесь неправда: если ночь ещё не измерила
// артикул, роут спрашивает WB сам и получает настоящий ответ.
export const SEO_NOTE_MEASURED_EMPTY = "За вчера WB не вернул по товару запросов с позицией.";

/**
 * Ответ ленивого роута из снимков. Пустой экран всегда объяснён: сбой живого запроса — ошибкой,
 * пустой ответ WB (ночью или только что живым запросом) — своими словами.
 */
export function buildKeywordsPayload(
  snaps: readonly SeoSnapRow[],
  ctx: { liveError: string | null },
): SeoKeywordsPayload {
  if (!snaps.length) {
    if (ctx.liveError) return { words: [], days: [], error: ctx.liveError };
    return { words: [], days: [], note: SEO_NOTE_MEASURED_EMPTY };
  }
  const days = [...new Set(snaps.map((snap) => snap.snapshot_date.slice(0, 10)))].sort();
  const byKeyword = new Map<string, { freq: number; pos: Map<string, number | null> }>();
  for (const snap of snaps) {
    const entry = byKeyword.get(snap.keyword) ?? { freq: 0, pos: new Map<string, number | null>() };
    entry.freq = Math.max(entry.freq, Number(snap.frequency ?? 0));
    entry.pos.set(snap.snapshot_date.slice(0, 10), snap.median_position);
    byKeyword.set(snap.keyword, entry);
  }
  const words = [...byKeyword.entries()]
    .sort((left, right) => right[1].freq - left[1].freq)
    .slice(0, 30)
    .map(([keyword, entry]) => ({
      keyword,
      shows: entry.freq,
      daily: days.map((day) => ({ pos: entry.pos.get(day) ?? null })),
    }));
  return { words, days, note: ctx.liveError ?? undefined };
}

/**
 * Строки из ответа живого запроса по одному артикулу. WB может не прислать nmId в
 * записи — тогда она относится к запрошенному; ответ с записями, из которых не
 * разобрана ни одна, — явная ошибка, а не «пустой день» (как в ночном замере).
 */
export function seoLiveRows(
  items: readonly SearchTextItem[],
  o: { nmId: number; day: string; cabinetId: string | null; syncedAt: string },
): { rows: SeoPositionRow[] } | { error: string } {
  const rows = seoRowsFromItems(
    items.map((entry) => ({ ...entry, nmId: entry.nmId ?? o.nmId })),
    { day: o.day, cabinetId: o.cabinetId, requested: new Set([o.nmId]), allowNm: () => true, syncedAt: o.syncedAt },
  );
  if (items.length > 0 && rows.length === 0) {
    return { error: `WB 200: ${items.length} записей, ни одной не разобрано — формат ответа изменился` };
  }
  return { rows };
}

export interface SeoKeywordsDeps {
  now: () => number;
  /** История за окно; бросает при ошибке чтения. */
  readHistory: (window: { from: string; to: string }) => Promise<SeoSnapRow[]>;
  readState: () => Promise<{ status: string; state: SeoPositionsState } | null>;
  getToken: () => Promise<string | null>;
  /** Живой запрос search-texts по одному артикулу за один день. */
  requestLive: (token: string, day: string) => Promise<{ ok: boolean; status: number; text: string }>;
  /** Запись снимка; ошибка записи экрану не мешает, поэтому ничего не возвращает. */
  writeRows: (rows: SeoPositionRow[]) => Promise<void>;
}

/**
 * Весь порядок решений ленивого роута: история закрытых дней → нужен ли живой запрос →
 * сам запрос → ответ. Роут только достаёт зависимости и отдаёт JSON.
 */
export async function loadSeoKeywords(
  deps: SeoKeywordsDeps,
  o: { nmId: number; cabinetId: string | null },
): Promise<{
  payload: SeoKeywordsPayload;
  debug: { snaps: number; yesterday: string; haveYesterday: boolean; measuredByNight: boolean; paused: boolean; plan: string; liveErr: { error: string } | null };
}> {
  const yesterday = seoYesterday(deps.now());
  let snaps: SeoSnapRow[] = [];
  let readError: string | null = null;
  try {
    snaps = selectClosedHistory(await deps.readHistory(seoHistoryWindow(yesterday)), yesterday);
  } catch (error) {
    readError = error instanceof Error ? error.message : "не удалось прочитать историю позиций";
  }
  const haveYesterday = snaps.some((snap) => snap.snapshot_date.slice(0, 10) === yesterday);

  // Живой запрос — последнее средство: ночной замер мог уже пройти по всем SKU и не найти у
  // товара запросов с позициями, а квота WB (3 запроса в минуту на продавца) едва хватает ему самому.
  const saved = await deps.readState().catch(() => null);
  const measuredByNight = seoMeasuredByNight(saved?.state, yesterday, o.nmId);
  const paused = isSeoUnavailablePause(saved, deps.now());
  const plan = seoLivePlan({ haveYesterday, measuredByNight, paused });

  let liveError: string | null = null;
  if (readError) {
    liveError = `История позиций не прочиталась: ${readError}`;
  } else if (plan === "paused") {
    liveError = seoUnavailableMessage(saved?.state.reason ?? "no_jam");
  } else if (plan === "live") {
    try {
      // Токен достаёт база: её сбой — тоже «WB не ответил», а не 500 без тела (экран показал бы разбор JSON).
      const token = await deps.getToken();
      if (!token) {
        liveError = "WB-токен не настроен";
      } else {
        const response = await deps.requestLive(token, yesterday);
        if (!response.ok) {
          liveError = seoFailureMessage(classifySearchTextsFailure(response.status, response.text));
        } else {
          let body: { data?: { items?: unknown } } | null = null;
          try { body = JSON.parse(response.text); } catch { liveError = "WB вернул не JSON"; }
          if (!liveError) {
            // Нет списка (в том числе тело null) — формат ответа изменился, как и на крон-пути; пустой список — ответ.
            const items = body?.data?.items;
            if (!Array.isArray(items)) {
              liveError = "WB 200: нет data.items — формат ответа изменился";
            } else {
              const live = seoLiveRows(items as SearchTextItem[], { nmId: o.nmId, day: yesterday, cabinetId: o.cabinetId, syncedAt: new Date(deps.now()).toISOString() });
              if ("error" in live) {
                liveError = live.error;
              } else {
                // Таблицы может не быть, запись может не пройти — экрану это не мешает.
                if (live.rows.length) await deps.writeRows(live.rows).catch(() => undefined);
                snaps = snaps.concat(live.rows.map((row) => ({
                  keyword: row.keyword,
                  frequency: row.frequency,
                  median_position: row.median_position,
                  snapshot_date: yesterday,
                  synced_at: row.synced_at,
                })));
              }
            }
          }
        }
      }
    } catch {
      liveError = "WB не ответил";
    }
  }

  return {
    payload: buildKeywordsPayload(snaps, { liveError }),
    debug: { snaps: snaps.length, yesterday, haveYesterday, measuredByNight, paused, plan, liveErr: liveError ? { error: liveError } : null },
  };
}

// ---------------------------------------------------------------- SKU кабинета

/**
 * SKU кабинета для замера — тот же набор, что видит экран SEO: карточки, товарный
 * контур и артикулы с живым трафиком в воронке. Выборка постраничная и с порядком:
 * PostgREST режет ответ на тысяче строк молча. `activeOnly` — режим «по одному»,
 * где запросов мало и тратить их на мёртвые карточки нельзя.
 */
export async function loadSeoNmIds(
  db: SupabaseClient,
  target: SyncTarget,
  activeOnly: boolean,
  nowMs = Date.now(),
): Promise<number[]> {
  const cabinetId = target.cabinetId;
  if (!cabinetId) return [];
  const since = shiftIsoDay(moscowToday(nowMs), -SEO_ACTIVE_DAYS);
  const byCabinet = (table: string, label: string) => loadAllSupabasePages<{ nm_id: number }>((from, to) => db
    .from(table)
    .select("nm_id")
    .eq("cabinet_id", cabinetId)
    .order("nm_id", { ascending: true })
    .range(from, to), { label, maxPages: 100 });
  const [cards, scope, active] = await Promise.all([
    activeOnly ? Promise.resolve([]) : byCabinet("wb_cards", "SEO-замер: карточки"),
    activeOnly ? Promise.resolve([]) : byCabinet("wb_cabinet_product_scope", "SEO-замер: товарный контур"),
    loadAllSupabasePages<{ nm_id: number }>((from, to) => db
      .from("wb_funnel_daily")
      .select("nm_id")
      .eq("cabinet_id", cabinetId)
      .gte("date", since)
      .or("open_card.gt.0,add_to_cart.gt.0")
      .order("nm_id", { ascending: true })
      .order("date", { ascending: true })
      .range(from, to), { label: "SEO-замер: SKU с трафиком", maxPages: 200, concurrency: 4 }),
  ]);
  const unique = new Set<number>();
  for (const row of [...cards, ...scope, ...active]) {
    const nm = Number(row.nm_id);
    if (Number.isInteger(nm) && nm > 0 && allowsNm(target.productScope, nm)) unique.add(nm);
  }
  return [...unique].sort((left, right) => left - right);
}

// ---------------------------------------------------------------- прогон группы

export interface SeoJobDeps {
  /** Бросает при ошибке базы: «состояния нет» (null) и «база не ответила» — разные вещи. */
  readState: (cabinetId: string) => Promise<WbSyncState<SeoPositionsState> | null>;
  writeState: (cabinetId: string, values: Partial<WbSyncState<SeoPositionsState>>) => Promise<string | null>;
  claim: (cabinetId: string, staleSeconds: number) => Promise<boolean>;
  /** Запись строк; возвращает текст ошибки или null. */
  upsertRows: (rows: SeoPositionRow[]) => Promise<string | null>;
  loadNmIds: (target: SyncTarget, activeOnly: boolean) => Promise<number[]>;
  fetchImpl?: FetchLike;
  /** Сигнал отмены запроса по таймауту; подменяется в тестах. */
  timeoutSignal?: (ms: number) => AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface SeoRunOptions {
  /** Абсолютное время (мс), после которого запросов начинать нельзя. */
  deadline: number;
  /** Запас до дедлайна на запись состояния и журнала. */
  reserveMs: number;
  /** Обойти паузу после 403 (ручная проба после подключения Джема). */
  force: boolean;
}

type SeoCabinetStatus = "caught_up" | "pending" | "unavailable" | "error" | "busy" | "budget";

export interface SeoGroupResult {
  cabinetId: string;
  cabinet: string;
  /** busy — аренду держит другой прогон; budget — до кабинета не дошли по времени. */
  status: SeoCabinetStatus;
  yesterday: string;
  yesterdayDone: boolean;
  day: string | null;
  mode: SeoMode;
  requests: number;
  rows: number;
  /** Артикулы, оставшиеся без замера в незакрытых днях (дыры). */
  skippedSku: number;
  /** Дыры именно вчерашнего дня: пока они есть, журнал partial. */
  yesterdayHoles?: number;
  /** Артикулы, от которых отказались в ЭТОМ прогоне после SEO_HOLE_MAX_NIGHTS ночей перепроверки. */
  abandonedSku?: number;
  /**
   * Ответ пакета принят обрезанным (limit общий на пакет, а артикулов с трафиком нет — по одному мерить
   * нечем): строки дня неполны, и журнал не может быть зелёным, даже если день закрыт.
   */
  truncatedAccepted?: boolean;
  /** Дни старше вчерашнего, отложенные как «WB не вернул ни одной строки»: журнал помнит о них, пока их не измерили. */
  emptyOlder?: number;
  totalSku?: number;
  processedSku?: number;
  reason?: SeoUnavailableReason;
  paused?: boolean;
  rateLimited?: boolean;
  message?: string | null;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function seoErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "WB не ответил вовремя (таймаут запроса)";
    return error.message;
  }
  return "запрос к WB не выполнен";
}

/** Итог группы, которая упала целиком или зависла: журнал не должен остаться без записи. */
export function seoGroupErrorResults(group: readonly SyncTarget[], message: string): SeoGroupResult[] {
  return group.map((target) => ({
    cabinetId: target.cabinetId ?? "",
    cabinet: target.name,
    status: "error" as const,
    yesterday: "",
    yesterdayDone: false,
    day: null,
    mode: "batch" as const,
    requests: 0,
    rows: 0,
    skippedSku: 0,
    message,
  }));
}

type UnitOutcome =
  | { kind: "no_time" }
  | { kind: "failure"; failure: SeoWbFailure }
  | { kind: "ok"; items: SearchTextItem[]; rows: SeoPositionRow[] };

/**
 * Один продавец = одна группа кабинетов с общим лимитом WB: кабинеты идут по
 * очереди, паузу между запросами считаем по общему таймеру. Состояние каждого
 * кабинета лежит в wb_sync_state и пишется после КАЖДОГО пакета, поэтому падение
 * функции не теряет сделанное, а следующий прогон продолжает с курсора.
 *
 * Порядок работы кабинета за прогон: вчерашний день → дыры (вчерашние, затем
 * старые) → догрузка истории назад по дню.
 */
export async function runSeoPositionsGroup(
  group: readonly SyncTarget[],
  deps: SeoJobDeps,
  opts: SeoRunOptions,
): Promise<SeoGroupResult[]> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? realSleep;
  const baseFetch: FetchLike = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutSignal = deps.timeoutSignal ?? ((ms: number) => AbortSignal.timeout(ms));
  // Зависший запрос без таймаута держал бы группу, а вместе с ней и запись журнала, до конца функции.
  const timedFetch: FetchLike = (input, init) =>
    baseFetch(input, { ...init, signal: timeoutSignal(seoRequestTimeoutMs(opts.deadline, now())) });
  const results: SeoGroupResult[] = [];
  // День → артикул → кабинет, который его УЖЕ успешно измерил в этом прогоне. Артикул записывается
  // сюда только после принятого ответа: кабинет с негодным токеном не «занимает» чужие артикулы, и
  // сосед с рабочим токеном их измерит.
  const claimedNm = new Map<string, Map<number, string>>();
  const claimNm = (day: string, cabinetId: string, nmIds: readonly number[]) => {
    let taken = claimedNm.get(day);
    if (!taken) {
      taken = new Map();
      claimedNm.set(day, taken);
    }
    for (const nm of nmIds) taken.set(nm, cabinetId);
  };
  let lastRequestAt: number | null = null;
  let limited = false;
  // Сколько ещё ждать до следующего запроса этого продавца.
  const requestWait = () => (lastRequestAt === null ? 0 : Math.max(0, lastRequestAt + SEO_REQUEST_SPACING_MS - now()));

  const targets = group
    .filter((target): target is SyncTarget & { cabinetId: string } => target.cabinetId !== null)
    // Одинаковый порядок во всех прогонах — иначе разбивка артикулов между кабинетами «плавала» бы.
    .sort((left, right) => left.cabinetId.localeCompare(right.cabinetId));

  // Состояния читаем сразу все: кабинет не должен тратить общую квоту продавца на догрузку истории,
  // пока вчерашний день ещё нужен кому-то из следующих в очереди — иначе у большого кабинета в первые
  // ночи догрузки (около трёх сотен запросов) соседи по продавцу остались бы без свежих данных.
  // Ошибка чтения — не «состояния нет»: кабинет в этом прогоне пропускается, иначе первая же запись
  // затёрла бы настоящий курсор, дни и паузу.
  const savedStates = new Map<string, WbSyncState<SeoPositionsState> | null>();
  const stateReadErrors = new Map<string, string>();
  for (const target of targets) {
    try {
      savedStates.set(target.cabinetId, await deps.readState(target.cabinetId));
    } catch (error) {
      stateReadErrors.set(target.cabinetId, error instanceof Error ? error.message : "ошибка чтения состояния");
    }
  }
  const yesterdayAtStart = seoYesterday(now());
  const lacksYesterday = (cabinetId: string): boolean => {
    if (stateReadErrors.has(cabinetId)) return false;
    const saved = savedStates.get(cabinetId) ?? null;
    if (!opts.force && isSeoUnavailablePause(saved, now())) return false;
    if (saved?.state.totalSku === 0) return false; // мерить нечего: вчерашний день у него не «недостаёт»
    if (saved?.state.emptyDays?.[yesterdayAtStart] !== undefined) return false; // день отложен, квоту не держим
    // Проход вчера закончен, остались только перепроверки дыр: они ограничены потолком запросов и тремя ночами,
    // а держать из-за них очередь значило бы оставить соседей по продавцу без вчерашнего дня на эти ночи.
    if (saved?.state.partial?.[yesterdayAtStart] !== undefined) return false;
    return !(saved?.state.doneDays ?? []).includes(yesterdayAtStart);
  };

  /** Результат кабинета, до которого в этом прогоне не дошла работа: берётся из сохранённого состояния, а не выдумывается. */
  const idleResult = (target: SyncTarget & { cabinetId: string }, status: SeoCabinetStatus): SeoGroupResult => {
    const saved = savedStates.get(target.cabinetId) ?? null;
    const state = saved?.state ?? {};
    const yesterday = seoYesterday(now());
    return {
      cabinetId: target.cabinetId,
      cabinet: target.name,
      status,
      yesterday,
      yesterdayDone: (state.doneDays ?? []).includes(yesterday) || state.totalSku === 0,
      day: null,
      mode: state.mode ?? "batch",
      requests: 0,
      rows: 0,
      skippedSku: seoUnresolvedHoleCount(state),
      yesterdayHoles: seoUnresolvedHoleCount(state, yesterday),
      emptyOlder: seoEmptyOlderCount(state, yesterday),
      totalSku: state.totalSku,
      processedSku: state.processedSku,
    };
  };

  const measure = async (
    target: SyncTarget & { cabinetId: string },
    yesterdayOnly: boolean,
  ): Promise<SeoGroupResult> => {
    const cabinetId = target.cabinetId;
    const stateReadError = stateReadErrors.get(cabinetId);
    if (stateReadError) return { ...idleResult(target, "error"), message: `состояние: ${stateReadError}` };
    const saved = savedStates.get(cabinetId) ?? null;
    const state: SeoPositionsState = { ...(saved?.state ?? {}) };
    const yesterday = seoYesterday(now());
    const result = idleResult(target, "pending");

    // 1. Пауза после 403: запрос к WB не делаем и состояние не трогаем.
    if (!opts.force && isSeoUnavailablePause(saved, now())) {
      return { ...result, status: "unavailable", paused: true, reason: state.reason, message: saved?.lastError ?? null };
    }
    // Вчерашний день у кабинета уже есть, а квота нужна следующим в очереди: историю он продолжит позже.
    if (yesterdayOnly && (result.yesterdayDone || state.emptyDays?.[yesterday] !== undefined)) {
      return { ...result, status: "pending", message: "догрузка истории после кабинетов, которым нужен вчерашний день" };
    }
    // Не хватает времени даже на один запрос (с учётом паузы после прошлого запроса продавца) —
    // аренду не берём и состояние не пишем.
    if (now() + requestWait() + opts.reserveMs >= opts.deadline) return { ...result, status: "budget" };
    // 2. Аренда: пока её держит другой прогон, второй на тот же кабинет не идёт.
    if (!(await deps.claim(cabinetId, SEO_LEASE_SECONDS))) return { ...result, status: "busy" };

    // С этого места кабинет «running»: любой выход обязан записать итоговый статус.
    const today = moscowToday(now());
    let attempts = saved?.attempts ?? 0;
    let status = "pending" as SeoCabinetStatus;
    let lastError = null as string | null;
    // Текст последнего сбоя, из-за которого пакет стал дырой или дыра не прошла: прогон при этом не «error»
    // (дальше он идёт), но диагноз в wb_sync_state.last_error должен остаться.
    let holeError: string | null = null;
    // Заметки о дырах и пустых днях короткие и сведены в одну строку на прогон: при системном сбое их десятки,
    // а sync_log хранит заметку целиком.
    let holesCreated = 0;
    const holeRetryFailedDays = new Set<string>();
    const notes: string[] = [];
    let doneDays = trimDoneDays(state.doneDays ?? [], now());
    state.doneDays = doneDays;
    state.holes = trimDayRecord(state.holes, now());
    state.partial = trimDayRecord(state.partial, now());
    state.emptyDays = trimDayRecord(state.emptyDays, now());
    state.dayRowsByDay = trimDayRecord(state.dayRowsByDay, now());
    // Дни, чьи дыры в этом прогоне уже перепроверяли: каждая дыра — один раз за прогон.
    // Отложенный пустой день за прогон проверяется не больше одного раза (probeEmptyDay).
    const holeTried = new Set<string>();
    const remaining = () => seoDaysToMeasure(doneDays, now());
    // single держится только внутри дня: на следующую ночь проверяем лимит заново, иначе
    // случайное совпадение «ровно 30 строк» перевело бы кабинет в дорогой режим навсегда.
    // batch-confirmed — наблюдение «лимит на артикул» — не устаревает.
    const sameDay = state.day !== undefined && state.day === remaining()[0];
    let mode = (state.mode === "batch-confirmed" || (sameDay && state.mode === "single") ? state.mode : "batch") as SeoMode;
    state.mode = mode;

    const persist = async (writeStatus: string): Promise<string | null> => {
      state.lastRunAt = new Date(now()).toISOString();
      // Пустые записи по дням в состоянии не храним.
      for (const key of ["holes", "partial", "emptyDays", "dayRowsByDay"] as const) {
        if (state[key] && Object.keys(state[key]).length === 0) delete state[key];
      }
      return deps.writeState(cabinetId, {
        cursor: state.day ? `${state.day}:${state.afterNm ?? 0}` : null,
        status: writeStatus,
        attempts,
        lastError,
        state: { ...state },
      });
    };
    /** false — состояние не записалось, прогон надо остановить. */
    const saveProgress = async (): Promise<boolean> => {
      const stateError = await persist("running");
      if (!stateError) return true;
      status = "error";
      lastError = `состояние: ${stateError}`;
      return false;
    };

    /** Лимит и пауза: общие для основного прохода и перепроверки дыр. */
    const stopOnFailure = (failure: { kind: "rate_limit" } | Extract<SeoWbFailure, { kind: "unavailable" }>) => {
      if (failure.kind === "rate_limit") {
        // Лимит общий на продавца: курсор не двигаем, остальные кабинеты группы не трогаем.
        state.rateLimitedAt = new Date(now()).toISOString();
        status = "pending";
        limited = true;
        result.rateLimited = true;
        return;
      }
      // Не ошибка прогона: кабинет без Джема или с неподходящим токеном ждёт следующей пробы.
      state.unavailableAt = new Date(now()).toISOString();
      state.reason = failure.reason;
      status = "unavailable";
      result.reason = failure.reason;
      lastError = failure.message;
      attempts = 0;
    };

    // Сколько запросов прогона получили отказ запросом (400 или другой 4xx, bad_request). Равенство с result.requests
    // значит «ни одного принятого ответа и ни одного другого сбоя» — отдельные счётчики успехов и прочих отказов не нужны.
    let rejected = 0;
    let lastRejection = "";
    // Диапазоны nmId пакетов, отвергнутых 400 в этом прогоне. Независимый отказ — диапазон, внутри которого нет
    // другого отвергнутого: деление дыры пополам и тот же ядовитый артикул в другой день его не наращивают.
    const rejectedRanges: Array<[number, number]> = [];
    const independentRejections = () => new Set(
      rejectedRanges
        .filter(([low, high]) => !rejectedRanges.some(([from, to]) => (from !== low || to !== high) && from >= low && to <= high))
        .map(([low, high]) => `${low}:${high}`),
    ).size;

    const requestUnit = async (day: string, unit: number[]): Promise<UnitOutcome> => {
      // Системный 400: WB не принимает сам запрос. Дальше квоту продавца не жжём (иначе все 8 прогонов ночи
      // шли бы по кругу), а прогон кабинета заканчивается громким error. Бросаем ДО следующего запроса: уже
      // получившие 400 пакеты успели стать дырами. Исключение ловит общий catch ниже.
      if (rejected === result.requests && independentRejections() >= SEO_SYSTEMATIC_400_REQUESTS) {
        throw new Error(
          `WB отклонил все запросы прогона (${result.requests} из ${result.requests}, ни один не принят; последний — ${lastRejection}): возможно, он не принимает однодневный период start = end или схему запроса — замер остановлен`,
        );
      }
      // Пауза до 20,5 с после прошлого запроса этого продавца; не хватает времени — стоп до следующего прогона.
      const wait = requestWait();
      if (now() + wait + opts.reserveMs >= opts.deadline) return { kind: "no_time" };
      if (wait > 0) await sleep(wait);

      let items: SearchTextItem[] = [];
      let failure: SeoWbFailure | null = null;
      try {
        const response = await fetchWbFunnelHistory({
          url: SEARCH_TEXTS_URL,
          token: target.statsToken,
          body: searchTextsDayBody(unit, day),
          deadline: opts.deadline,
          reserveMs: opts.reserveMs,
          fallbackWaitMs: SEO_RATE_LIMIT_FALLBACK_MS,
          fetchImpl: timedFetch,
          sleep,
          now,
        });
        const text = await response.text();
        if (!response.ok) {
          failure = classifySearchTextsFailure(response.status, text);
        } else {
          const parsed = JSON.parse(text) as { data?: { items?: unknown } };
          if (!Array.isArray(parsed?.data?.items)) {
            failure = { kind: "server", message: "WB 200: в ответе нет data.items — формат ответа изменился" };
          } else {
            items = parsed.data.items as SearchTextItem[];
          }
        }
      } catch (error) {
        failure = { kind: "server", message: seoErrorMessage(error) };
      }
      lastRequestAt = now();
      result.requests += 1;
      if (failure?.kind === "bad_request") {
        rejected += 1;
        lastRejection = failure.message;
        rejectedRanges.push([unit[0], unit[unit.length - 1]]);
      }
      if (failure) return { kind: "failure", failure };

      const rows = seoRowsFromItems(items, {
        day,
        cabinetId,
        requested: new Set(unit),
        allowNm: (nm) => allowsNm(target.productScope, nm),
        syncedAt: new Date(now()).toISOString(),
      });
      if (items.length > 0 && rows.length === 0) {
        // Ответ есть, а разобрать из него нечего: нельзя молча считать пакет «пустым днём».
        return { kind: "failure", failure: { kind: "server", message: `WB 200: ${items.length} записей, ни одной не разобрано — формат ответа изменился` } };
      }
      return { kind: "ok", items, rows };
    };

    const closeDay = (day: string, keepHoles = false) => {
      doneDays = trimDoneDays([...doneDays, day], now());
      state.doneDays = doneDays;
      if (state.emptyDays) delete state.emptyDays[day];
      if (state.partial) delete state.partial[day];
      if (state.dayRowsByDay) delete state.dayRowsByDay[day];
      // От дыр, от которых отказались, остаётся запись: ленивый роут может спросить WB про такой артикул сам.
      if (state.holes && !keepHoles) delete state.holes[day];
      if (day === yesterday) result.yesterdayDone = true;
    };
    const clearCursor = () => {
      delete state.day;
      state.afterNm = 0;
      state.processedSku = 0;
      state.wrapped = false;
      delete state.dayStartNm;
    };
    const startDay = (day: string) => {
      // Свежий проход дня сам найдёт свои дыры. Дыры ДРУГОГО, недоделанного дня не трогаем: они видны
      // журналу и ленивому роуту, а свой проход этот день начнёт с чистого листа.
      if (state.holes) delete state.holes[day];
      if (state.emptyDays) delete state.emptyDays[day];
      (state.dayRowsByDay ??= {})[day] = 0;
      state.day = day;
      state.afterNm = 0;
      state.processedSku = 0;
      state.wrapped = false;
      delete state.dayStartNm;
      attempts = 0;
    };
    const addHole = (day: string, unit: readonly number[], tries: number) => {
      const holes = (state.holes ??= {});
      (holes[day] ??= []).push({ from: unit[0], to: unit[unit.length - 1], count: unit.length, tries });
    };
    /** Принятые строки: счётчик дня общий для прохода и перепроверок — по нему охранник пустого дня. */
    const recordRows = (day: string, count: number) => {
      result.rows += count;
      state.lastRowsAt = today;
      const byDay = (state.dayRowsByDay ??= {});
      byDay[day] = (byDay[day] ?? 0) + count;
    };

    try {
      let nmAll = await deps.loadNmIds(target, mode === "single");
      state.totalSku = nmAll.length;
      let activeCache: number[] | null = mode === "single" ? nmAll : null;
      const activeList = async (): Promise<number[]> => (activeCache ??= await deps.loadNmIds(target, true));
      // Артикулы, которые за этот день уже измерил ДРУГОЙ кабинет продавца, не мерим второй раз.
      const usableFor = (day: string, list: readonly number[]): number[] => {
        const taken = claimedNm.get(day);
        return taken ? list.filter((nm) => (taken.get(nm) ?? cabinetId) === cabinetId) : [...list];
      };
      // День без единой строки при живых артикулах — симптом, а не результат. Воронка не назвала живых
      // (отстала, кабинет новый)? Пока кабинет недавно писал строки, пустой день всё равно подозрителен.
      const dayLooksEmpty = async (day: string): Promise<boolean> => {
        if ((state.dayRowsByDay?.[day] ?? 0) > 0) return false;
        if (usableFor(day, await activeList()).length > 0) return true;
        return state.lastRowsAt !== undefined && state.lastRowsAt >= shiftIsoDay(today, -SEO_EMPTY_GUARD_DAYS);
      };
      const emptyNoted = new Set<string>();
      const emptyDayNote = (day: string) =>
        `${day}: WB не вернул запросов за весь день — день не закрыт, его проверяет один запрос за прогон; вручную: ?cabinet=${cabinetId}&remeasure=${day}`;
      /**
       * Конец дня: пакетов и дыр не осталось (или от оставшихся отказались: keepHoles). Один охранник на все три
       * пути закрытия — конец прохода, перепроверка дыр и отказ (иначе пустой день, прошедший через дыру или через
       * отказ, закрывался молча). true — день закрыт.
       */
      const settleDay = async (day: string, keepHoles = false): Promise<boolean> => {
        if (!(await dayLooksEmpty(day))) {
          closeDay(day, keepHoles);
          return true;
        }
        (state.emptyDays ??= {})[day] = new Date(now()).toISOString();
        if (state.partial) delete state.partial[day];
        if (state.dayRowsByDay) delete state.dayRowsByDay[day];
        // Старые отложенные дни журнал считает числом (emptyOlder), а не перечисляет: при системной причине их тридцать.
        if (day === yesterday) {
          emptyNoted.add(day);
          notes.push(emptyDayNote(day));
        }
        return false;
      };
      const noteTruncatedAccepted = () => {
        if (result.truncatedAccepted) return;
        // Флаг уходит в итог группы: заметка одна, но без флага она при статусе ok не дошла бы до sync_log.
        result.truncatedAccepted = true;
        notes.push(`ответ пакета ровно ${SEO_TEXT_LIMIT} строк, а артикулов с трафиком нет — замер по одному невозможен, ответ принят как есть`);
      };

      let olderHoleBudget = SEO_HOLE_REQUESTS_OLDER;
      /** Перепроверка дыр дня. false — прогон надо остановить (нет времени, лимит, пауза, сбой записи). */
      const processHoles = async (day: string): Promise<boolean> => {
        holeTried.add(day);
        const nights = state.partial?.[day] ?? [];
        // Отказываемся, только когда спрашивать больше нечего: каждая оставшаяся дыра — одиночный артикул, который
        // уже спросили хоть раз. Иначе от здоровых соседей плохого артикула (нетронутые половины деления, пакет,
        // до которого не дошёл потолок запросов) отказ отрезал бы строки, которые обычная перепроверка получила бы.
        const unsettled = (state.holes?.[day] ?? []).some((hole) => hole.count > 1 || !hole.triedAt);
        if (nights.length >= SEO_HOLE_MAX_NIGHTS && !nights.includes(today) && !unsettled) {
          const left = seoUnresolvedHoleCount(state, day);
          // Тот же охранник пустого дня: день без единой строки при живых артикулах не закрывается и «отказом».
          // Не закрыт — значит отказа не было: ни заметки, ни abandonedSku, день ждёт пробы (emptyDays).
          if (await settleDay(day, true)) {
            result.abandonedSku = (result.abandonedSku ?? 0) + left;
            notes.push(`${day}: отказались от ${left} арт. после ${nights.length} ночей перепроверки`);
          }
          return saveProgress();
        }
        const isYesterday = day === yesterday;
        // Старые дни делят один потолок на всех: нет запросов — этот день ждёт следующего прогона, а ночи не набегают.
        if (!isYesterday && olderHoleBudget <= 0) return true;
        let requests = 0;
        const hasBudget = () => (isYesterday ? requests < SEO_HOLE_REQUESTS_YESTERDAY : olderHoleBudget > 0);
        // Давно не пробованные — первыми: при потолке запросов хвост списка иначе не получал бы очереди никогда.
        let list = [...(state.holes?.[day] ?? [])].sort(
          (left, right) => (left.triedAt ?? "").localeCompare(right.triedAt ?? "") || left.from - right.from,
        );
        const tried = new Set<string>();
        const key = (hole: SeoHole) => `${hole.from}:${hole.to}`;
        const keep = () => {
          if (list.length > 0) (state.holes ??= {})[day] = list;
          else if (state.holes) delete state.holes[day];
        };
        const replace = (hole: SeoHole, parts: SeoHole[]) => {
          list = list.flatMap((entry) => (entry === hole ? parts : [entry]));
        };
        const fresh = (part: readonly number[]): SeoHole => ({ from: part[0], to: part[part.length - 1], count: part.length, tries: 0 });
        const halves = (unit: readonly number[]) => {
          const middle = Math.ceil(unit.length / 2);
          return [unit.slice(0, middle), unit.slice(middle)].map(fresh);
        };
        // Ночь засчитывается, как только дыру по-настоящему спросили: сколько бы ни ушло времени и
        // чем бы ни кончилась перепроверка (потолок запросов, лимит, конец бюджета), дыра станет на ночь старше.
        const markNight = () => {
          const recorded = state.partial?.[day] ?? [];
          if (!recorded.includes(today)) (state.partial ??= {})[day] = [...recorded, today];
        };
        let failureNote: string | null = null;
        while (hasBudget()) {
          const hole = list.find((entry) => !tried.has(key(entry)));
          if (!hole) break;
          const unit = usableFor(day, nmAll.filter((nm) => nm >= hole.from && nm <= hole.to));
          if (unit.length === 0) {
            // Артикулов диапазона в списке больше нет (или их измерил сосед): дыра закрыта.
            list = list.filter((entry) => entry !== hole);
            continue;
          }
          if (unit.length > 1 && (hole.tries >= SEO_HOLE_SPLIT_AFTER || unit.length > SEO_NM_BATCH)) {
            // Дыра не проходит (400 — сразу, остальное — со второй неудачи): ищем артикул-виновник, деля пополам.
            // Так же делим диапазон, в который с тех пор добавились карточки: больше 50 артикулов WB не примет.
            replace(hole, halves(unit));
            continue;
          }
          const outcome = await requestUnit(day, unit);
          if (outcome.kind === "no_time") {
            keep();
            status = "pending";
            return false;
          }
          requests += 1;
          if (!isYesterday) olderHoleBudget -= 1;
          if (outcome.kind === "failure") {
            const failure = outcome.failure;
            if (failure.kind === "rate_limit" || failure.kind === "unavailable") {
              stopOnFailure(failure);
              keep();
              return false;
            }
            markNight();
            failureNote = failure.message;
            holeError = failure.message;
            hole.tries += 1;
            hole.triedAt = new Date(now()).toISOString();
            tried.add(key(hole));
            if (unit.length > 1 && (failure.kind === "bad_request" || hole.tries >= SEO_HOLE_SPLIT_AFTER)) replace(hole, halves(unit));
            continue;
          }
          markNight();
          delete state.unavailableAt;
          delete state.reason;
          if (mode !== "batch-confirmed" && looksTruncated(unit.length, outcome.items.length, SEO_TEXT_LIMIT)) {
            // Ответ ровно в limit строк на пакет: limit общий, ответ обрезан. Как основной проход уходит в single,
            // так дыра рассыпается на одиночные артикулы (только живые: мёртвые карточки запросов не тратят).
            const active = new Set(await activeList());
            const live = unit.filter((nm) => active.has(nm));
            // Живых артикулов среди пакета нет (воронка и WB расходятся): рассыпать нечего, дыра не должна
            // исчезнуть вместе с уже полученными строками — берём ответ как есть и говорим об этом.
            if (live.length > 0) {
              replace(hole, live.map((nm) => fresh([nm])));
              continue;
            }
            noteTruncatedAccepted();
          }
          if (outcome.rows.length) {
            const writeError = await deps.upsertRows(outcome.rows);
            if (writeError) {
              status = "error";
              attempts += 1;
              lastError = `запись позиций: ${writeError}`;
              keep();
              return false;
            }
            recordRows(day, outcome.rows.length);
          }
          claimNm(day, cabinetId, unit);
          list = list.filter((entry) => entry !== hole);
          keep();
          if (!(await saveProgress())) return false;
        }
        if (failureNote && list.length > 0) holeRetryFailedDays.add(day);
        keep();
        // Перепроверка закончилась (или упёрлась в потолок запросов): без дыр день заканчивается, как после прохода.
        if (list.length === 0) await settleDay(day);
        return saveProgress();
      };

      /**
       * Отложенный пустой день: ОДИН запрос по первым пятидесяти живым артикулам. Строки пришли — WB снова
       * отдаёт данные: все отложенные дни возвращаются в работу и измеряются заново. Пусто или проба не
       * удалась — день проверен сейчас, следующая проверка не раньше SEO_EMPTY_PROBE_EVERY_MS.
       * false — прогон надо остановить.
       */
      const probeEmptyDay = async (day: string): Promise<boolean> => {
        const pool = await activeList();
        const unit = usableFor(day, pool.length > 0 ? pool : nmAll).slice(0, SEO_NM_BATCH);
        if (unit.length > 0) {
          const outcome = await requestUnit(day, unit);
          if (outcome.kind === "no_time") {
            status = "pending";
            return false;
          }
          if (outcome.kind === "failure" && (outcome.failure.kind === "rate_limit" || outcome.failure.kind === "unavailable")) {
            stopOnFailure(outcome.failure);
            return false;
          }
          if (outcome.kind === "ok") {
            delete state.unavailableAt;
            delete state.reason;
            if (outcome.rows.length > 0) {
              const returned = Object.keys(state.emptyDays ?? {}).length;
              delete state.emptyDays;
              notes.push(`${day}: WB снова отдаёт запросы — ${returned} дн. возвращены в работу и измеряются заново`);
              return saveProgress();
            }
          }
        }
        (state.emptyDays ??= {})[day] = new Date(now()).toISOString();
        return saveProgress();
      };

      let probed = false;
      /** Что делать дальше: вчера → дыры вчера → проба пустого дня → дыры старых дней → догрузка. */
      const pickWork = (): { kind: "pass" | "holes" | "probe"; day: string } | null => {
        const left = remaining();
        const isPartial = (day: string) => state.partial?.[day] !== undefined;
        const isParked = (day: string) => state.emptyDays?.[day] !== undefined;
        // Отложенный пустой день проходом не повторяем (вся квота продавца впустую при системной проблеме):
        // его возвращает в работу проба.
        const passable = (day: string) => !isPartial(day) && !isParked(day);
        const retryable = (day: string) => isPartial(day) && !holeTried.has(day);
        if (left.includes(yesterday)) {
          if (passable(yesterday)) return { kind: "pass", day: yesterday };
          if (retryable(yesterday)) return { kind: "holes", day: yesterday };
        }
        // Проба — не больше одной за прогон: свежий из отложенных дней, чью последнюю проверку уже не назвать недавней.
        if (!probed && !yesterdayOnly) {
          // Нечитаемая метка времени — проверять пора (отрицание сравнения: NaN не должен делать день вечно «свежим»).
          const due = (day: string) => !(now() - Date.parse(state.emptyDays?.[day] ?? "") < SEO_EMPTY_PROBE_EVERY_MS);
          const parked = left.find((day) => isParked(day) && due(day));
          if (parked) return { kind: "probe", day: parked };
        }
        // single — догрузки по замыслу нет; yesterdayOnly — история дождётся своей очереди.
        if (mode === "single" || yesterdayOnly) return null;
        // Старые дни делят потолок запросов по очереди: первым идёт день, чью перепроверку делали давнее всех
        // (при равенстве — самый старый). Иначе свежие дни съедали бы потолок, и самые старые не доходили до отказа.
        const lastNight = (day: string) => state.partial?.[day]?.at(-1) ?? "";
        const older = [...left].reverse().filter(retryable).sort((a, b) => lastNight(a).localeCompare(lastNight(b)))[0];
        if (older) return { kind: "holes", day: older };
        const next = left.find(passable);
        return next ? { kind: "pass", day: next } : null;
      };

      if (nmAll.length === 0) {
        // Нет SKU — мерить нечего. Дни в doneDays не кладём: когда карточки появятся,
        // историю надо будет догрузить, а не считать закрытой.
        status = "caught_up";
        result.yesterdayDone = true;
      } else {
        for (;;) {
          const work = pickWork();
          if (!work) {
            // Вчерашний день отложен в одном из прошлых прогонов этой ночи: журналу нужна та же причина.
            if (state.emptyDays?.[yesterday] !== undefined && !emptyNoted.has(yesterday)) notes.push(emptyDayNote(yesterday));
            const left = remaining();
            status = left.length === 0 || (mode === "single" && !left.includes(yesterday)) ? "caught_up" : "pending";
            break;
          }
          if (work.kind === "holes") {
            if (!(await processHoles(work.day))) break;
            continue;
          }
          if (work.kind === "probe") {
            probed = true;
            if (!(await probeEmptyDay(work.day))) break;
            continue;
          }

          const day = work.day;
          if (state.day !== day) startDay(day);
          const usable = usableFor(day, nmAll);
          let unit: number[];
          if (mode === "single") {
            const next = nextSeoSingle(usable, state.afterNm ?? 0, state.dayStartNm ?? 0, state.wrapped === true);
            state.afterNm = next.afterNm;
            state.wrapped = next.wrapped;
            unit = next.batch;
          } else {
            unit = nextSeoBatch(usable, state.afterNm ?? 0, SEO_NM_BATCH);
          }

          if (unit.length === 0) {
            // Проход дня закончен.
            if ((state.holes?.[day] ?? []).length > 0) {
              // Дыры: день остаётся открытым, их перепроверим раньше догрузки истории.
              (state.partial ??= {})[day] = [];
              clearCursor();
            } else if (await settleDay(day)) {
              state.processedSku = nmAll.length;
            } else {
              clearCursor();
            }
            if (!(await saveProgress())) break;
            continue;
          }

          const outcome = await requestUnit(day, unit);
          if (outcome.kind === "no_time") {
            status = "pending";
            break;
          }
          if (outcome.kind === "failure") {
            const failure = outcome.failure;
            if (failure.kind === "rate_limit" || failure.kind === "unavailable") {
              stopOnFailure(failure);
              break;
            }
            // 400 детерминирован: тот же пакет через полчаса ответит так же, а три прогона подряд — полтора часа ночи
            // впустую (при нескольких плохих пакетах день за ночь не проходится вовсе). Остальное повторяем до трёх раз.
            if (failure.kind !== "bad_request" && attempts + 1 < SEO_BATCH_MAX_ATTEMPTS) {
              status = "error";
              attempts += 1;
              lastError = failure.message;
              break;
            }
            // Курсор идёт дальше, чтобы не застрять навсегда, но пакет не пропадает: он становится дырой дня.
            // 400-дыра рождается уже «не проходившей» (tries) и делится пополам сразу, без нового запроса.
            addHole(day, unit, failure.kind === "bad_request" ? SEO_HOLE_SPLIT_AFTER : 0);
            holeError = failure.message;
            holesCreated += 1;
            state.afterNm = unit[unit.length - 1];
            if (mode === "single") state.rotation = unit[0];
            attempts = 0;
            if (!(await saveProgress())) break;
            continue;
          }

          // Успешный ответ: кабинет доступен, прежняя пауза неактуальна.
          delete state.unavailableAt;
          delete state.reason;
          const { items, rows } = outcome;

          if (mode !== "batch-confirmed" && looksTruncated(unit.length, items.length, SEO_TEXT_LIMIT)) {
            const active = await activeList();
            if (active.length > 0) {
              // limit общий на пакет: ответ обрезан. Курсор не двигаем, пакет перемеряем по одному артикулу.
              // Ночь начинается с курсора прошлой ночи и идёт по кругу, а не с нуля.
              mode = "single";
              state.mode = mode;
              nmAll = active;
              state.totalSku = nmAll.length;
              state.processedSku = 0;
              const start = state.rotation ?? state.afterNm ?? 0;
              state.dayStartNm = start;
              state.afterNm = start;
              state.wrapped = false;
              if (!(await saveProgress())) break;
              continue;
            }
            // Живых артикулов нет — по одному мерить нечего, и закрывать день пустым нельзя:
            // берём ответ пакета как есть.
            noteTruncatedAccepted();
          }
          if (items.length > SEO_TEXT_LIMIT) {
            // Больше limit строк на пакет — значит limit считается на каждый артикул.
            mode = "batch-confirmed";
            state.mode = mode;
          }

          if (rows.length) {
            const writeError = await deps.upsertRows(rows);
            if (writeError) {
              status = "error";
              attempts += 1;
              lastError = `запись позиций: ${writeError}`;
              break;
            }
            recordRows(day, rows.length);
          }

          // Курсор двигаем только после записи.
          claimNm(day, cabinetId, unit);
          state.afterNm = unit[unit.length - 1];
          if (mode === "single") state.rotation = unit[0];
          state.processedSku = (state.processedSku ?? 0) + unit.length;
          attempts = 0;
          lastError = null;
          if (!(await saveProgress())) break;
        }
      }
    } catch (error) {
      status = "error";
      attempts += 1;
      lastError = error instanceof Error ? error.message : "неизвестная ошибка";
    }

    if (status !== "error" && status !== "unavailable") lastError = holeError;
    if (holesCreated > 0) notes.push(`пакетов превращено в дыры дня: ${holesCreated} (будут перепроверены)`);
    if (holeRetryFailedDays.size > 0) notes.push(`перепроверка дыр не прошла у дней: ${holeRetryFailedDays.size}`);
    result.message = [lastError, ...notes].filter(Boolean).join("; ") || null;
    // Итоговый статус пишем всегда: «running» на кабинете не остаётся.
    const finalError = await persist(status);
    if (finalError && status !== "error") {
      status = "error";
      // Заметки (отказ, дыры) и диагноз прогона остаются: запись состояния упала, а журнал ещё может дойти.
      result.message = [`состояние: ${finalError}`, lastError, ...notes].filter(Boolean).join("; ");
    }
    result.status = status;
    result.mode = mode;
    result.day = state.day ?? null;
    result.skippedSku = seoUnresolvedHoleCount(state);
    result.yesterdayHoles = seoUnresolvedHoleCount(state, yesterday);
    result.emptyOlder = seoEmptyOlderCount(state, yesterday);
    result.totalSku = state.totalSku;
    result.processedSku = state.processedSku;
    result.yesterdayDone = doneDays.includes(yesterday) || state.totalSku === 0;
    return result;
  };

  for (const [index, target] of targets.entries()) {
    if (limited) {
      // Лимит общий на продавца: оставшимся кабинетам запрос не достался, но их настоящее
      // состояние (вчера закрыт, пауза после 403) от этого не меняется.
      const saved = savedStates.get(target.cabinetId) ?? null;
      const stateReadError = stateReadErrors.get(target.cabinetId);
      if (stateReadError) {
        results.push({ ...idleResult(target, "error"), message: `состояние: ${stateReadError}` });
      } else if (!opts.force && isSeoUnavailablePause(saved, now())) {
        results.push({ ...idleResult(target, "unavailable"), paused: true, reason: saved?.state.reason, message: saved?.lastError ?? null });
      } else {
        results.push({ ...idleResult(target, "pending"), rateLimited: true, message: "лимит WB у этого продавца" });
      }
      continue;
    }
    const yesterdayOnly = targets.slice(index + 1).some((next) => lacksYesterday(next.cabinetId));
    results.push(await measure(target, yesterdayOnly));
  }
  return results;
}

// ---------------------------------------------------------------- итог для sync_log

export function summarizeSeoRun(results: readonly SeoGroupResult[]): {
  status: "ok" | "partial" | "error";
  rows: number;
  requests: number;
  /** Сводка по всем кабинетам. */
  note: string;
  /** Что писать в sync_log: сводка при partial/error; при ok — только кабинеты, о которых журнал обязан сказать. */
  logNote: string | null;
} {
  const rows = results.reduce((sum, result) => sum + result.rows, 0);
  const requests = results.reduce((sum, result) => sum + result.requests, 0);
  const failed = results.some((result) => result.status === "error");
  // Недоступность по причине, отличной от «нет Джема» (токен отозван, нет категории «Аналитика»,
  // базовый токен, 401), — поломка, а не штатное состояние: зелёный журнал при отвергнутом токене
  // никого не заставил бы смотреть. Кабинет без подписки — спокойное состояние.
  const brokenAccess = results.filter((result) => result.status === "unavailable" && result.reason !== undefined && result.reason !== "no_jam");
  const allBroken = results.length > 0 && brokenAccess.length === results.length;
  // partial — у доступного кабинета вчерашний день ещё не закрыт или закрыт с дырами/отказом, либо ответ принят обрезанным.
  // Старые дни (недоделанная догрузка, их дыры, отложенные пустые дни) на статус не влияют, чтобы журнал не горел
  // неделями, но всегда есть в заметке: ok с такой заметкой — не «чисто», а «вчера в порядке, история в работе».
  const incomplete = results.some((result) => result.status !== "unavailable"
    && (!result.yesterdayDone || (result.yesterdayHoles ?? 0) > 0 || (result.abandonedSku ?? 0) > 0 || result.truncatedAccepted === true));
  const status = failed || allBroken ? "error" : incomplete || brokenAccess.length > 0 ? "partial" : "ok";
  const describe = (result: SeoGroupResult) => {
    const tail = result.message ? ` — ${result.message}` : "";
    const reason = result.reason ? ` (${result.reason})` : "";
    const skipped = result.skippedSku ? `, пропущено ${result.skippedSku} арт.` : "";
    const abandoned = result.abandonedSku ? `, отказ от ${result.abandonedSku} арт.` : "";
    const parked = result.emptyOlder ? `, дней без данных WB: ${result.emptyOlder}` : "";
    const coverage = result.mode === "single" && result.totalSku
      ? `, режим по одному: охват ${result.processedSku ?? 0}/${result.totalSku} арт.`
      : "";
    return `${result.cabinet}: ${result.status}${reason}, ${result.rows} строк, ${result.requests} запр.${skipped}${abandoned}${parked}${coverage}${tail}`;
  };
  const note = results.map(describe).join("; ");
  const notable = results.filter((result) => result.status === "unavailable" || result.skippedSku > 0
    || (result.abandonedSku ?? 0) > 0 || (result.emptyOlder ?? 0) > 0);
  const logNote = status !== "ok" ? note : notable.length > 0 ? notable.map(describe).join("; ") : null;
  return { status, rows, requests, note, logNote };
}
