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
  const status: PaidStorageTaskStatus =
    raw === "done" ? "done"
    : raw === "processing" ? "processing"
    : raw === "purged" ? "purged"
    : raw === "canceled" ? "canceled"
    : "unknown";
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
