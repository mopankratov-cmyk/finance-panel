// Сверка оборота кодов маркировки (Честный Знак) — источник WB, не ЧЗ.
//
// В Честный Знак за продавца мы не ходим: True API требует его УКЭП, которой у
// панели нет. Поэтому здесь ровно то, что делает эталон: по данным WB видно, ЧТО
// НАДО СДЕЛАТЬ руками — какие проданные задания остались без выведенного кода
// (риск ст. 15.12 КоАП) и по каким возвратам код надо вернуть в оборот.
//
// Источники (все — официальные WB API):
//   1) сборочные задания FBS      — marketplace-api /api/v3/orders
//   2) статусы заданий            — marketplace-api /api/v3/orders/status  (wbStatus=sold → продано)
//   3) коды маркировки задания    — marketplace-api /api/v3/orders/{id}/meta (sgtin/uin/imei/gtin)
//   4) факт возврата              — statistics-api /api/v1/supplier/sales (saleID на R…)
//   5) причина возврата           — returns-api /api/v1/claims (только текст, по srid)
//
// Любой источник может отвалиться: сверка деградирует до честного предупреждения
// и пустой корзины, но никогда не выдаёт догадку за факт.

// Разбор кода маркировки — одна реализация на весь проект (lib/wb/kizCodes.ts):
// разные правила распознавания на двух вкладках означали бы, что один и тот же
// код «есть» в одном отчёте и «не распознан» в другом.
import { kizMatchesBarcode, parseKizCode, type KizCode } from "./kizCodes";

const ORDERS_URL = "https://marketplace-api.wildberries.ru/api/v3/orders";
const ORDERS_STATUS_URL = "https://marketplace-api.wildberries.ru/api/v3/orders/status";
const SALES_URL = "https://statistics-api.wildberries.ru/api/v1/supplier/sales";
const CLAIMS_URL = "https://returns-api.wildberries.ru/api/v1/claims";

const ORDERS_PAGE_LIMIT = 1000;
const ORDERS_MAX_PAGES = 20;
const STATUS_CHUNK = 1000;
/** Потолок на прогон: meta читается по одному заданию, лимит WB — сотни запросов в минуту. */
export const KIZ_META_LOOKUP_LIMIT = 400;
const META_CONCURRENCY = 6;
const CLAIMS_PAGE_LIMIT = 200;
const CLAIMS_MAX_PAGES = 5;

export type KizReconcileDays = 30 | 60 | 90;
/**
 * «Не проверено» ≠ «нет кода»: во вторую корзину попадает только то, что WB
 * подтвердил (задание продано, код к нему не привязан). Если опрос кодов не
 * состоялся — задание уходит в not_checked, иначе панель выдаёт своё незнание
 * за факт об обороте продавца.
 */
export type KizBucket = "retire" | "check" | "not_checked" | "introduce";
export type KizSource = "orders" | "statuses" | "meta" | "sales" | "claims";

export const KIZ_BUCKET_LABELS: Record<KizBucket, string> = {
  retire: "Вывести",
  check: "Проверить",
  not_checked: "Не проверено",
  introduce: "Ввести в оборот",
};

const SOURCE_LABELS: Record<KizSource, string> = {
  orders: "сборочные задания FBS",
  statuses: "статусы сборочных заданий",
  meta: "коды маркировки задания",
  sales: "продажи и возвраты",
  claims: "заявки на возврат",
};

export class WbKizSourceError extends Error {
  constructor(message: string, readonly status: number, readonly source: KizSource) {
    super(message);
    this.name = "WbKizSourceError";
  }
}

/* ───────────────────────────── рабочие дни ───────────────────────────── */

/**
 * Срок «ввести код обратно в оборот» — 3 рабочих дня с ДНЯ ПОСЛЕ возврата.
 * Производственный календарь РФ (праздники и переносы) не учитывается: источника
 * календаря в проекте нет, и выдумывать его нельзя — UI подписывает это мелким текстом.
 */
