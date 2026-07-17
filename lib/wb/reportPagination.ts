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
  period?: "daily" | "weekly";
  fields?: string[];
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

export interface WbReportPaginationResult<Row> {
  rows: Row[];
  lastRrdId: number;
  pages: number;
  complete: true;
}

const REPORT_URL = "https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

// Новый Finance API использует camelCase и строковые денежные поля. Остальной
// финансовый контур пока читает прежние snake_case-имена, поэтому нормализуем
// ответ на границе интеграции и одновременно сохраняем исходные поля.
const LEGACY_FIELD_ALIASES = {
  reportId: "realizationreport_id",
  dateFrom: "date_from",
  dateTo: "date_to",
  createDate: "create_dt",
  orderDt: "order_dt",
  saleDt: "sale_dt",
  rrDate: "rr_dt",
  rrdId: "rrd_id",
  nmId: "nm_id",
  subjectName: "subject_name",
  brandName: "brand_name",
  vendorCode: "sa_name",
  docTypeName: "doc_type_name",
  retailPrice: "retail_price",
  retailAmount: "retail_amount",
  retailPriceWithDisc: "retail_price_withdisc_rub",
  commissionPercent: "commission_percent",
  ppvzSalesCommission: "ppvz_sales_commission",
  deliveryService: "delivery_rub",
  forPay: "ppvz_for_pay",
  sellerOperName: "supplier_oper_name",
  sku: "barcode",
  officeName: "office_name",
  rebillLogisticCost: "rebill_logistic_cost",
  paidStorage: "storage_fee",
  additionalPayment: "additional_payment",
  paidAcceptance: "acceptance",
  acquiringFee: "acquiring_fee",
  bonusTypeName: "bonus_type_name",
} as const;

function normalizeReportRow<Row>(row: Row): Row {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const normalized = { ...(row as Record<string, unknown>) };
  for (const [current, legacy] of Object.entries(LEGACY_FIELD_ALIASES)) {
    if (normalized[legacy] === undefined && normalized[current] !== undefined) {
      normalized[legacy] = normalized[current];
    }
  }
  return normalized as Row;
}

function rowRrdId(row: ReportRowLike): number {
  const value = Number(row.rrd_id ?? row.rrdId ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function pageCursor<Row>(rows: Row[]): number {
  return rows.reduce((maximum, row) => Math.max(maximum, rowRrdId(row as ReportRowLike)), 0);
}

async function requestReportPage<Row>(
  cursor: number,
  limit: number,
  options: WbReportPaginationOptions,
): Promise<Row[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxRetries = options.maxRetries ?? 3;
  const retryBaseMs = options.retryBaseMs ?? 1_000;
  let lastError = "WB не ответил";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchImpl(REPORT_URL, {
        method: "POST",
        headers: { Authorization: options.token, "Content-Type": "application/json" },
        body: JSON.stringify({
          dateFrom: options.dateFrom,
          dateTo: options.dateTo,
          limit,
          rrdId: cursor,
          period: options.period ?? "weekly",
          ...(options.fields?.length ? { fields: options.fields } : {}),
        }),
        cache: "no-store",
      });
      // С декабря 2025 года WB завершает пагинацию именно пустым 204, а не
      // JSON-массивом []. У 204 нет тела, поэтому response.json() всегда падает.
      if (response.status === 204) return [];
      if (response.ok) {
        const text = await response.text();
        if (!text.trim()) throw new Error("WB вернул пустой ответ финансового отчёта с HTTP 200");
        const payload = JSON.parse(text) as unknown;
        if (!Array.isArray(payload)) throw new Error("WB вернул некорректную страницу финансового отчёта");
        return payload.map((row) => normalizeReportRow(row as Row));
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
 * Полностью выгружает детализацию финансового отчёта WB через актуальный Finance
 * API. Завершённым считается только проход, дошедший до 204; короткая страница
 * сама по себе не доказывает конец.
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
    const chunk = await requestReportPage<Row>(cursor, limit, options);
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
