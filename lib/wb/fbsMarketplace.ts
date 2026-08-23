// Marketplace API WB — контур «свой склад» (FBS/DBS): сборочные задания, их
// статусы, коды маркировки задания и остатки на складах продавца.
//
// Отдельный хост от статистики и от supplies-api (см. lib/wb/fbwSupplies.ts).
// Токен тот же основной, но нужна категория «Маркетплейс» — зонд её проверяет
// в lib/wb/token.ts. Лимитер у WB общий на продавца, поэтому 429 ждём ровно
// столько, сколько просит WB, а не слепой паузой.

const BASE = "https://marketplace-api.wildberries.ru/api/v3";

export class WbFbsApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "WbFbsApiError";
  }
}

interface WbFbsRequest {
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
  /**
   * Момент, после которого нельзя ни ждать, ни начинать новую попытку.
   *
   * Без него лестница повторов живёт своей жизнью: три попытки по 15 секунд
   * с паузами до 20 секунд — до 85 секунд на ОДИН запрос. Внешние бюджеты
   * (у фонового сборщика 45 секунд, у экрана сверки 50) при этом просто
   * не соблюдались: проверка стояла между страницами, а не внутри запроса.
   */
  deadlineMs?: number;
  /**
   * Считать 404 честным «данных нет», а не сломанным адресом.
   *
   * Для списков 404 — это поломка, и молчать о ней нельзя. А вот у кода
   * маркировки 404 означает ровно одно: у задания кода нет. Пока это
   * трактовалось как ошибка, задание не отмечалось опрошенным, очередь не
   * сдвигалась, и фоновый сборщик писал «опрошено 0» при полном бюджете.
   */
  notFoundIsEmpty?: boolean;
}

function retryAfterMs(response: Response, attempt: number): number {
  const hinted = Number(response.headers.get("X-Ratelimit-Retry") ?? response.headers.get("Retry-After") ?? Number.NaN);
  if (Number.isFinite(hinted) && hinted > 0) return Math.min(hinted, 20) * 1000;
  return Math.min(8_000, (attempt + 1) * 2_000);
}