export function addWorkingDays(iso: string, days: number): string {
  const start = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return iso.slice(0, 10);
  let left = days;
  const cursor = new Date(start.getTime());
  while (left > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return cursor.toISOString().slice(0, 10);
}

export function isKizOverdue(deadlineIso: string | null, todayIso: string): boolean {
  if (!deadlineIso) return false;
  return deadlineIso < todayIso.slice(0, 10);
}

/* ───────────────────────────── сетевой слой ───────────────────────────── */

interface WbRequest {
  url: string;
  token: string;
  source: KizSource;
  deadline: number;
  method?: "GET" | "POST";
  body?: unknown;
}

function timeoutMs(deadline: number): number {
  return Math.min(15_000, deadline - Date.now());
}

async function wbJson<T>(request: WbRequest): Promise<T> {
  const label = SOURCE_LABELS[request.source];
  for (let attempt = 0; attempt < 2; attempt++) {
    const budget = timeoutMs(request.deadline);
    if (budget <= 0) throw new WbKizSourceError(`WB не успел отдать ${label} за отведённое время`, 504, request.source);
    const response = await fetch(request.url, {
      method: request.method ?? "GET",
      headers: request.body === undefined
        ? { Authorization: request.token.trim() }
        : { Authorization: request.token.trim(), "Content-Type": "application/json" },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      cache: "no-store",
      signal: AbortSignal.timeout(budget),
    });
    if (response.status === 429 && attempt === 0) {
      const hinted = Number(response.headers.get("X-Ratelimit-Retry") ?? response.headers.get("Retry-After") ?? NaN);
      const waitMs = Number.isFinite(hinted) && hinted > 0 ? Math.min(hinted * 1000, 10_000) : 2_100;
      if (Date.now() + waitMs + 2_000 > request.deadline) {
        throw new WbKizSourceError(`WB ограничил частоту запросов (${label}) — повторите через минуту`, 429, request.source);
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    if (response.status === 429) {
      throw new WbKizSourceError(`WB ограничил частоту запросов (${label}) — повторите через минуту`, 429, request.source);
    }
    if (response.status === 401 || response.status === 403) {
      throw new WbKizSourceError(`WB-токен кабинета не даёт доступ к разделу «${label}»`, 403, request.source);
    }
    if (!response.ok) {
      throw new WbKizSourceError(`WB ${response.status} (${label}): ${(await response.text()).slice(0, 200)}`, response.status, request.source);
    }
    return await response.json() as T;
  }
  throw new WbKizSourceError(`WB не ответил на запрос «${label}» после повтора`, 502, request.source);
}

/* ───────────────────────────── сборочные задания FBS ───────────────────────────── */

export interface FbsAssemblyTask {
  /** id сборочного задания WB — единица сверки. */
  id: number;
  /** rid задания = srid продажи: по нему возврат связывается с заданием. */
  srid: string;
  nmId: number | null;
  article: string;
  barcode: string;
  createdAt: string | null;
}

interface RawMarketplaceOrder {
  id?: number;
  rid?: string;
  nmId?: number;
  article?: string;
  skus?: string[];
  createdAt?: string;
}

export async function fetchFbsAssemblyTasks(options: {
  token: string;
  fromMs: number;
  toMs: number;
  deadline: number;
}): Promise<{ tasks: FbsAssemblyTask[]; truncated: boolean }> {
  const tasks: FbsAssemblyTask[] = [];
  let next = 0;
  for (let page = 0; page < ORDERS_MAX_PAGES; page++) {
    const url = new URL(ORDERS_URL);
    url.searchParams.set("limit", String(ORDERS_PAGE_LIMIT));
    url.searchParams.set("next", String(next));
    url.searchParams.set("dateFrom", String(Math.floor(options.fromMs / 1000)));
    url.searchParams.set("dateTo", String(Math.floor(options.toMs / 1000)));
    const json = await wbJson<{ next?: number; orders?: RawMarketplaceOrder[] }>({
      url: url.toString(),
      token: options.token,
      source: "orders",
      deadline: options.deadline,
    });
    const orders = json.orders ?? [];
    for (const order of orders) {
      const id = Number(order.id);
      if (!Number.isFinite(id)) continue;
      const nmId = Number(order.nmId);
      tasks.push({
        id,
        srid: String(order.rid ?? "").trim(),
        nmId: Number.isFinite(nmId) ? nmId : null,
        article: String(order.article ?? "").trim(),
        barcode: String(order.skus?.[0] ?? "").trim(),
        createdAt: order.createdAt ?? null,
      });
    }
    next = Number(json.next ?? 0);
    if (orders.length < ORDERS_PAGE_LIMIT || !next) return { tasks, truncated: false };
  }
  return { tasks, truncated: true };
}

/** wbStatus === "sold" — задание доехало до покупателя, код должен быть выведен из оборота. */
export async function fetchFbsSoldTaskIds(options: {
  token: string;
  ids: number[];
  deadline: number;
}): Promise<{ sold: Set<number>; complete: boolean }> {
  const sold = new Set<number>();
  for (let offset = 0; offset < options.ids.length; offset += STATUS_CHUNK) {
    const chunk = options.ids.slice(offset, offset + STATUS_CHUNK);
    const json = await wbJson<{ orders?: { id?: number; wbStatus?: string }[] }>({
      url: ORDERS_STATUS_URL,
      token: options.token,
      source: "statuses",
      deadline: options.deadline,
      method: "POST",
      body: { orders: chunk },
    });
    for (const row of json.orders ?? []) {
      const id = Number(row.id);
      if (Number.isFinite(id) && String(row.wbStatus ?? "") === "sold") sold.add(id);
    }
    if (Date.now() + 5_000 > options.deadline && offset + STATUS_CHUNK < options.ids.length) {
      return { sold, complete: false };
    }
  }
  return { sold, complete: true };
}

/** Значение поля meta приходит и массивом, и одиночной строкой. */
function metaCodes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((value) => String(value ?? "").trim()).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

/** Почему опрос кодов прервался. Ни одна из причин не говорит об обороте продавца. */
export type KizLookupStopReason = "forbidden" | "rate_limited" | "timeout" | "deadline";

const LOOKUP_STOP_MESSAGES: Record<KizLookupStopReason, string> = {
  forbidden: "WB-токен кабинета не даёт доступ к кодам маркировки заданий",
  rate_limited: "WB ограничил частоту запросов к кодам маркировки",
  timeout: "WB не успел отдать коды маркировки за отведённое время",
  deadline: "время прогона закончилось раньше, чем WB ответил по всем заданиям",
};

export interface KizCodesLookupState {
  /** true — опрос оборвался целиком: состояние кодов НЕ известно, а не «кода нет». */
  lookupStopped: boolean;
  stopReason: KizLookupStopReason | null;
  stopMessage: string | null;
  /** Заданий, по которым WB вернул ошибку поштучно. */
  failed: number;
  /** Заданий, до которых опрос не дошёл (потолок прогона, дедлайн, обрыв). */
  skipped: number;
}

export interface KizCodesLookupResult extends KizCodesLookupState {
  /** Ключ есть → задание опрошено (пустой массив = кода действительно нет). */
  codes: Map<number, string[]>;
}

/**
 * Коды маркировки, привязанные к сборочным заданиям: meta.sgtin / uin / imei / gtin
 * (именно эти поля отдаёт /api/v3/orders/{id}/meta). Читается по одному заданию,
 * поэтому прогон ограничен потолком и дедлайном.
 *
 * Провал опроса (нет прав, лимит, таймаут) — это НЕ «кода нет»: такие задания
 * остаются без ключа в codes и попадают в корзину «Не проверено», а причина
 * обрыва возвращается наружу, чтобы роут показал предупреждение.
 */
/** Прямой опрос кодов одного сборочного задания у WB (без кэша). */
export async function fetchTaskKizCodesDirect(token: string, id: number, deadline: number): Promise<string[]> {
  const json = await wbJson<{ meta?: Record<string, unknown> }>({
    url: `${ORDERS_URL}/${id}/meta`,
    token,
    source: "meta",
    deadline,
  });
  const meta = json.meta ?? {};
  return [
    ...metaCodes(meta.sgtin),
    ...metaCodes(meta.uin),
    ...metaCodes(meta.imei),
    ...metaCodes(meta.gtin),
  ];
}

export async function fetchFbsTaskKizCodes(options: {
  token: string;
  ids: number[];
  deadline: number;
  limit?: number;
  /**
   * Как получить коды одного задания. По умолчанию — прямой запрос к WB.
   * Роут подставляет кэширующую обёртку: код задания не меняется, поэтому
   * однажды опрошенные задания достаются мгновенно и прогресс накапливается
   * между прогонами, а не начинается каждый раз с нуля.
   * Обёртка обязана пробрасывать WbKizSourceError — на нём держится
   * различение «кода нет» и «WB не ответил».
   */
  resolve?: (id: number) => Promise<string[]>;
}): Promise<KizCodesLookupResult> {
  const limit = options.limit ?? KIZ_META_LOOKUP_LIMIT;
  const planned = options.ids.slice(0, limit);
  const codes = new Map<number, string[]>();
  let failed = 0;
  let cursor = 0;
  let stopReason: KizLookupStopReason | null = null;

  const stop = (reason: KizLookupStopReason) => {
    // Первая причина обрыва — самая честная: дальше воркеры просто выходят.
    if (!stopReason) stopReason = reason;
  };

  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= planned.length || stopReason) return;
      if (Date.now() + 3_000 > options.deadline) {
        stop("deadline");
        return;
      }
      const id = planned[index];
      try {
        codes.set(id, options.resolve
          ? await options.resolve(id)
          : await fetchTaskKizCodesDirect(options.token, id, options.deadline));
      } catch (error) {
        // 401/403/429/504 бьют по всем заданиям сразу — дальше идти бессмысленно.
        if (error instanceof WbKizSourceError && error.status === 429) return stop("rate_limited");
        if (error instanceof WbKizSourceError && error.status === 504) return stop("timeout");
        if (error instanceof WbKizSourceError && (error.status === 401 || error.status === 403)) {
          return stop("forbidden");
        }
        failed += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(META_CONCURRENCY, planned.length) }, worker));
  const reason: KizLookupStopReason | null = stopReason;
  return {
    codes,
    failed,
    // Честный счёт: сколько заданий из запрошенных так и не были опрошены.
    skipped: Math.max(0, options.ids.length - codes.size - failed),
    lookupStopped: reason !== null,
    stopReason: reason,
    stopMessage: reason ? LOOKUP_STOP_MESSAGES[reason] : null,
  };
}

