export interface WbAccountBalance {
  currency: string;
  current: number;
  forWithdraw: number;
}

export interface WbFinanceReportSummary {
  reportId: string;
  periodFrom: string;
  periodTo: string;
  createDate: string | null;
  forPaySum: number | null;
  bankPaymentSum: number | null;
  currency: string;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const dateOnly = (value: unknown): string | null => {
  const result = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
};

const money = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(result) ? Math.round(result * 100) / 100 : null;
};

/** Список итогов еженедельных отчётов реализации. */
export async function fetchWbFinanceReportSummaries(
  token: string,
  dateFrom: string,
  dateTo: string,
  options: { fetchImpl?: FetchLike; retries?: number } = {},
): Promise<WbFinanceReportSummary[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 2;
  const limit = 100;
  const result: WbFinanceReportSummary[] = [];

  for (let offset = 0; ; offset += limit) {
    let response: Response | null = null;
    for (let attempt = 0; ; attempt += 1) {
      response = await fetchImpl("https://finance-api.wildberries.ru/api/finance/v1/sales-reports/list", {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo, limit, offset, period: "weekly" }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 429 && attempt < retries) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await delay(Number.isFinite(retryAfter) ? Math.min(30_000, retryAfter * 1_000) : 5_000 * (attempt + 1));
        continue;
      }
      break;
    }
    if (!response || response.status === 204) break;
    if (!response.ok) throw new Error(`WB Finance reports ${response.status}: ${(await response.text()).slice(0, 160)}`);
    const payload = await response.json() as unknown;
    if (!Array.isArray(payload)) throw new Error("WB Finance вернул список отчётов в неизвестном формате");
    for (const raw of payload) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const reportId = String(row.reportId ?? row.report_id ?? row.realizationreport_id ?? "").trim();
      const periodFrom = dateOnly(row.dateFrom ?? row.date_from);
      const periodTo = dateOnly(row.dateTo ?? row.date_to);
      if (!reportId || !periodFrom || !periodTo) continue;
      result.push({
        reportId,
        periodFrom,
        periodTo,
        createDate: dateOnly(row.createDate ?? row.create_date),
        forPaySum: money(row.forPaySum ?? row.for_pay_sum),
        bankPaymentSum: money(row.bankPaymentSum ?? row.bank_payment_sum),
        currency: String(row.currency ?? "RUB"),
      });
    }
    if (payload.length < limit) break;
  }
  return result;
}

/** Баланс из виджета «Главная» кабинета WB. Лимит метода — один запрос в минуту. */
export async function fetchWbAccountBalance(
  token: string,
  options: { fetchImpl?: FetchLike; retries?: number } = {},
): Promise<WbAccountBalance> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 2;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl("https://finance-api.wildberries.ru/api/v1/account/balance", {
      headers: { Authorization: token },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 429 && attempt < retries) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await delay(Number.isFinite(retryAfter) ? Math.min(30_000, retryAfter * 1_000) : 5_000 * (attempt + 1));
      continue;
    }
    if (!response.ok) throw new Error(`WB Finance ${response.status}: ${(await response.text()).slice(0, 160)}`);
    const body = await response.json() as { currency?: unknown; current?: unknown; for_withdraw?: unknown };
    const current = Number(body.current);
    const forWithdraw = Number(body.for_withdraw);
    if (!Number.isFinite(current) || !Number.isFinite(forWithdraw)) throw new Error("WB Finance вернул баланс в неизвестном формате");
    return { currency: String(body.currency || "RUB"), current, forWithdraw };
  }
}