async function wbFbsJson<T>(token: string, request: WbFbsRequest): Promise<T> {
  const method = request.method ?? "GET";
  const asked = request.timeoutMs ?? 15_000;
  const left = () => (request.deadlineMs ?? Number.POSITIVE_INFINITY) - Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    // Начинать попытку, на которую заведомо нет времени, — значит потратить
    // остаток чужого бюджета и вернуться ни с чем.
    if (left() <= 0) {
      throw new WbFbsApiError("Не осталось времени на запрос к WB Marketplace API", 504);
    }
    const timeoutMs = Math.max(1_000, Math.min(asked, left()));
    let response: Response;
    try {
      response = await fetch(`${BASE}${request.path}`, {
        method,
        headers: {
          Authorization: token.trim(),
          ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/timeout|timed out|abort/i.test(message)) {
        throw new WbFbsApiError(`WB Marketplace API не ответил за ${Math.round(timeoutMs / 1000)} секунд`, 504);
      }
      throw new WbFbsApiError("Не удалось связаться с WB Marketplace API", 502);
    }
    if (response.status === 429 && attempt < 2) {
      const wait = retryAfterMs(response, attempt);
      // Ждать дольше, чем нам отпущено, бессмысленно: вызывающий всё равно
      // уже не успеет распорядиться ответом.
      if (wait >= left()) {
        throw new WbFbsApiError("WB ограничил частоту запросов к сборочным заданиям — повторите через минуту", 429);
      }
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }
    if (response.status === 429) {
      throw new WbFbsApiError("WB ограничил частоту запросов к сборочным заданиям — повторите через минуту", 429);
    }
    if (response.status === 401 || response.status === 403) {
      throw new WbFbsApiError("WB-токен не имеет категории «Маркетплейс» — сборочные задания недоступны", response.status);
    }
    // Пустой список солгал бы, что заданий нет: молчим только про честное «нет данных»,
    // а про сломанный адрес говорим вслух.
    if (response.status === 404 && request.notFoundIsEmpty) {
      return {} as T;
    }
    if (response.status === 404 || response.status === 405) {
      throw new WbFbsApiError(`WB не отдаёт данные по адресу ${request.path}`, 502);
    }
    if (!response.ok) {
      throw new WbFbsApiError(`WB ${response.status}: ${(await response.text()).slice(0, 240)}`, response.status);
    }
    return (await response.json()) as T;
  }
  throw new WbFbsApiError("WB не ответил после повторных попыток", 502);
}

/* ------------------------------- статусы ------------------------------- */

export type WbFbsBucket = "new" | "assembling" | "delivering" | "archive" | "cancelled";

export const WB_FBS_BUCKET_LABELS: Record<WbFbsBucket, string> = {
  new: "Новые",
  assembling: "На сборке",
  delivering: "В доставке",
  archive: "Архив",
  cancelled: "Отменённые",
};

const SUPPLIER_STATUS_LABELS: Record<string, string> = {
  new: "новое",
  confirm: "на сборке",
  complete: "в доставке",
  deliver: "в доставке",
  receive: "получено покупателем",
  cancel: "отменено продавцом",
  reject: "отклонено",
  cancel_client: "отменено покупателем",
};

const WB_STATUS_LABELS: Record<string, string> = {
  waiting: "ожидает сборки",
  sorted: "отсортировано",
  sold: "продано",
  canceled: "отменено",
  canceled_by_client: "отменено покупателем",
  declined_by_client: "отказ покупателя",
  defect: "брак",
  ready_for_pickup: "готово к выдаче",
  dispatched_by_seller: "отгружено продавцом",
};

/** Человеческая подпись статуса; неизвестный код WB показываем как есть, не выдумывая. */
export function fbsStatusLabel(supplierStatus: string, wbStatus: string): string {
  const supplier = SUPPLIER_STATUS_LABELS[supplierStatus] ?? supplierStatus;
  const wb = WB_STATUS_LABELS[wbStatus] ?? wbStatus;
  if (!wb || wb === supplier) return supplier || "—";
  if (!supplier) return wb;
  return `${supplier} · ${wb}`;
}

/** Раскладка задания по корзинам экрана. Порядок проверок важен: отмена перекрывает всё. */
export function fbsOrderBucket(supplierStatus: string, wbStatus: string): WbFbsBucket {
  const supplier = supplierStatus.trim().toLowerCase();
  const wb = wbStatus.trim().toLowerCase();
  if (["cancel", "reject", "cancel_client"].includes(supplier)) return "cancelled";
  if (["canceled", "canceled_by_client", "declined_by_client", "defect"].includes(wb)) return "cancelled";
  if (wb === "sold" || supplier === "receive") return "archive";
  if (["complete", "deliver"].includes(supplier)) return "delivering";
  if (["sorted", "ready_for_pickup", "dispatched_by_seller"].includes(wb)) return "delivering";
  if (supplier === "confirm") return "assembling";
  if (supplier === "new" || wb === "waiting") return "new";
  return "archive";
}

/* ---------------------------- сборочные задания ---------------------------- */

export interface WbFbsOrder {
  id: number;
  /** rid задания = srid статистики — по нему заказ опознаётся как FBS. */
  rid: string;
  createdAt: string | null;
  nmId: number;
  article: string;
  barcode: string;
  /** Цена продажи в рублях. WB отдаёт её умноженной на 100. */
  price: number | null;
  supplyId: string;
  deliveryType: string;
  warehouseId: number | null;
  /** Какие meta WB требует у этого задания (в т.ч. "sgtin" — код маркировки).
   *  null — WB не прислал поле, значит требование неизвестно. */
  requiredMeta: string[] | null;
}

interface RawOrder {
  id?: number;
  rid?: string;
  createdAt?: string;
  nmId?: number;
  article?: string;
  skus?: string[];
  price?: number;
  convertedPrice?: number;
  supplyId?: string;
  deliveryType?: string;
  warehouseId?: number;
  requiredMeta?: string[];
}

function normalizeOrder(raw: RawOrder): WbFbsOrder | null {
  const id = Number(raw.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const rawPrice = Number(raw.convertedPrice ?? raw.price ?? Number.NaN);
  return {
    id,
    rid: String(raw.rid ?? "").trim(),
    createdAt: raw.createdAt ?? null,
    nmId: Number.isFinite(Number(raw.nmId)) ? Number(raw.nmId) : 0,
    article: String(raw.article ?? "").trim(),
    barcode: Array.isArray(raw.skus) && raw.skus.length ? String(raw.skus[0] ?? "").trim() : "",
    price: Number.isFinite(rawPrice) ? rawPrice / 100 : null,
    supplyId: String(raw.supplyId ?? "").trim(),
    deliveryType: String(raw.deliveryType ?? "").trim(),
    warehouseId: Number.isFinite(Number(raw.warehouseId)) ? Number(raw.warehouseId) : null,
    requiredMeta: Array.isArray(raw.requiredMeta) ? raw.requiredMeta.map((item) => String(item)) : null,
  };
}

export interface FetchFbsOrdersOptions {
  fromMs: number;
  toMs: number;
  /** Сколько страниц по 1000 заданий максимум прочитать за прогон. */
  maxPages?: number;
  /** Момент, после которого дочитывать нельзя — вернём собранное с complete: false. */
  deadlineMs?: number;
}

export async function fetchFbsOrders(
  token: string,
  options: FetchFbsOrdersOptions,
): Promise<{ orders: WbFbsOrder[]; complete: boolean }> {
  const maxPages = Math.max(1, options.maxPages ?? 12);
  const limit = 1000;
  const orders: WbFbsOrder[] = [];
  let next = 0;
  for (let page = 0; page < maxPages; page++) {
    if (options.deadlineMs && Date.now() > options.deadlineMs) return { orders, complete: false };
    const query = new URLSearchParams({
      limit: String(limit),
      next: String(next),
      dateFrom: String(Math.floor(options.fromMs / 1000)),
      dateTo: String(Math.floor(options.toMs / 1000)),
    });
    const payload = await wbFbsJson<{ next?: number; orders?: RawOrder[] }>(token, {
      path: `/orders?${query}`,
      deadlineMs: options.deadlineMs,
    });
    const batch = Array.isArray(payload.orders) ? payload.orders : [];
    for (const raw of batch) {
      const order = normalizeOrder(raw);
      if (order) orders.push(order);
    }
    next = Number(payload.next ?? 0);
    if (batch.length < limit || !next) return { orders, complete: true };
  }
  return { orders, complete: false };
}

/* --------------------------------- статусы --------------------------------- */

export interface WbFbsOrderStatus {
  id: number;
  supplierStatus: string;
  wbStatus: string;
}

export async function fetchFbsOrderStatuses(
  token: string,
  ids: number[],
  options: { deadlineMs?: number } = {},
): Promise<{ statuses: Map<number, WbFbsOrderStatus>; complete: boolean }> {
  const statuses = new Map<number, WbFbsOrderStatus>();
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  for (let offset = 0; offset < unique.length; offset += 1000) {
    if (options.deadlineMs && Date.now() > options.deadlineMs) return { statuses, complete: false };
    const chunk = unique.slice(offset, offset + 1000);
    const payload = await wbFbsJson<{ orders?: { id?: number; supplierStatus?: string; wbStatus?: string }[] }>(token, {
      path: "/orders/status",
      method: "POST",
      body: { orders: chunk },
    });
    for (const row of payload.orders ?? []) {
      const id = Number(row.id);
      if (!Number.isFinite(id)) continue;
      statuses.set(id, {
        id,
        supplierStatus: String(row.supplierStatus ?? "").trim(),
        wbStatus: String(row.wbStatus ?? "").trim(),
      });
    }
  }
  return { statuses, complete: true };
}

/* ------------------------------ КИЗ у задания ------------------------------ */

export interface WbFbsOrderMeta {
  sgtin: string[];
  uin: string[];
  imei: string[];
  gtin: string[];
}

function metaValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

/** WB отдаёт meta (в т.ч. код маркировки) только по одному заданию за запрос. */
export async function fetchFbsOrderMeta(
  token: string,
  orderId: number,
  options: { deadlineMs?: number } = {},
): Promise<WbFbsOrderMeta> {
  const payload = await wbFbsJson<{ meta?: Record<string, unknown> }>(token, {
    path: `/orders/${orderId}/meta`,
    timeoutMs: 10_000,
    deadlineMs: options.deadlineMs,
    // «Кода нет» — это ответ, а не сбой.
    notFoundIsEmpty: true,
  });
  const meta = payload.meta ?? {};
  return {
    sgtin: metaValues(meta.sgtin),
    uin: metaValues(meta.uin),
    imei: metaValues(meta.imei),
    gtin: metaValues(meta.gtin),
  };
}

/* --------------------------- склады и остатки FBS --------------------------- */

export interface WbFbsWarehouse {
  id: number;
  name: string;
  officeId: number | null;
  cargoType: number | null;
  deliveryType: number | null;
}

export async function fetchFbsWarehouses(token: string): Promise<WbFbsWarehouse[]> {
  const payload = await wbFbsJson<
    { id?: number; name?: string; officeId?: number; cargoType?: number; deliveryType?: number }[]
  >(token, { path: "/warehouses" });
  if (!Array.isArray(payload)) return [];
  return payload
    .map((row) => ({
      id: Number(row.id),
      name: String(row.name ?? "").trim() || `Склад ${row.id ?? ""}`.trim(),
      officeId: Number.isFinite(Number(row.officeId)) ? Number(row.officeId) : null,
      cargoType: Number.isFinite(Number(row.cargoType)) ? Number(row.cargoType) : null,
      deliveryType: Number.isFinite(Number(row.deliveryType)) ? Number(row.deliveryType) : null,
    }))
    .filter((row) => Number.isFinite(row.id) && row.id > 0);
}

/**
 * Остатки склада продавца. WB отдаёт их только по явному списку баркодов
 * (максимум 1000 за запрос) — «весь склад» одним вызовом не спрашивается.
 */
export async function fetchFbsStocks(
  token: string,
  warehouseId: number,
  skus: string[],
  options: { deadlineMs?: number } = {},
): Promise<{ amounts: Map<string, number>; checked: number; complete: boolean }> {
  const amounts = new Map<string, number>();
  const unique = [...new Set(skus.map((sku) => sku.trim()).filter(Boolean))];
  let checked = 0;
  for (let offset = 0; offset < unique.length; offset += 1000) {
    if (options.deadlineMs && Date.now() > options.deadlineMs) return { amounts, checked, complete: false };
    const chunk = unique.slice(offset, offset + 1000);
    const payload = await wbFbsJson<{ stocks?: { sku?: string; amount?: number }[] }>(token, {
      path: `/stocks/${warehouseId}`,
      method: "POST",
      body: { skus: chunk },
    });
    for (const row of payload.stocks ?? []) {
      const sku = String(row.sku ?? "").trim();
      const amount = Number(row.amount);
      if (!sku || !Number.isFinite(amount)) continue;
      amounts.set(sku, amount);
    }
    checked += chunk.length;
  }
  return { amounts, checked, complete: true };
}