/* ───────────────────────────── возвраты ───────────────────────────── */

export interface WbReturnFact {
  saleId: string;
  srid: string;
  nmId: number | null;
  article: string;
  barcode: string;
  brand: string;
  returnedAt: string | null;
}

interface RawSaleRow {
  saleID?: string;
  srid?: string;
  nmId?: number;
  supplierArticle?: string;
  barcode?: string;
  brand?: string;
  date?: string;
}

/** Факт возврата = строка продаж WB с saleID на «R…»: там есть баркод, артикул и дата. */
export async function fetchWbReturnFacts(options: {
  token: string;
  fromIso: string;
  deadline: number;
}): Promise<WbReturnFact[]> {
  const url = new URL(SALES_URL);
  url.searchParams.set("dateFrom", options.fromIso);
  url.searchParams.set("flag", "0");
  const rows = await wbJson<RawSaleRow[]>({
    url: url.toString(),
    token: options.token,
    source: "sales",
    deadline: options.deadline,
  });
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => String(row.saleID ?? "").startsWith("R"))
    .map((row) => {
      const nmId = Number(row.nmId);
      return {
        saleId: String(row.saleID ?? ""),
        srid: String(row.srid ?? "").trim(),
        nmId: Number.isFinite(nmId) ? nmId : null,
        article: String(row.supplierArticle ?? "").trim(),
        barcode: String(row.barcode ?? "").trim(),
        brand: String(row.brand ?? "").trim(),
        returnedAt: row.date ? String(row.date) : null,
      };
    });
}

