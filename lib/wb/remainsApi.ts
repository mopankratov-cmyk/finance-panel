// Остатки по складам WB: отчёт seller-analytics «warehouse_remains».
//
// История источников разбивки остатков по складам:
// 1. statistics-api /supplier/stocks — выпилен WB (404 deprecated, release-notes id=494).
// 2. seller-analytics stocks-report/wb-warehouses — с конца августа 2026 отдаёт
//    только агрегат warehouseId=-999999 «Склад WB» без разбивки по складам.
// 3. warehouse_remains — единственный живой источник разбивки. Отчёт задачный:
//    создать задачу → дождаться статуса done → скачать готовый файл.

import { WbStocksApiError } from "./stocksApi";

export const WB_WAREHOUSE_REMAINS_URL =
  "https://seller-analytics-api.wildberries.ru/api/v1/warehouse_remains";

// Псевдосклады отчёта. «Всего…» — сумма всех складских строк артикула: хранить её
// в складском разрезе значит считать каждый остаток дважды. Строки «в пути» — не
// остаток на складе, а количество в пути на весь артикул; их место — в колонках
// in_way_*, одной строкой с нулевым остатком, чтобы сумма quantity по складам
// оставалась честной. «Склад WB РФ» псевдоскладом НЕ считается: это дизъюнктная
// компонента (товар в пути между складами WB), входящая в «Всего…».
export const WB_REMAINS_TOTAL = "Всего находится на складах";
export const WB_REMAINS_TO_CLIENT = "В пути до получателей";
export const WB_REMAINS_FROM_CLIENT = "В пути возвраты на склад WB";

export interface WbRemainsWarehouse {
  warehouseName: string;
  quantity: number;
}

export interface WbRemainsRow {
  nmId: number;
  warehouses?: WbRemainsWarehouse[] | null;
}

export interface WbStockAggregate {
  nm_id: number;
  warehouse: string;
  quantity: number;
  in_way_to_client: number;
  in_way_from_client: number;
}

// Разворачивает отчёт в строки wb_stocks: реальные склады несут quantity,
// псевдостроки «в пути» — только свои колонки, агрегат «Всего…» отбрасывается.
export function remainsToStockRows(rows: readonly WbRemainsRow[]): WbStockAggregate[] {
  const agg = new Map<string, WbStockAggregate>();
  for (const row of rows) {
    const nm_id = row.nmId;
    if (!Number.isInteger(nm_id) || nm_id <= 0) continue;
    for (const wh of row.warehouses ?? []) {
      const warehouse = wh?.warehouseName?.trim();
      if (!warehouse || warehouse === WB_REMAINS_TOTAL) continue;
      const quantity = Number(wh.quantity ?? 0) || 0;
      const key = `${nm_id}|${warehouse}`;
      const cur = agg.get(key) ?? { nm_id, warehouse, quantity: 0, in_way_to_client: 0, in_way_from_client: 0 };
      if (warehouse === WB_REMAINS_TO_CLIENT) cur.in_way_to_client += quantity;
      else if (warehouse === WB_REMAINS_FROM_CLIENT) cur.in_way_from_client += quantity;
      else cur.quantity += quantity;
      agg.set(key, cur);
    }
  }
  return [...agg.values()];
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface WarehouseRemainsOptions {
  token: string;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxStatusPolls?: number;
}

function retryDelayMs(response: Response, fallbackMs: number): number {
  // WB на этом эндпоинте кладёт время ожидания в X-RateLimit-Retry (секунды),
  // а не в стандартный Retry-After — читаем оба, слепой fallback только затем.
  const raw = response.headers.get("retry-after") ?? response.headers.get("x-ratelimit-retry");
  const seconds = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : fallbackMs;
}

async function requestJson<T>(
  url: string,
  options: { fetchImpl: FetchLike; sleep: (ms: number) => Promise<void>; token: string },
): Promise<T> {
  const init: RequestInit = {
    method: "GET",
    headers: { Authorization: options.token },
    cache: "no-store",
  };
  let response = await options.fetchImpl(url, init);
  // Лимит warehouse_remains действует на аккаунт продавца: один повтор спасает,
  // когда ручной запуск пересёкся с cron.
  if (response.status === 429) {
    await options.sleep(retryDelayMs(response, 60_000));
    response = await options.fetchImpl(url, init);
  }
  if (!response.ok) {
    const message = (await response.text()).slice(0, 240);
    throw new WbStocksApiError(response.status, message || response.statusText);
  }
  return (await response.json()) as T;
}

export async function fetchWarehouseRemains(options: WarehouseRemainsOptions): Promise<WbRemainsRow[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  const maxStatusPolls = options.maxStatusPolls ?? 36;
  const ctx = { fetchImpl, sleep, token: options.token };

  const created = await requestJson<{ data?: { taskId?: string } }>(
    `${WB_WAREHOUSE_REMAINS_URL}?groupByNm=true`,
    ctx,
  );
  const taskId = created.data?.taskId;
  if (!taskId) throw new WbStocksApiError(200, "WB не вернул taskId отчёта warehouse_remains");

  for (let attempt = 0; ; attempt++) {
    if (attempt >= maxStatusPolls) {
      throw new WbStocksApiError(408, `отчёт warehouse_remains не готов за ${maxStatusPolls} проверок`);
    }
    await sleep(pollIntervalMs);
    const status = await requestJson<{ data?: { status?: string } }>(
      `${WB_WAREHOUSE_REMAINS_URL}/tasks/${taskId}/status`,
      ctx,
    );
    const state = status.data?.status ?? "unknown";
    if (state === "done") break;
    if (state !== "new" && state !== "processing") {
      throw new WbStocksApiError(200, `отчёт warehouse_remains завершился статусом «${state}»`);
    }
  }

  const report = await requestJson<WbRemainsRow[]>(
    `${WB_WAREHOUSE_REMAINS_URL}/tasks/${taskId}/download`,
    ctx,
  );
  if (!Array.isArray(report)) {
    throw new WbStocksApiError(200, "WB вернул некорректный отчёт warehouse_remains: ожидался массив");
  }
  return report;
}
