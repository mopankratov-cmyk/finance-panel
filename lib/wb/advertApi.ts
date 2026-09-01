// Клиент WB «Маркетинг и продвижение» — единственное место, где панель ПИШЕТ в рекламу.
//
// Почему отдельный файл, а не общий wbFetch: тот заточен под чтение и по
// умолчанию кладёт ответ в Data Cache Next. Для записи кэш недопустим даже
// теоретически, а ошибку WB нужно отдавать целиком: на пишущих методах
// Продвижения WB возвращает структурный 400 вида
// {title, detail, origin, request_id, status}, и именно `detail` объясняет, что
// не так («invalid payment_type value»). Обрезанный текст ошибки здесь стоит
// разбора полётов над деньгами, поэтому разбираем тело, а не режем строкой.
//
// Тела запросов и лимиты сверены с официальной OpenAPI-спекой Продвижения
// (08-promotion.yaml, автосинк из WB) на 01.09.2026, а не с постами в блогах.

import { decodeWbToken } from "@/lib/wb/token";

const PROD_HOST = "https://advert-api.wildberries.ru";
const SANDBOX_HOST = "https://advert-api-sandbox.wildberries.ru";
const TIMEOUT_MS = 30_000;

/**
 * Куда слать запрос. У WB есть песочница, и токен сам говорит, что он от неё:
 * в payload JWT стоит `t: true`. Слать песочный токен в боевой хост — гарантированный
 * 401 с непонятным для человека текстом, а боевой в песочницу — тихо не то место.
 * Выбор хоста по токену снимает целый класс «почему не работает».
 */
export function advertHost(token: string): string {
  return decodeWbToken(token).isTest ? SANDBOX_HOST : PROD_HOST;
}

export interface AdvertApiOk<T> {
  ok: true;
  status: number;
  data: T;
}

export interface AdvertApiFail {
  ok: false;
  status: number;
  /** Человеческая причина — уже разобранная из тела WB. */
  message: string;
  /** Сырое тело: уходит в журнал операций как есть, для разбора спорных случаев. */
  raw: unknown;
  /** true — WB отказал из-за прав токена (выпущен «только на чтение» или без Продвижения). */
  forbidden: boolean;
  /** true — упёрлись в лимит запросов WB, действие можно повторить позже. */
  rateLimited: boolean;
}

export type AdvertApiResult<T> = AdvertApiOk<T> | AdvertApiFail;

interface WbErrorBody {
  title?: string;
  detail?: string;
  error?: string;
  errorText?: string;
  additionalErrors?: unknown;
  request_id?: string;
}

/**
 * Из ответа WB — фраза, которую не стыдно показать человеку у кнопки.
 *
 * Отдельно вытащен 403 на пишущем методе: у WB это почти всегда не «нет прав на
 * кампанию», а токен, выпущенный с галочкой «Только на чтение». Пока это не
 * названо прямо, человек ищет проблему в панели, хотя чинится она за минуту
 * перевыпуском ключа.
 */
function describe(status: number, body: unknown, isWrite: boolean): string {
  const parsed = (body && typeof body === "object" ? body : {}) as WbErrorBody;
  const detail = [parsed.detail, parsed.title, parsed.errorText, parsed.error]
    .find((value) => typeof value === "string" && value.trim().length > 0);

  if (status === 401) return "WB не принял токен: он истёк или выпущен без категории «Продвижение».";
  if (status === 403 && isWrite) {
    return "WB отказал в записи. Обычно это токен «Только на чтение» — перевыпустите ключ Продвижения без этой галочки.";
  }
  if (status === 403) return "WB отказал в доступе к этой кампании.";
  if (status === 429) return "WB ограничил частоту запросов. Повторите через минуту.";
  if (typeof body === "string" && body.trim()) return `WB ${status}: ${body.trim().slice(0, 300)}`;
  if (detail) return `WB ${status}: ${detail.slice(0, 300)}`;
  return `WB ${status}: запрос отклонён без объяснения.`;
}

