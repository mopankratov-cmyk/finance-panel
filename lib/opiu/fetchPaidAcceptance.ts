// Отчёт «Платная приёмка» — seller-analytics-api.wildberries.ru/api/v1/acceptance_report.
// Асинхронный, как «Платное хранение»: создаём задачу → опрашиваем статус → скачиваем.
// Лимит ~1 запрос/мин на создание задачи — кэшируем результат в памяти на несколько часов.

export interface PaidAcceptanceRow {
  date: string;       // shkCreateDate, YYYY-MM-DD
  nmId: number;
  incomeId: string;
  count: number;
  total: number;
}

interface PaidAcceptanceApiRow {
  nmID?: number;
  shkCreateDate?: string;
  incomeId?: string | number;
  count?: number;
  total?: number;
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

const BASE = "https://seller-analytics-api.wildberries.ru/api/v1/acceptance_report";
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 120_000;

async function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function createTask(dateFrom: string, dateTo: string, token: string): Promise<string | null> {
  const url = `${BASE}?dateFrom=${dateFrom}&dateTo=${dateTo}`;
  let retries429 = 0;
  while (true) {
    const res = await fetch(url, { headers: { Authorization: token }, cache: "no-store" });
    if (res.status === 429 && retries429 < 3) {
      retries429++;
      await sleep(60_000);
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[opiu] acceptance_report create HTTP", res.status, body.slice(0, 200));
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
  console.warn("[opiu] acceptance_report: таймаут ожидания отчёта", taskId);
  return false;
}

async function downloadReport(taskId: string, token: string): Promise<PaidAcceptanceRow[]> {
  const res = await fetch(`${BASE}/tasks/${taskId}/download`, {
    headers: { Authorization: token },
    cache: "no-store",
  });
  if (res.status === 204) return [];
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn("[opiu] acceptance_report download HTTP", res.status, body.slice(0, 200));
    return [];
  }
  const raw = (await res.json()) as PaidAcceptanceApiRow[] | { data?: PaidAcceptanceApiRow[] };
  const rows = Array.isArray(raw) ? raw : raw.data ?? [];
  return rows
    .filter((r) => r.nmID)
    .map((r) => ({
      date: String(r.shkCreateDate ?? "").slice(0, 10),
      nmId: Number(r.nmID),
      incomeId: String(r.incomeId ?? ""),
      count: Number(r.count ?? 0) || 0,
      total: Number(r.total ?? 0) || 0,
    }));
}

const _memo = new Map<string, { ts: number; rows: PaidAcceptanceRow[] }>();
const MEMO_TTL = 6 * 3600 * 1000;

export async function fetchPaidAcceptance(
  dateFrom: string,
  dateTo: string,
  refresh = false,
): Promise<PaidAcceptanceRow[]> {
  const key = `${dateFrom}|${dateTo}`;
  if (!refresh) {
    const hit = _memo.get(key);
    if (hit && Date.now() - hit.ts < MEMO_TTL) return hit.rows;
  }

  const token = analyticsToken();
  if (!token) {
    console.warn("[opiu] WB_TOKEN_ANALYTICS не настроен — платная приёмка будет 0");
    return [];
  }

  try {
    const taskId = await createTask(dateFrom, dateTo, token);
    if (!taskId) return [];
    const ready = await waitForReport(taskId, token);
    if (!ready) return [];
    const rows = await downloadReport(taskId, token);
    _memo.set(key, { ts: Date.now(), rows });
    return rows;
  } catch (err) {
    console.warn("[opiu] acceptance_report fetch error:", err);
    return [];
  }
}