/** Первое непустое строковое значение из списка возможных имён поля. */
function claimText(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

/**
 * Заявки из тела ответа. WB отдаёт их и голым массивом, и в конверте
 * ({claims}, {items}, {data:{claims}}) — разбираем так же устойчиво, как
 * lib/wb/pvzReturns.ts, иначе один и тот же ответ читается по-разному.
 */
export function extractClaimRows(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (!body || typeof body !== "object") return [];
  const envelope = body as Record<string, unknown>;
  const nested = envelope.data && typeof envelope.data === "object" ? (envelope.data as Record<string, unknown>) : null;
  const source = envelope.claims ?? nested?.claims ?? envelope.items ?? nested?.items;
  return Array.isArray(source) ? (source as Record<string, unknown>[]) : [];
}

/**
 * Причина возврата человеческим языком. Отдельный источник: в строках продаж
 * причины нет. Статусы заявок не интерпретируем — берём только текст продавца
 * и WB, чтобы не подменять факт своей классификацией.
 */
export async function fetchReturnClaimReasons(options: {
  token: string;
  deadline: number;
}): Promise<Map<string, string>> {
  const reasons = new Map<string, string>();
  for (const archive of [true, false]) {
    for (let page = 0; page < CLAIMS_MAX_PAGES; page++) {
      if (Date.now() + 5_000 > options.deadline) return reasons;
      const url = new URL(CLAIMS_URL);
      url.searchParams.set("is_archive", String(archive));
      url.searchParams.set("limit", String(CLAIMS_PAGE_LIMIT));
      url.searchParams.set("offset", String(page * CLAIMS_PAGE_LIMIT));
      const json = await wbJson<unknown>({
        url: url.toString(),
        token: options.token,
        source: "claims",
        deadline: options.deadline,
      });
      const claims = extractClaimRows(json);
      for (const claim of claims) {
        const srid = claimText(claim, ["srid", "rid", "order_id", "orderId"]);
        const text = claimText(claim, ["user_comment", "userComment", "client_comment", "reason"])
          || claimText(claim, ["wb_comment", "wbComment"]);
        if (srid && text) reasons.set(srid, text);
      }
      if (claims.length < CLAIMS_PAGE_LIMIT) break;
    }
  }
  return reasons;
}

/* ───────────────────────────── сверка ───────────────────────────── */

export type KizRowBucket = "retire" | "check" | "not_checked";

export interface KizReconcileRow {
  bucket: KizRowBucket;
  taskId: string;
  srid: string;
  nmId: number | null;
  article: string;
  brand: string | null;
  barcode: string;
  code: string | null;
  /** Первые 9 знаков GTIN — технический ключ группировки, НЕ владелец кода. */
  gtinPrefix: string | null;
  soldAt: string | null;
  /** Почему строка здесь — человеческим языком. */
  reason: string;
  /** Что сделать руками. */
  action: string;
}

export interface KizReturnTask {
  saleId: string;
  srid: string;
  nmId: number | null;
  article: string;
  brand: string | null;
  barcode: string;
  code: string | null;
  /** Первые 9 знаков GTIN — технический ключ группировки, НЕ владелец кода. */
  gtinPrefix: string | null;
  returnedAt: string | null;
  reason: string;
  deadline: string | null;
  overdue: boolean;
}

export interface KizReconcileCounts { retire: number; check: number; notChecked: number; introduce: number }

/**
 * Группа кодов по началу GTIN. Это НЕ владелец: длина префикса GS1 переменная
 * (7–10 знаков), и без реестра GS1 два разных ИП могут слиться в одну группу.
 */
export interface KizCodeGroupSummary { gtinPrefix: string | null; codes: number; retire: number; introduce: number }

export interface KizReconcileResult {
  counts: KizReconcileCounts;
  coverage: { checked: number; soldTotal: number; days: KizReconcileDays };
  rows: KizReconcileRow[];
  returns: KizReturnTask[];
  codeGroups: KizCodeGroupSummary[];
  warnings: string[];
}

export interface KizReconcileInput {
  todayIso: string;
  days: KizReconcileDays;
  tasks: FbsAssemblyTask[];
  soldIds: Set<number>;
  /** Прочитанные метаданные: ключ есть → код проверен (пустой массив = кода нет). */
  codesByTask: Map<number, string[]>;
  /** Чем закончился опрос кодов. Без него «не проверено» неотличимо от «нет кода». */
  codesLookup?: KizCodesLookupState;
  statusesAvailable: boolean;
  returns: WbReturnFact[];
  reasonBySrid: Map<string, string>;
  brandByNm: Map<number, string>;
  brandByArticle: Map<string, string>;
}

export function emptyKizReconcileResult(days: KizReconcileDays, warnings: string[] = []): KizReconcileResult {
  return {
    counts: { retire: 0, check: 0, notChecked: 0, introduce: 0 },
    coverage: { checked: 0, soldTotal: 0, days },
    rows: [],
    returns: [],
    codeGroups: [],
    warnings,
  };
}

const articleKey = (article: string) => article.trim().toLocaleLowerCase("ru-RU");

function brandOf(input: KizReconcileInput, nmId: number | null, article: string): string | null {
  if (nmId !== null) {
    const byNm = input.brandByNm.get(nmId);
    if (byNm) return byNm;
  }
  const byArticle = input.brandByArticle.get(articleKey(article));
  return byArticle || null;
}

export function reconcileKizFromWb(input: KizReconcileInput): KizReconcileResult {
  const warnings: string[] = [];
  const today = input.todayIso.slice(0, 10);

  const soldTasks = input.statusesAvailable
    ? input.tasks.filter((task) => input.soldIds.has(task.id))
    : [];
  if (!input.statusesAvailable) {
    warnings.push("WB не отдал статусы сборочных заданий — корзины по продажам не считаются, чтобы не выдать непроданное за проданное.");
  }

  const lookupStopped = input.codesLookup?.lookupStopped ?? false;
  const lookupMessage = input.codesLookup?.stopMessage ?? "причина не раскрыта";

  // Коды возвратов нужны, чтобы поймать «продан и одновременно вернулся».
  const returnedSrids = new Set(input.returns.map((row) => row.srid).filter(Boolean));

  // Сколько раз встретился каждый код — один код на два задания означает пересорт.
  const codeUsage = new Map<string, number>();
  for (const task of soldTasks) {
    for (const raw of input.codesByTask.get(task.id) ?? []) {
      const parsed = parseKizCode(raw);
      if (!parsed.code) continue;
      codeUsage.set(parsed.code, (codeUsage.get(parsed.code) ?? 0) + 1);
    }
  }

  const rows: KizReconcileRow[] = [];
  const codeBySrid = new Map<string, KizCode>();
  let checked = 0;

  for (const task of soldTasks) {
    const brand = brandOf(input, task.nmId, task.article);
    const base = {
      taskId: String(task.id),
      srid: task.srid,
      nmId: task.nmId,
      article: task.article,
      brand,
      barcode: task.barcode,
      soldAt: task.createdAt,
    };
    const rawCodes = input.codesByTask.get(task.id);

    if (rawCodes === undefined) {
      // Опрос по заданию не состоялся: это незнание панели, а не факт об обороте.
      rows.push({
        ...base,
        bucket: "not_checked",
        code: null,
        gtinPrefix: null,
        reason: lookupStopped
          ? `код задания не проверен — опрос WB прерван: ${lookupMessage}`
          : "код задания не проверен — WB не отдал метаданные в отведённое время",
        action: "повторите проверку: до этого состояние кода неизвестно",
      });
      continue;
    }
    checked += 1;

    if (!rawCodes.length) {
      rows.push({
        ...base,
        bucket: "retire",
        code: null,
        gtinPrefix: null,
        reason: "продан, но код не привязан к заданию — WB нечего выводить из оборота",
        action: "вывести код из оборота вручную в ЛК Честный Знак либо привязать его в WB, пока задание открыто",
      });
      continue;
    }

    for (const raw of rawCodes) {
      const parsed = parseKizCode(raw);
      if (parsed.code && task.srid) codeBySrid.set(task.srid, parsed);
      if (!parsed.code) {
        rows.push({
          ...base,
          bucket: "check",
          code: null,
          gtinPrefix: null,
          reason: "код задания не распознан — ожидается код идентификации из 31 символа",
          action: "сверьте марку в задании WB: возможно, передан фрагмент кода или криптохвост",
        });
        continue;
      }
      const shared = { ...base, code: parsed.code, gtinPrefix: parsed.gtinPrefix };
      if ((codeUsage.get(parsed.code) ?? 0) > 1) {
        rows.push({
          ...shared,
          bucket: "check",
          reason: "один код на два задания — вероятен пересорт или двойное списание",
          action: "сверьте задания вручную и оставьте код за одной проданной единицей",
        });
        continue;
      }
      if (task.srid && returnedSrids.has(task.srid)) {
        rows.push({
          ...shared,
          bucket: "check",
          reason: "код продан и одновременно вернулся — состояние в обороте противоречиво",
          action: "сверьте пару «продажа/возврат» и приведите статус кода в ЛК Честный Знак",
        });
        continue;
      }
      if (!kizMatchesBarcode(parsed, task.barcode)) {
        rows.push({
          ...shared,
          bucket: "check",
          reason: "GTIN кода не совпадает со штрихкодом позиции задания",
          action: "проверьте, не наклеен ли код от другой единицы товара",
        });
        continue;
      }
      // Код привязан и непротиворечив — WB выведет его сам, строка не нужна.
    }
  }

  const returns: KizReturnTask[] = input.returns.map((row) => {
    const parsed = row.srid ? codeBySrid.get(row.srid) ?? null : null;
    const deadline = row.returnedAt ? addWorkingDays(row.returnedAt, 3) : null;
    return {
      saleId: row.saleId,
      srid: row.srid,
      nmId: row.nmId,
      article: row.article,
      brand: brandOf(input, row.nmId, row.article) ?? (row.brand || null),
      barcode: row.barcode,
      code: parsed?.code ?? null,
      gtinPrefix: parsed?.gtinPrefix ?? null,
      returnedAt: row.returnedAt,
      reason: input.reasonBySrid.get(row.srid) ?? "причина возврата не раскрыта WB",
      deadline,
      overdue: isKizOverdue(deadline, today),
    };
  });

  const undatedReturns = returns.filter((row) => !row.returnedAt).length;
  if (undatedReturns) warnings.push(`Возвратов без распознанной даты: ${undatedReturns} — срок ввода в оборот по ним не рассчитан.`);

  // Старые горят первыми: «Вывести» — по дате продажи, возвраты — просроченные сверху.
  rows.sort((a, b) => (a.soldAt ?? "").localeCompare(b.soldAt ?? ""));
  returns.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
  });

  // Группировка по началу GTIN — фильтр «покажи только эти коды», а не реестр ИП.
  const codeGroups = new Map<string, KizCodeGroupSummary>();
  const bumpGroup = (prefix: string | null, field: "retire" | "introduce") => {
    const key = prefix ?? "";
    const current = codeGroups.get(key) ?? { gtinPrefix: prefix, codes: 0, retire: 0, introduce: 0 };
    current.codes += 1;
    current[field] += 1;
    codeGroups.set(key, current);
  };
  // «Не проверено» в группы не идёт: там нечего группировать, кода мы не видели.
  for (const row of rows) if (row.bucket === "retire" || row.bucket === "check") bumpGroup(row.gtinPrefix, "retire");
  for (const row of returns) bumpGroup(row.gtinPrefix, "introduce");

  const counts: KizReconcileCounts = {
    retire: rows.filter((row) => row.bucket === "retire").length,
    check: rows.filter((row) => row.bucket === "check").length,
    notChecked: rows.filter((row) => row.bucket === "not_checked").length,
    introduce: returns.length,
  };

  // Незнание проговариваем вслух: без этой строки «Не проверено» читается как
  // «нарушений нет», хотя панель просто не смогла спросить WB.
  if (counts.notChecked) {
    warnings.push(
      `Заданий с непроверенным кодом: ${counts.notChecked} — состояние их кодов неизвестно${lookupStopped ? `, опрос прерван: ${lookupMessage}` : ""}. Это не «код не привязан».`,
    );
  }

  return {
    counts,
    coverage: { checked, soldTotal: soldTasks.length, days: input.days },
    rows,
    returns,
    codeGroups: [...codeGroups.values()].sort((a, b) => b.codes - a.codes),
    warnings,
  };
}