interface CallInput {
  token: string;
  path: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

/**
 * Один вызов Продвижения. Без ретраев: повтор пишущего метода — это повтор
 * действия с деньгами, и решать про него должен человек, а не таймер. Читающие
 * обёртки живут в этом же файле и тоже без ретраев, чтобы не тратить лимит WB.
 */
export async function advertCall<T>(input: CallInput): Promise<AdvertApiResult<T>> {
  const isWrite = input.method !== "GET";
  const url = new URL(input.path, advertHost(input.token));
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: input.method,
      headers: {
        Authorization: input.token,
        ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await res.text();
    let parsed: unknown = text;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: describe(res.status, parsed, isWrite),
        raw: parsed,
        forbidden: res.status === 401 || res.status === 403,
        rateLimited: res.status === 429,
      };
    }
    return { ok: true, status: res.status, data: parsed as T };
  } catch (err) {
    clearTimeout(timer);
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      status: 0,
      message: aborted ? "WB не ответил за 30 секунд." : err instanceof Error ? err.message : "Неизвестная ошибка",
      raw: null,
      forbidden: false,
      rateLimited: false,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Справочники и деньги (чтение)                                       */
/* ------------------------------------------------------------------ */

export interface AdvertConfig {
  currency: string;
  currencyCode: number;
  /** Шаг ставки CPM в разменных единицах (0,01 базовой валюты). */
  cpmStep: number;
  cpcStep: number;
  /** Минимальное пополнение бюджета кампании в разменных единицах. */
  minTopUp: number;
}

/**
 * Валюта, шаг ставки и минимальное пополнение — со стороны WB, а не константой.
 *
 * Это не педантизм: у кабинетов бывает не рубль (спека приводит пример в UZS),
 * и зашитые в код «минимум 50 ₽» и «шаг 1 ₽» в таком кабинете дают форму,
 * которая молча предлагает недопустимые числа, а WB отбивает их четырёхсотой.
 */
export function getAdvertConfig(token: string) {
  return advertCall<AdvertConfig>({ token, path: "/api/advert/v1/config", method: "GET" });
}

export interface AdvertBalance {
  balance: number;
  net: number;
  bonus: number;
  currency: string;
}

export function getAdvertBalance(token: string) {
  return advertCall<AdvertBalance>({ token, path: "/adv/v1/balance", method: "GET" });
}

export function getAdvertBudget(token: string, advertId: number) {
  return advertCall<{ total: number; cash?: number; bonus?: number }>({
    token,
    path: "/adv/v1/budget",
    method: "GET",
    query: { id: advertId },
  });
}

/* ------------------------------------------------------------------ */
/* Статус кампании                                                     */
/* ------------------------------------------------------------------ */

export const ADVERT_STATUS_BY_ACTION = { start: 9, pause: 11, stop: 7 } as const;
export type AdvertLifecycleAction = keyof typeof ADVERT_STATUS_BY_ACTION;

const LIFECYCLE_PATH: Record<AdvertLifecycleAction, string> = {
  start: "/adv/v0/start",
  pause: "/adv/v0/pause",
  stop: "/adv/v0/stop",
};

export function setAdvertLifecycle(token: string, advertId: number, action: AdvertLifecycleAction) {
  return advertCall<unknown>({ token, path: LIFECYCLE_PATH[action], method: "GET", query: { id: advertId } });
}

export function renameAdvert(token: string, advertId: number, name: string) {
  return advertCall<unknown>({
    token,
    path: "/adv/v0/rename",
    method: "POST",
    body: { advertId, name },
  });
}

/* ------------------------------------------------------------------ */
/* Ставки                                                              */
/* ------------------------------------------------------------------ */

export type AdvertPlacement = "search" | "recommendations" | "combined";

export interface NmBidInput {
  nmId: number;
  /** Ставка в разменных единицах (копейках). */
  bidKopecks: number;
  placement: AdvertPlacement;
}

export interface SetBidsResult {
  bids?: Array<{ advert_id: number; nm_bids?: Array<{ nm_id: number; bid_kopecks?: number; error?: string }> }>;
  currency?: string;
}

/**
 * Ставка в WB задаётся ПОТОВАРНО и ПОМЕСТНО, а не одним числом на кампанию.
 *
 * Прежняя реализация слала `{advertId, cpm, instrument}` — форму, которой в
 * текущей спеке нет вовсе; WB отвечает на неё 400. Здесь тело собрано по
 * действующей схеме: bids[] → nm_bids[] → {nm_id, bid_kopecks, placement},
 * до 50 кампаний и до 50 артикулов в каждой.
 *
 * `combined` — только для кампаний с единой ставкой, `search`/`recommendations` —
 * только для ручной. Проверку соответствия делает вызывающий: здесь нет знания
 * о типе кампании, а угадывать placement за пользователя значит менять ставку
 * не там, где он смотрел.
 */
export function setAdvertBids(token: string, items: Array<{ advertId: number; nmBids: NmBidInput[] }>) {
  return advertCall<SetBidsResult>({
    token,
    path: "/api/advert/v1/bids",
    method: "PATCH",
    body: {
      bids: items.slice(0, 50).map((item) => ({
        advert_id: item.advertId,
        nm_bids: item.nmBids.slice(0, 50).map((bid) => ({
          nm_id: bid.nmId,
          bid_kopecks: Math.round(bid.bidKopecks),
          placement: bid.placement,
        })),
      })),
    },
  });
}

export function getBidRecommendations(token: string, advertId: number, nmId: number) {
  return advertCall<unknown>({
    token,
    path: "/api/advert/v0/bids/recommendations",
    method: "GET",
    query: { advertId, nmId },
  });
}

export function getMinBids(token: string, body: unknown) {
  return advertCall<unknown>({ token, path: "/api/advert/v1/bids/min", method: "POST", body });
}

/* ------------------------------------------------------------------ */
/* Поисковые кластеры и минус-фразы                                    */
/* ------------------------------------------------------------------ */

export interface ClusterListItem {
  advertId: number;
  nmId: number;
  normQueries?: {
    active: string[] | null;
    excluded: string[] | null;
    archived: string[] | null;
  };
}

/** Списки кластеров, по которым набралось не меньше 100 показов (порог WB). */
export function getClusterList(token: string, items: Array<{ advertId: number; nmId: number }>) {
  return advertCall<{ items?: ClusterListItem[] }>({
    token,
    path: "/adv/v0/normquery/list",
    method: "POST",
    body: { items: items.slice(0, 100).map((item) => ({ advertId: item.advertId, nmId: item.nmId })) },
  });
}

export function getClusterBids(token: string, items: Array<{ advertId: number; nmId: number }>) {
  return advertCall<{ bids?: Array<{ advert_id: number; nm_id: number; norm_query: string; bid: number }> }>({
    token,
    path: "/adv/v0/normquery/get-bids",
    method: "POST",
    body: { items: items.slice(0, 100).map((item) => ({ advert_id: item.advertId, nm_id: item.nmId })) },
  });
}

export interface ClusterBidInput {
  advertId: number;
  nmId: number;
  normQuery: string;
  /** Ставка за тысячу показов в базовых единицах валюты кабинета. */
  bid: number;
}

/** Ставки на кластеры. Только кампании с ручной ставкой и оплатой за показы. */
export function setClusterBids(token: string, bids: ClusterBidInput[]) {
  return advertCall<unknown>({
    token,
    path: "/adv/v0/normquery/bids",
    method: "POST",
    body: {
      bids: bids.slice(0, 100).map((bid) => ({
        advert_id: bid.advertId,
        nm_id: bid.nmId,
        norm_query: bid.normQuery,
        bid: Math.round(bid.bid),
      })),
    },
  });
}

export function deleteClusterBids(token: string, bids: Array<{ advertId: number; nmId: number; normQuery: string }>) {
  return advertCall<unknown>({
    token,
    path: "/adv/v0/normquery/bids",
    method: "DELETE",
    body: {
      bids: bids.slice(0, 100).map((bid) => ({
        advert_id: bid.advertId,
        nm_id: bid.nmId,
        norm_query: bid.normQuery,
      })),
    },
  });
}

export function getMinusPhrases(token: string, items: Array<{ advertId: number; nmId: number }>) {
  return advertCall<{ items?: Array<{ advert_id: number; nm_id: number; norm_queries?: string[] }> }>({
    token,
    path: "/adv/v0/normquery/get-minus",
    method: "POST",
    body: { items: items.slice(0, 100).map((item) => ({ advert_id: item.advertId, nm_id: item.nmId })) },
  });
}

/**
 * Минус-фразы задаются ЦЕЛИКОМ: WB заменяет прежний набор присланным.
 *
 * Отсюда прямое следствие для интерфейса — «добавить одну фразу» невозможно без
 * предварительного чтения текущего списка, а пустой массив стирает все минус-фразы
 * разом. Вызывающий обязан сначала прочитать get-minus и слать объединённый набор,
 * иначе одна добавленная фраза тихо снесёт полсотни накопленных.
 */
export function setMinusPhrases(token: string, advertId: number, nmId: number, phrases: string[]) {
  return advertCall<unknown>({
    token,
    path: "/adv/v0/normquery/set-minus",
    method: "POST",
    body: { advert_id: advertId, nm_id: nmId, norm_queries: phrases.slice(0, 1000) },
  });
}

export function getClusterStats(token: string, body: unknown) {
  return advertCall<unknown>({ token, path: "/adv/v0/normquery/stats", method: "POST", body });
}

/* ------------------------------------------------------------------ */
/* Создание кампании                                                   */
/* ------------------------------------------------------------------ */

export interface CreateAdvertInput {
  name: string;
  nms: number[];
  bidType: "manual" | "unified";
  paymentType: "cpm" | "cpc";
  /** Только для кампаний с ручной ставкой. */
  placementTypes?: Array<"search" | "recommendations">;
}

/**
 * Создание кампании. Ответ WB — голое число, ID новой кампании.
 *
 * Лимит WB здесь жёстче, чем у остальных методов: 5 запросов в минуту на аккаунт,
 * а для базового токена — 5 в час. Массового создания в модуле нет намеренно.
 */
export function createAdvert(token: string, input: CreateAdvertInput) {
  const body: Record<string, unknown> = {
    name: input.name,
    nms: input.nms.slice(0, 50),
    bid_type: input.bidType,
    payment_type: input.paymentType,
  };
  // placement_types WB принимает только у ручной ставки: у единой места выбирает
  // сам алгоритм, и лишнее поле — повод для отказа, а не безобидный шум.
  if (input.bidType === "manual" && input.placementTypes?.length) {
    body.placement_types = input.placementTypes;
  }
  return advertCall<number>({ token, path: "/adv/v2/seacat/save-ad", method: "POST", body });
}

/** Карточки, доступные для кампаний (для формы создания). */
export function getAdvertNms(token: string, body: unknown) {
  return advertCall<unknown>({ token, path: "/adv/v2/supplier/nms", method: "POST", body });
}

export function setAuctionNms(token: string, advertId: number, nms: number[]) {
  return advertCall<unknown>({
    token,
    path: "/adv/v0/auction/nms",
    method: "PATCH",
    body: { advert_id: advertId, nms: nms.slice(0, 50) },
  });
}

/* ------------------------------------------------------------------ */
/* Пополнение бюджета                                                  */
/* ------------------------------------------------------------------ */

/** Источник пополнения по классификации WB. */
export const DEPOSIT_SOURCE = { account: 0, balance: 1, bonus: 3 } as const;
export type DepositSource = (typeof DEPOSIT_SOURCE)[keyof typeof DEPOSIT_SOURCE];

export const DEPOSIT_SOURCE_LABEL: Record<DepositSource, string> = {
  0: "Счёт",
  1: "Баланс (взаимозачёт из будущих продаж)",
  3: "Бонусы",
};

export function depositAdvertBudget(
  token: string,
  advertId: number,
  sum: number,
  source: DepositSource,
) {
  return advertCall<{ total?: number }>({
    token,
    path: "/adv/v1/budget/deposit",
    method: "POST",
    query: { id: advertId },
    body: { sum: Math.round(sum), type: source, return: true },
  });
}
