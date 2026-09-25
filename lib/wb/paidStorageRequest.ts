// «Платное хранение» — асинхронный отчёт WB (seller-analytics-api), другой
// протокол, чем nm-report/downloads (lib/wb/syncRecovery.ts): здесь задача
// создаётся GET-запросом с параметрами в query, а не POST с телом.
const BASE_URL = "https://seller-analytics-api.wildberries.ru/api/v1/paid_storage";

export interface PaidStorageApiRow {
  date?: string;
  logWarehouseCoef?: number;
  officeId?: number;
  warehouse?: string;
  warehouseCoef?: number;
  giId?: number;
  chrtId?: number;
  size?: string;
  barcode?: string;
  subject?: string;
  brand?: string;
  vendorCode?: string;
  nmId?: number;
  volume?: number;
  calcType?: string;
  warehousePrice?: number;
  barcodesCount?: number;
}

export interface CompactPaidStorageRow extends Record<string, unknown> {
  id: string;
  cabinet_id: string;
  date: string;
  nm_id: number | null;
  vendor_code: string | null;
  warehouse_price: number;
  synced_at: string;
}

export function filterPaidStorageRowsByPrefixes(
  rows: readonly PaidStorageApiRow[],
  prefixes: readonly string[] | null,
): PaidStorageApiRow[] {
  if (!prefixes?.length) return [...rows];
  const normalized = prefixes.map((prefix) => prefix.trim().toUpperCase()).filter(Boolean);
  if (!normalized.length) return [...rows];
  return rows.filter((row) => {
    const vendorCode = String(row.vendorCode ?? "").trim().toUpperCase();
    return normalized.some((prefix) => vendorCode.startsWith(prefix));
  });
}

