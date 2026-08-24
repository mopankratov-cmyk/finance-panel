// Отчёт по маркированным товарам Wildberries.
//
// Он отвечает ровно на вопрос «какие коды проданы, а какие вернулись» — и, в
// отличие от сборочных заданий, помнит историю примерно на полгода назад. Это
// единственный найденный способ собрать список к выводу «за всё время», не
// заставляя человека выгружать эксели за каждые три дня.
//
// Три особенности метода, каждая из которых меняет то, как его звать:
//
//   1. Лимит 10 запросов за 5 часов на продавца. Значит окно берём большое:
//      полугодовой отрезок проглатывается одним запросом, и нарезать его на
//      недели — верный способ упереться в лимит на первом же кабинете.
//   2. Пагинации нет: всё окно приходит одним ответом.
//   3. dateFrom/dateTo фильтруют НЕ по дате чека. Запрос за неделю возвращает
//      строки с fiscal_dt заметно шире окна, поэтому границы берём с запасом, а
//      дубли снимаем по коду — на этом и держится корректность.

const URL_BASE = "https://seller-analytics-api.wildberries.ru/api/v1/analytics/excise-report";

export interface ExciseRow {
  /** Код идентификации, 31 символ — ровно тот формат, который нужен Честному Знаку. */
  code: string;
  /** 1 — вывод из оборота (продано), 2 — возврат в оборот. */
  operation: 1 | 2;
  srid: string | null;
  nmId: number | null;
  barcode: string | null;
  price: number | null;
  /** Дата фискального документа — она же дата продажи. */
  fiscalAt: string | null;
}

interface RawRow {
  excise_short?: string;
  operation_type_id?: number;
  srid?: string;
  nm_id?: number;
  barcode?: string;
  price?: number;
  fiscal_dt?: string;
}

export class ExciseRateLimitError extends Error {
  constructor() {
    super("Wildberries ограничивает отчёт по маркировке: 10 запросов за 5 часов. Подождите и повторите.");
    this.name = "ExciseRateLimitError";
  }
}

/**
 * Прочитать отчёт за период.
 * @param token токен кабинета со scope «Аналитика».
 */
export async function fetchExciseReport(
  token: string,
  from: string,
  to: string,
  options: { timeoutMs?: number } = {},
): Promise<ExciseRow[]> {
  const response = await fetch(
    `${URL_BASE}?dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`,
    {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      // Пустой список стран — все страны. Фильтровать здесь нечего: нас
      // интересует любой проданный код.
      body: JSON.stringify({ countries: [] }),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
    },
  );

  if (response.status === 429) throw new ExciseRateLimitError();
  if (!response.ok) {
    throw new Error(`Отчёт по маркировке: WB ответил ${response.status} ${(await response.text()).slice(0, 200)}`);
  }

  const payload = (await response.json()) as { response?: { data?: RawRow[] } } | RawRow[];
  const raw: RawRow[] = Array.isArray(payload)
    ? payload
    : payload?.response?.data ?? [];

  const rows: ExciseRow[] = [];
  for (const item of raw) {
    const code = String(item.excise_short ?? "").trim();
    // Строка без кода к выводу из оборота отношения не имеет.
    if (!code) continue;
    const operation = Number(item.operation_type_id);
    rows.push({
      code,
      operation: operation === 2 ? 2 : 1,
      srid: item.srid ? String(item.srid) : null,
      nmId: Number.isFinite(Number(item.nm_id)) && Number(item.nm_id) > 0 ? Number(item.nm_id) : null,
      barcode: item.barcode ? String(item.barcode) : null,
      price: Number.isFinite(Number(item.price)) ? Number(item.price) : null,
      fiscalAt: item.fiscal_dt ? String(item.fiscal_dt).slice(0, 10) : null,
    });
  }
  return rows;
}
