// Отчёт «Платное хранение» — seller-analytics-api.wildberries.ru/api/v1/paid_storage.
// Асинхронный: создаём задачу → опрашиваем статус → скачиваем. Лимит ~1 запрос/мин на
// создание задачи, поэтому результат кэшируется в памяти на несколько часов (аналогично
// _memo в lib/wb/commissions.ts) — иначе каждый рефреш страницы пересоздавал бы задачу.

export interface PaidStorageRow {
  date: string;      // YYYY-MM-DD
  nmId: number;
  barcode: string;
  warehousePrice: number;
  barcodesCount: number;
}

interface PaidStorageApiRow {
  date?: string;
  nmId?: number;
  barcode?: string;
  warehousePrice?: number;
  barcodesCount?: number;
  [key: string]: unknown;
}

function analyticsToken(): string {
  return (
    process.env.WB_TOKEN_ANALYTICS ??
    process.env.WB_STATS_TOKEN ??
    process.env.WB_TOKEN_STATISTICS ??
    ""
  );
}

const BASE = "https://seller-analytics-api.wildberries.ru/api/v1/paid_storage";
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 120_000;

async function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function createTask(dateFrom: string, dateTo: string, token: string): Promise<string | null> {
  const url = `${BASE}?dateFrom=${dateFrom}&dateTo=${dateTo}`;
  let retries429 = 0;
  while (true) {
    const res = await fetch(url, {
      headers: { Authorization: token },
      cache: "no-store",
    });
    if (res.status === 429 && retries429 < 3) {
      retries429++;
      await sleep(60_000);
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[opiu] paid_storage create HTTP", res.status, body.slice(0, 200));
      return null;
    }
    const data = (await res.json()) as { data?: { taskId?: string } };
    return data.data?.taskId ?? null;
  }
}

async function waitForReport(taskId: string, token: string): Promise<boolean> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/tasks/${taskId}/status`, {
      headers: { Authorization: token },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { data?: { status?: string } };
    const status = data.data?.status;
    if (status === "done") return true;
    if (status === "canceled" || status === "purged") return false;
    await sleep(POLL_INTERVAL_MS);
  }
  console.warn("[opiu] paid_storage: таймаут ожидания отчёта", taskId);
  return false;
}

async function downloadReport(taskId: string, token: string): Promise<PaidStorageRow[]> {
  const res = await fetch(`${BASE}/tasks/${taskId}/download`, {
    headers: { Authorization: token },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn("[opiu] paid_storage download HTTP", res.status, body.slice(0, 200));
    return [];
  }
  const rows = (await res.json()) as PaidStorageApiRow[];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r.nmId)
    .map((r) => ({
      date: String(r.date ?? "").slice(0, 10),
      nmId: Number(r.nmId),
      barcode: String(r.barcode ?? ""),
      warehousePrice: Number(r.warehousePrice ?? 0) || 0,
      barcodesCount: Number(r.barcodesCount ?? 0) || 0,
    }));
}

const _memo = new Map<string, { ts: number; rows: PaidStorageRow[] }>();
const MEMO_TTL = 6 * 3600 * 1000;

export async function fetchPaidStorage(
  dateFrom: string,
  dateTo: string,
  refresh = false,
): Promise<PaidStorageRow[]> {
  const key = `${dateFrom}|${dateTo}`;
  if (!refresh) {
    const hit = _memo.get(key);
    if (hit && Date.now() - hit.ts < MEMO_TTL) return hit.rows;
  }

  const token = analyticsToken();
  if (!token) {
    console.warn("[opiu] WB_TOKEN_ANALYTICS не настроен — платное хранение будет 0");
    return [];
  }

  try {
    const taskId = await createTask(dateFrom, dateTo, token);
    if (!taskId) return [];
    const ready = await waitForReport(taskId, token);
    if (!ready) return [];
    const rows = await downloadReport(taskId, token);
    if (rows.length > 0) _memo.set(key, { ts: Date.now(), rows });
    return rows;
  } catch (err) {
    console.warn("[opiu] paid_storage fetch error:", err);
    return [];
  }
}