/** Добавляет по одной нулевой строке для дней, где нужных товаров не было. */
export function addPaidStorageCoverageRows(
  rows: readonly PaidStorageApiRow[],
  dateFrom: string,
  dateTo: string,
): PaidStorageApiRow[] {
  const result = [...rows];
  const coveredDates = new Set(rows.map((row) => String(row.date ?? "").slice(0, 10)).filter(Boolean));
  const cursor = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);

  while (Number.isFinite(cursor.getTime()) && cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    if (!coveredDates.has(date)) result.push({ date, warehousePrice: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

/**
 * ОПиУ использует из отчёта хранения только дату, товар/артикул и итоговую
 * сумму. WB при этом отдаёт отдельные проводки по складам, поставкам и видам
 * начисления — тысячи строк на один день. Сворачиваем их до «день × nmId ×
 * артикул» ещё до записи в Supabase: сумма для ОПиУ и маржи по артикулам не
 * меняется, а число upsert-строк и объём таблицы уменьшаются на порядок.
 *
 * Нулевая агрегированная строка намеренно сохраняется: её наличие отличает
 * «источник синхронизирован, хранение = 0» от «данные ещё не загружены».
 */
export function compactPaidStorageRows(
  cabinetId: string,
  rows: readonly PaidStorageApiRow[],
  syncedAt = new Date().toISOString(),
): CompactPaidStorageRow[] {
  const grouped = new Map<string, CompactPaidStorageRow>();

  for (const row of rows) {
    const date = String(row.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const parsedNmId = Number(row.nmId);
    const nmId = Number.isFinite(parsedNmId) && parsedNmId > 0 ? parsedNmId : null;
    const vendorCode = String(row.vendorCode ?? "").trim() || null;
    const vendorKey = vendorCode?.toUpperCase() ?? "";
    const key = [date, nmId ?? "", vendorKey].join("|");
    const warehousePrice = Number(row.warehousePrice ?? 0);
    const amount = Number.isFinite(warehousePrice) ? warehousePrice : 0;
    const existing = grouped.get(key);

    if (existing) {
      existing.warehouse_price += amount;
      continue;
    }

    grouped.set(key, {
      id: [cabinetId, "daily", key].join("|"),
      cabinet_id: cabinetId,
      date,
      nm_id: nmId,
      vendor_code: vendorCode,
      warehouse_price: amount,
      synced_at: syncedAt,
    });
  }

  return [...grouped.values()];
}

// Без таймаута зависший fetch к WB съедал весь бюджет функции молча — не
// давая коду вообще дойти до проверки SOFT_BUDGET_MS (та смотрит на часы
// ТОЛЬКО между запросами, не может прервать уже идущий запрос). Реальный
// 504 (FUNCTION_INVOCATION_TIMEOUT) на проде вероятнее всего был именно
// таким зависанием одного запроса, а не медленным поллингом в целом.
const REQUEST_TIMEOUT_MS = 20_000;
// Скачивание готового отчёта — самый тяжёлый по объёму запрос (крупные
// кабинеты вроде общего Retail Family дают заметно больше строк, чем
// отдельные ИП), и именно на нём наблюдалось зависание/обрыв. Отдельный,
// более щедрый таймаут — чтобы не резать честно работающий, просто долгий
// запрос под ту же метку "20с и точка", что годится для лёгких create/status.
const DOWNLOAD_TIMEOUT_MS = 45_000;

async function wbRequest(url: string, token: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { Authorization: token },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Создаёт задачу на отчёт за период; WB отвечает taskId, сам отчёт готовится асинхронно. */
export async function createPaidStorageTask(
  token: string,
  dateFrom: string,
  dateTo: string,
): Promise<{ ok: true; taskId: string } | { ok: false; status: number; body: string }> {
  const url = new URL(BASE_URL);
  url.searchParams.set("dateFrom", dateFrom);
  url.searchParams.set("dateTo", dateTo);
  const res = await wbRequest(url.toString(), token);
  if (!res.ok) return { ok: false, status: res.status, body: (await res.text()).slice(0, 200) };
  const json = (await res.json()) as { data?: { taskId?: string } };
  const taskId = json.data?.taskId;
  if (!taskId) return { ok: false, status: res.status, body: "ответ WB без taskId" };
  return { ok: true, taskId };
}

export type PaidStorageTaskStatus = "processing" | "done" | "purged" | "canceled" | "unknown";

export function normalizePaidStorageTaskStatus(rawStatus: string): PaidStorageTaskStatus {
  const raw = rawStatus.toLowerCase().trim();
  // Сразу после создания WB реально отвечает `new`; это ожидающая обработки
  // задача, а не неизвестная ошибка. На следующих проверках она переходит в
  // `processing`, затем в `done`.
  if (raw === "new" || raw === "processing") return "processing";
  if (raw === "done") return "done";
  if (raw === "purged") return "purged";
  if (raw === "canceled") return "canceled";
  return "unknown";
}

/**
 * WB удаляет асинхронные отчёты через некоторое время. Для уже удалённой
 * задачи status/download отвечает HTTP 404, а не статусом `purged`.
 * Такой taskId нужно забыть и создать отчёт заново, иначе синк будет вечно
 * опрашивать один и тот же отсутствующий id.
 */
export function isMissingPaidStorageTask(status: number, body: string): boolean {
  return status === 404 && /not[ -]?found|не найден/i.test(body);
}

export async function checkPaidStorageTaskStatus(
  token: string,
  taskId: string,
): Promise<{ ok: true; status: PaidStorageTaskStatus; rawStatus: string } | { ok: false; status: number; body: string }> {
  const res = await wbRequest(`${BASE_URL}/tasks/${taskId}/status`, token);
  if (!res.ok) return { ok: false, status: res.status, body: (await res.text()).slice(0, 200) };
  const bodyText = await res.text();
  let json: { data?: { status?: string } } = {};
  try {
    json = JSON.parse(bodyText);
  } catch {
    // Тело не JSON — ниже это тоже уйдёт в rawStatus для диагностики.
  }
  const raw = String(json.data?.status ?? bodyText).toLowerCase().trim();
  const status = normalizePaidStorageTaskStatus(raw);
  return { ok: true, status, rawStatus: raw.slice(0, 200) };
}

export async function downloadPaidStorageTask(
  token: string,
  taskId: string,
): Promise<{ ok: true; rows: PaidStorageApiRow[] } | { ok: false; status: number; body: string }> {
  const res = await wbRequest(`${BASE_URL}/tasks/${taskId}/download`, token, DOWNLOAD_TIMEOUT_MS);
  if (!res.ok) return { ok: false, status: res.status, body: (await res.text()).slice(0, 200) };
  const rows = (await res.json()) as PaidStorageApiRow[];
  return { ok: true, rows: Array.isArray(rows) ? rows : [] };
}
