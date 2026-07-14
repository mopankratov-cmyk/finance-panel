import { retryAfterMs } from "@/lib/wb/funnelRequest";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface ReportRowLike {
  rrd_id?: unknown;
  rrdId?: unknown;
}

export interface WbReportPaginationOptions {
  token: string;
  dateFrom: string;
  dateTo: string;
  cacheKey?: string;
  initialRrdId?: number;
  limit?: number;
  maxPages?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

export interface WbReportPaginationResult<Row> {
  rows: Row[];
  lastRrdId: number;
  pages: number;
  complete: true;
}

const REPORT_URL = "https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

function rowRrdId(row: ReportRowLike): number {
  const value = Number(row.rrd_id ?? row.rrdId ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function pageCursor<Row>(rows: Row[]): number {
  return rows.reduce((maximum, row) => Math.max(maximum, rowRrdId(row as ReportRowLike)), 0);
}

async function requestReportPage<Row>(
  url: URL,
  options: WbReportPaginationOptions,
): Promise<Row[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxRetries = options.maxRetries ?? 3;
  const retryBaseMs = options.retryBaseMs ?? 1_000;
  let lastError = "WB не ответил";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchImpl(url, {
        headers: { Authorization: options.token },
        cache: "no-store",
      });
      if (response.ok) {
        const payload = await response.json();
        if (!Array.isArray(payload)) throw new Error("WB вернул некорректную страницу финансового отчёта");
        return payload as Row[];
      }
      const detail = (await response.text()).slice(0, 180);
      lastError = `WB ${response.status}: ${detail}`;
      if (!RETRYABLE.has(response.status) || attempt === maxRetries) break;
      const waitMs = response.status === 429
        ? retryAfterMs(response, retryBaseMs * 2 ** attempt)
        : retryBaseMs * 2 ** attempt;
      await sleep(waitMs);
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Ошибка сети WB";
      if (attempt === maxRetries) break;
      await sleep(retryBaseMs * 2 ** attempt);
    }
  }

  throw new Error(lastError);
}

/**
 * Полностью выгружает reportDetailByPeriod. Завершённым считается только проход,
 * дошедший до пустой страницы; короткая страница сама по себе не доказывает конец.
 */
export async function fetchWbReportPages<Row extends ReportRowLike = ReportRowLike>(
  options: WbReportPaginationOptions,
): Promise<WbReportPaginationResult<Row>> {
  const limit = options.limit ?? 100_000;
  const maxPages = options.maxPages ?? 1_000;
  let cursor = options.initialRrdId ?? 0;
  const rows: Row[] = [];
  const seen = new Set<number>();

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(REPORT_URL);
    url.searchParams.set("dateFrom", options.dateFrom);
    url.searchParams.set("dateTo", options.dateTo);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("rrdid", String(cursor));
    if (options.cacheKey) url.searchParams.set("_c", options.cacheKey);

    const chunk = await requestReportPage<Row>(url, options);
    if (chunk.length === 0) {
      return { rows, lastRrdId: cursor, pages: page + 1, complete: true };
    }

    for (const row of chunk) {
      const id = rowRrdId(row);
      if (id > 0) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      rows.push(row);
    }

    const next = pageCursor(chunk);
    if (!next || next <= cursor) {
      throw new Error(`WB финансовый отчёт неполон: курсор rrdid не продвинулся после ${cursor}`);
    }
    cursor = next;
  }

  throw new Error(`WB финансовый отчёт неполон: превышен лимит ${maxPages} страниц`);
}
