// Ozon Seller API. Авторизация — заголовки Client-Id + Api-Key. База api-seller.ozon.ru.
const BASE = "https://api-seller.ozon.ru";

export interface OzonCreds {
  clientId: string;
  apiKey: string;
}

export interface OzonRequestOptions {
  signal?: AbortSignal;
  cache?: RequestCache;
}

function financialFetchPolicy(
  options: OzonRequestOptions,
  revalidate: number,
): Pick<RequestInit, "cache" | "next"> {
  return options.cache === "no-store"
    ? { cache: "no-store" }
    : { next: { revalidate } };
}

function headers(c: OzonCreds): HeadersInit {
  return { "Client-Id": c.clientId.trim(), "Api-Key": c.apiKey.trim(), "Content-Type": "application/json" };
}

// fetch с таймаутом 20с — чтобы при стопоре сети/прокси не висеть минуту, а падать быстро.
function tfetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(20000);
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, timeoutSignal])
    : timeoutSignal;
  signal.throwIfAborted();
  return fetch(url, { ...opts, signal });
}

// Валидация ключа: лёгкий запрос финансовых итогов за 1 день. 200 → ключ рабочий.
export async function validateOzon(
  c: OzonCreds,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  if (!c.clientId?.trim() || !c.apiKey?.trim()) return { ok: false, error: "Укажите Client-Id и Api-Key" };
  const to = new Date();
  const from = new Date(Date.now() - 86400000);
  try {
    const res = await tfetch(`${BASE}/v3/finance/transaction/totals`, {
      method: "POST",
      headers: headers(c),
      body: JSON.stringify({ date: { from: from.toISOString(), to: to.toISOString() }, posting_number: "", transaction_type: "all" }),
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: `Ключ невалиден (${res.status})`, status: res.status };
    if (!res.ok) return { ok: false, error: `Ozon ответил ${res.status}`, status: res.status };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Сеть: ${String(e).slice(0, 80)}` };
  }
}

export interface OzonTotals {
  accruals_for_sale: number;
  sale_commission: number;
  processing_and_delivery: number;
  refunds_and_cancellations: number;
  services_amount: number;
  compensation_amount: number;
  money_transfer: number;
  others_amount: number;
}

// Итоги транзакций за период (аналог финотчёта WB): начислено/комиссия/логистика/услуги/возвраты.
export async function ozonTransactionTotals(
  c: OzonCreds, fromIso: string, toIso: string,
): Promise<{ ok: true; totals: OzonTotals } | { ok: false; error: string }> {
  try {
    const res = await tfetch(`${BASE}/v3/finance/transaction/totals`, {
      method: "POST",
      headers: headers(c),
      body: JSON.stringify({ date: { from: fromIso, to: toIso }, posting_number: "", transaction_type: "all" }),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return { ok: false, error: `Ozon ${res.status}: ${(await res.text()).slice(0, 120)}` };
    const j = (await res.json()) as { result?: OzonTotals };
    if (!j.result) return { ok: false, error: "Ozon не вернул result" };
    return { ok: true, totals: j.result };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
}

// analytics/data по SKU. ВАЖНО: метрики воронки (hits_view/hits_tocart/conv) доступны
// только в Ozon Premium Plus — без подписки Ozon молча выкидывает их из ответа, массив
// укорачивается и позиции съезжают (показы=заказы, в корзину=выручка, заказы/выручка=0).
// Поэтому просим только ordered_units+revenue (база, есть у всех); воронку отдаём нулями
// (недоступна) — это честно и чинит Воронку/Юнит/ОПиУ, которым нужны заказы/выручка.
export interface OzonAnalyticsRow {
  sku: string; name: string;
  hits_view: number; hits_tocart: number; ordered_units: number; revenue: number; conv: number;
}

export interface OzonAnalyticsDailyRow extends OzonAnalyticsRow {
  day: string;
}

type AnalyticsData = {
  dimensions: { id: string; name: string }[];
  metrics: number[];
};

async function analyticsPages(
  c: OzonCreds,
  dateFrom: string,
  dateTo: string,
  metrics: string[],
  dimension: string[],
  options: OzonRequestOptions = {},
): Promise<{ ok: true; data: AnalyticsData[] } | { ok: false; error: string }> {
  const data: AnalyticsData[] = [];
  try {
    for (let offset = 0; offset < 20_000; offset += 1000) {
      options.signal?.throwIfAborted();
      const res = await tfetch(`${BASE}/v1/analytics/data`, {
        method: "POST",
        headers: headers(c),
        body: JSON.stringify({ date_from: dateFrom, date_to: dateTo, metrics, dimension, limit: 1000, offset }),
        ...financialFetchPolicy(options, 1800),
        signal: options.signal,
      });
      if (!res.ok) return { ok: false, error: `Ozon ${res.status}: ${(await res.text()).slice(0, 120)}` };
      const json = (await res.json()) as { result?: { data?: AnalyticsData[] } };
      const batch = json.result?.data ?? [];
      data.push(...batch);
      if (batch.length < 1000) break;
    }
    return { ok: true, data };
  } catch (error) {
    if (options.signal?.aborted) {
      return { ok: false, error: "Запрос Ozon отменён" };
    }
    return { ok: false, error: String(error).slice(0, 120) };
  }
}

export async function ozonAnalytics(
  c: OzonCreds, dateFrom: string, dateTo: string,
): Promise<{ ok: true; rows: OzonAnalyticsRow[]; funnel: boolean } | { ok: false; error: string }> {
  const result = await analyticsPages(c, dateFrom, dateTo, ["ordered_units", "revenue"], ["sku"]);
  if (!result.ok) return result;
  return {
    ok: true,
    funnel: false,
    rows: result.data.map((row) => ({
      sku: row.dimensions[0]?.id ?? "",
      name: row.dimensions[0]?.name ?? "",
      ordered_units: Number(row.metrics[0] ?? 0),
      revenue: Number(row.metrics[1] ?? 0),
      hits_view: 0,
      hits_tocart: 0,
      conv: 0,
    })),
  };
}

// Посуточная аналитика для Ozon Cockpit. Сначала пробуем расширенную воронку.
// Если тариф Ozon вернул укороченный metrics[], повторяем запрос только с базовыми
// ordered_units/revenue — так позиции никогда не «съезжают» и данные остаются честными.
export async function ozonAnalyticsDaily(
  c: OzonCreds,
  dateFrom: string,
  dateTo: string,
  includeFunnel = false,
  options: OzonRequestOptions = {},
): Promise<{ ok: true; rows: OzonAnalyticsDailyRow[]; funnel: boolean } | { ok: false; error: string }> {
  if (options.signal?.aborted) {
    return { ok: false, error: "Запрос Ozon отменён" };
  }
  if (includeFunnel) {
    const expanded = await analyticsPages(
      c,
      dateFrom,
      dateTo,
      ["hits_view", "hits_tocart", "ordered_units", "revenue"],
      ["sku", "day"],
      options,
    );
    if (expanded.ok && expanded.data.length > 0 && expanded.data.every((row) => row.metrics.length >= 4)) {
      return {
        ok: true,
        funnel: true,
        rows: expanded.data.map((row) => ({
          sku: row.dimensions[0]?.id ?? "",
          name: row.dimensions[0]?.name ?? "",
          day: (row.dimensions[1]?.id || row.dimensions[1]?.name || "").slice(0, 10),
          hits_view: Number(row.metrics[0] ?? 0),
          hits_tocart: Number(row.metrics[1] ?? 0),
          ordered_units: Number(row.metrics[2] ?? 0),
          revenue: Number(row.metrics[3] ?? 0),
          conv: 0,
        })),
      };
    }
    if (!expanded.ok && options.signal?.aborted) return expanded;
  }

  options.signal?.throwIfAborted();
  const base = await analyticsPages(c, dateFrom, dateTo, ["ordered_units", "revenue"], ["sku", "day"], options);
  if (!base.ok) return base;
  return {
    ok: true,
    funnel: false,
    rows: base.data.map((row) => ({
      sku: row.dimensions[0]?.id ?? "",
      name: row.dimensions[0]?.name ?? "",
      day: (row.dimensions[1]?.id || row.dimensions[1]?.name || "").slice(0, 10),
      ordered_units: Number(row.metrics[0] ?? 0),
      revenue: Number(row.metrics[1] ?? 0),
      hits_view: 0,
      hits_tocart: 0,
      conv: 0,
    })),
  };
}

export interface OzonPosting {
  scheme: "FBO" | "FBS";
  postingNumber: string;
  orderNumber: string;
  status: string;
  createdAt: string;
  shipmentDate: string | null;
  warehouse: string | null;
  cancelReason: string | null;
  units: number;
  amount: number;
  products: { sku: string; offerId: string; name: string; quantity: number; price: number }[];
}

function postingFromUnknown(value: unknown, scheme: "FBO" | "FBS"): OzonPosting | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const rawProducts = Array.isArray(row.products) ? row.products : [];
  const products = rawProducts.map((product) => {
    const item = product as Record<string, unknown>;
    return {
      sku: String(item.sku ?? ""),
      offerId: String(item.offer_id ?? ""),
      name: String(item.name ?? item.offer_id ?? item.sku ?? "Товар"),
      quantity: Number(item.quantity ?? 0),
      price: Number(item.price ?? 0),
    };
  });
  const analytics = row.analytics_data && typeof row.analytics_data === "object"
    ? row.analytics_data as Record<string, unknown>
    : {};
  const cancellation = row.cancellation && typeof row.cancellation === "object"
    ? row.cancellation as Record<string, unknown>
    : {};
  const postingNumber = String(row.posting_number ?? "");
  if (!postingNumber) return null;
  return {
    scheme,
    postingNumber,
    orderNumber: String(row.order_number ?? row.order_id ?? postingNumber),
    status: String(row.status ?? "unknown"),
    createdAt: String(row.created_at ?? row.in_process_at ?? ""),
    shipmentDate: row.shipment_date ? String(row.shipment_date) : null,
    warehouse: analytics.warehouse_name
      ? String(analytics.warehouse_name)
      : analytics.warehouse_id
        ? String(analytics.warehouse_id)
        : null,
    cancelReason: cancellation.cancel_reason
      ? String(cancellation.cancel_reason)
      : cancellation.cancel_reason_id
        ? String(cancellation.cancel_reason_id)
        : null,
    units: products.reduce((sum, product) => sum + product.quantity, 0),
    amount: products.reduce((sum, product) => sum + product.price * product.quantity, 0),
    products,
  };
}

// Отправления FBO и FBS для операционного экрана. Ошибка одной схемы не скрывает
// вторую: вызывающая сторона получает частичный результат и список предупреждений.
export async function ozonPostings(
  c: OzonCreds,
  fromIso: string,
  toIso: string,
): Promise<{ postings: OzonPosting[]; errors: string[] }> {
  const postings: OzonPosting[] = [];
  const errors: string[] = [];

  const load = async (scheme: "FBO" | "FBS") => {
    for (let offset = 0; offset < 20_000; offset += 1000) {
      try {
        const path = scheme === "FBO" ? "/v2/posting/fbo/list" : "/v3/posting/fbs/list";
        const res = await tfetch(`${BASE}${path}`, {
          method: "POST",
          headers: headers(c),
          body: JSON.stringify({
            dir: "DESC",
            filter: { since: fromIso, to: toIso, status: "" },
            limit: 1000,
            offset,
            with: { analytics_data: true, financial_data: true },
          }),
          next: { revalidate: 600 },
        });
        if (!res.ok) {
          errors.push(`${scheme}: Ozon ${res.status}`);
          return;
        }
        const json = (await res.json()) as { result?: unknown };
        const result = json.result;
        const batch = Array.isArray(result)
          ? result
          : result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).postings)
            ? (result as Record<string, unknown>).postings as unknown[]
            : [];
        for (const item of batch) {
          const posting = postingFromUnknown(item, scheme);
          if (posting) postings.push(posting);
        }
        if (batch.length < 1000) return;
      } catch (error) {
        errors.push(`${scheme}: ${String(error).slice(0, 100)}`);
        return;
      }
    }
  };

  await Promise.all([load("FBO"), load("FBS")]);
  return { postings, errors };
}

// Цены/комиссии по SKU (для юнит-экономики).
export interface OzonPriceRow {
  offer_id: string; product_id: number; price: number; commissionPct: number;
  logistics: number; returnLogistics: number; acquiring: number;
}
export async function ozonPrices(
  c: OzonCreds,
  options: OzonRequestOptions = {},
): Promise<{ ok: true; rows: OzonPriceRow[] } | { ok: false; error: string }> {
  const rows: OzonPriceRow[] = [];
  try {
    let cursor = "";
    for (let page = 0; page < 20; page++) {
      options.signal?.throwIfAborted();
      const res = await tfetch(`${BASE}/v5/product/info/prices`, {
        method: "POST", headers: headers(c),
        body: JSON.stringify({ filter: { visibility: "ALL" }, limit: 1000, cursor }),
        ...financialFetchPolicy(options, 1800),
        signal: options.signal,
      });
      if (!res.ok) return { ok: false, error: `Ozon ${res.status}` };
      const j = (await res.json()) as {
        items?: { offer_id: string; product_id: number; acquiring?: number; price?: { price?: string | number }; commissions?: Record<string, number> }[];
        cursor?: string;
      };
      const items = j.items ?? [];
      for (const it of items) {
        const cm = it.commissions ?? {};
        rows.push({
          offer_id: it.offer_id, product_id: it.product_id,
          price: Number(it.price?.price ?? 0),
          commissionPct: Number(cm.sales_percent_fbo ?? cm.sales_percent_fbs ?? 0),
          logistics: Number(cm.fbo_deliv_to_customer_amount ?? 0) + Number(cm.fbo_direct_flow_trans_min_amount ?? 0),
          returnLogistics: Number(cm.fbo_return_flow_amount ?? 0),
          acquiring: Number(it.acquiring ?? 0),
        });
      }
      cursor = j.cursor ?? "";
      if (!items.length || !cursor) break;
    }
    return { ok: true, rows };
  } catch (e) {
    if (options.signal?.aborted) {
      return { ok: false, error: "Запрос Ozon отменён" };
    }
    return { ok: false, error: String(e).slice(0, 120) };
  }
}

// Остатки по складам.
export interface OzonStockRow { sku: number; article: string; name: string; warehouse: string; free: number; reserved: number }
export async function ozonStocks(
  c: OzonCreds,
): Promise<{ ok: true; rows: OzonStockRow[] } | { ok: false; error: string }> {
  const rows: OzonStockRow[] = [];
  try {
    for (let page = 0; page < 20; page++) {
      const res = await tfetch(`${BASE}/v2/analytics/stock_on_warehouses`, {
        method: "POST", headers: headers(c),
        body: JSON.stringify({ limit: 1000, offset: page * 1000, warehouse_type: "ALL" }),
        next: { revalidate: 1800 },
      });
      if (!res.ok) return { ok: false, error: `Ozon ${res.status}` };
      const j = (await res.json()) as { result?: { rows?: { sku: number; warehouse_name: string; item_code: string; item_name: string; free_to_sell_amount: number; reserved_amount: number }[] } };
      const batch = j.result?.rows ?? [];
      for (const r of batch) rows.push({
        sku: r.sku, article: r.item_code, name: r.item_name, warehouse: r.warehouse_name,
        free: Number(r.free_to_sell_amount ?? 0), reserved: Number(r.reserved_amount ?? 0),
      });
      if (batch.length < 1000) break;
    }
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
}

// Карта фото товаров: offer_id→url и каждый sku→url (sku берём из sources + top-level).
// Плюс skuToOffer: каждый sku → offer_id (для джойна остатков/себеса).
export async function ozonImages(
  c: OzonCreds,
): Promise<{ byOffer: Record<string, string>; bySku: Record<string, string>; skuToOffer: Record<string, string> }> {
  const byOffer: Record<string, string> = {};
  const bySku: Record<string, string> = {};
  const skuToOffer: Record<string, string> = {};
  try {
    // 1) все product_id
    const productIds: number[] = [];
    let lastId = "";
    for (let page = 0; page < 20; page++) {
      const res = await tfetch(`${BASE}/v3/product/list`, {
        method: "POST", headers: headers(c),
        body: JSON.stringify({ filter: { visibility: "ALL" }, limit: 1000, last_id: lastId }),
        next: { revalidate: 1800 },
      });
      if (!res.ok) break;
      const j = (await res.json()) as { result?: { items?: { product_id: number }[]; last_id?: string } };
      const items = j.result?.items ?? [];
      for (const it of items) productIds.push(it.product_id);
      lastId = j.result?.last_id ?? "";
      if (items.length < 1000 || !lastId) break;
    }
    // 2) инфо по батчам ≤1000
    for (let i = 0; i < productIds.length; i += 1000) {
      const batch = productIds.slice(i, i + 1000);
      const res = await tfetch(`${BASE}/v3/product/info/list`, {
        method: "POST", headers: headers(c),
        body: JSON.stringify({ product_id: batch }),
        next: { revalidate: 1800 },
      });
      if (!res.ok) break;
      const j = (await res.json()) as {
        items?: { offer_id: string; sku?: number; images?: string[]; sources?: { sku: number }[] }[];
      };
      for (const it of j.items ?? []) {
        const img = (it.images ?? [])[0];
        if (it.offer_id && it.sku) skuToOffer[String(it.sku)] = it.offer_id;
        for (const s of it.sources ?? []) if (s.sku && it.offer_id) skuToOffer[String(s.sku)] = it.offer_id;
        if (!img) continue;
        if (it.offer_id) byOffer[it.offer_id] = img;
        if (it.sku) bySku[String(it.sku)] = img;
        for (const s of it.sources ?? []) if (s.sku) bySku[String(s.sku)] = img;
      }
    }
  } catch {
    /* фото не критичны */
  }
  return { byOffer, bySku, skuToOffer };
}

// Детализация услуг (реклама/хранение/...) из transaction/list по operation_type.
export async function ozonServiceBreakdown(
  c: OzonCreds, fromIso: string, toIso: string,
): Promise<Record<string, number>> {
  const acc: Record<string, number> = {};
  try {
    for (let page = 1; page <= 20; page++) {
      const res = await tfetch(`${BASE}/v3/finance/transaction/list`, {
        method: "POST",
        headers: headers(c),
        body: JSON.stringify({ filter: { date: { from: fromIso, to: toIso }, transaction_type: "all" }, page, page_size: 1000 }),
        next: { revalidate: 3600 },
      });
      if (!res.ok) break;
      const j = (await res.json()) as { result?: { operations?: { services?: { name: string; price: number }[] }[]; page_count?: number } };
      const ops = j.result?.operations ?? [];
      for (const op of ops) for (const s of op.services ?? []) acc[s.name] = (acc[s.name] ?? 0) + Number(s.price ?? 0);
      if (!ops.length || page >= (j.result?.page_count ?? 1)) break;
    }
  } catch {
    /* ignore */
  }
  return acc;
}
