// Детализация отчёта о реализации Wildberries.
//
// Единственный найденный автоматический источник кодов маркировки ПРОДАННОГО —
// того, что ещё предстоит вывести из оборота. Соседний отчёт по маркированным
// товарам показывает уже совершённые операции и для FBS пуст: никто ещё не
// выводил. А здесь код лежит в строке продажи, вместе с ценой реализации.
//
// Особенности метода, влияющие на то, как его звать:
//   1. Только POST. На GET отвечает 405.
//   2. Лимит один запрос в минуту на продавца — не на кабинет.
//   3. Пагинация курсором rrdId: следующая страница начинается с последнего
//      значения предыдущей. Пустое тело ответа означает конец выборки.
//   4. Поле kiz — ПОЛНЫЙ код с криптохвостом. В Честный Знак идёт код
//      идентификации, первый 31 символ; хвост отрезает parseKizCode.

export interface SalesDetailRow {
  /** Полный код маркировки как отдал WB, с криптохвостом. */
  kiz: string;
  srid: string | null;
  nmId: number | null;
  /** «Продажа», «Возврат», «Логистика» и прочие операции отчёта. */
  operation: string;
  /** Способ доставки: у FBW заполнен, у продажи со склада продавца пуст. */
  deliveryMethod: string;
  price: number | null;
  saleAt: string | null;
  rrdId: number | null;
}

interface RawRow {
  kiz?: string;
  srid?: string;
  nmId?: number;
  sellerOperName?: string;
  deliveryMethod?: string;
  retailPriceWithdiscRub?: number;
  retailPrice?: number;
  saleDt?: string;
  rrdId?: number;
}

const URL_DETAIL = "https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed";

export interface SalesDetailPage {
  rows: SalesDetailRow[];
  /** Сколько строк вернул WB до фильтра по КИЗ: 0 — настоящий конец отчёта. */
  rawCount: number;
  /** Последний rrd_id СЫРОЙ страницы — только им можно двигать курсор. */
  lastRrdId: number | null;
}

export class SalesDetailRateLimitError extends Error {
  constructor() {
    super("Wildberries ограничивает детализацию реализации: один запрос в минуту на продавца.");
    this.name = "SalesDetailRateLimitError";
  }
}

/** Одна страница отчёта. Пустой массив означает, что выборка кончилась. */
export async function fetchSalesDetailPage(
  token: string,
  from: string,
  to: string,
  rrdid: number,
  options: { limit?: number; timeoutMs?: number } = {},
): Promise<SalesDetailPage> {
  let response: Response | null = null;
  // Сеть до WB рвётся регулярно, а страница стоит минуты ожидания лимита —
  // терять её из-за одного оборванного соединения расточительно.
  for (let attempt = 0; attempt < 3 && !response; attempt += 1) {
    try {
      response = await fetch(URL_DETAIL, {
        method: "POST",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom: from, dateTo: to, limit: options.limit ?? 100_000, rrdid }),
        cache: "no-store",
        signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
      });
    } catch {
      if (attempt === 2) throw new Error("Детализация реализации: соединение с WB оборвалось");
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
  }
  if (!response) return { rows: [], rawCount: 0, lastRrdId: null };
  if (response.status === 429) throw new SalesDetailRateLimitError();
  if (!response.ok) {
    throw new Error(`Детализация реализации: WB ответил ${response.status} ${(await response.text()).slice(0, 200)}`);
  }

  // Конец выборки WB обозначает пустым телом, а не пустым массивом.
  const text = await response.text();
  if (!text.trim()) return { rows: [], rawCount: 0, lastRrdId: null };
  const payload = JSON.parse(text) as RawRow[] | { data?: RawRow[] };
  const raw: RawRow[] = Array.isArray(payload) ? payload : payload?.data ?? [];

  // Курсор обязан двигаться по ПОСЛЕДНЕЙ СЫРОЙ строке страницы, а не по
  // последней распознанной. Строки без КИЗ (немаркируемый товар) парсер
  // отбрасывает, и страница из одних таких строк выглядела как конец
  // отчёта — обход останавливался, не дойдя до маркируемых товаров дальше.
  let lastRrdId: number | null = null;
  for (const item of raw) {
    const rid = Number(item.rrdId);
    if (Number.isFinite(rid)) lastRrdId = rid;
  }
  const rows: SalesDetailRow[] = [];
  for (const item of raw) {
    const kiz = String(item.kiz ?? "").trim();
    if (!kiz) continue;
    const price = Number(item.retailPriceWithdiscRub ?? item.retailPrice);
    rows.push({
      kiz,
      srid: item.srid ? String(item.srid) : null,
      nmId: Number.isFinite(Number(item.nmId)) && Number(item.nmId) > 0 ? Number(item.nmId) : null,
      operation: String(item.sellerOperName ?? ""),
      deliveryMethod: String(item.deliveryMethod ?? ""),
      price: Number.isFinite(price) ? price : null,
      saleAt: item.saleDt ? String(item.saleDt).slice(0, 10) : null,
      rrdId: Number.isFinite(Number(item.rrdId)) ? Number(item.rrdId) : null,
    });
  }
  return { rows, rawCount: raw.length, lastRrdId };
}

export const SALE_OPERATION = "Продажа";
export const RETURN_OPERATION = "Возврат";
