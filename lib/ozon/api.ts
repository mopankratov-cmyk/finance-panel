// Ozon Seller API. Авторизация — заголовки Client-Id + Api-Key. База api-seller.ozon.ru.
const BASE = "https://api-seller.ozon.ru";

export interface OzonCreds {
  clientId: string;
  apiKey: string;
}

function headers(c: OzonCreds): HeadersInit {
  return { "Client-Id": c.clientId.trim(), "Api-Key": c.apiKey.trim(), "Content-Type": "application/json" };
}

// Валидация ключа: лёгкий запрос финансовых итогов за 1 день. 200 → ключ рабочий.
export async function validateOzon(
  c: OzonCreds,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  if (!c.clientId?.trim() || !c.apiKey?.trim()) return { ok: false, error: "Укажите Client-Id и Api-Key" };
  const to = new Date();
  const from = new Date(Date.now() - 86400000);
  try {
    const res = await fetch(`${BASE}/v3/finance/transaction/totals`, {
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
    const res = await fetch(`${BASE}/v3/finance/transaction/totals`, {
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

// Воронка: analytics/data по SKU (показы, в корзину, заказы, выручка, конверсия).
export interface OzonAnalyticsRow {
  sku: string; name: string;
  hits_view: number; hits_tocart: number; ordered_units: number; revenue: number; conv: number;
}
export async function ozonAnalytics(
  c: OzonCreds, dateFrom: string, dateTo: string,
): Promise<{ ok: true; rows: OzonAnalyticsRow[] } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${BASE}/v1/analytics/data`, {
      method: "POST", headers: headers(c),
      body: JSON.stringify({
        date_from: dateFrom, date_to: dateTo,
        metrics: ["hits_view", "hits_tocart", "ordered_units", "revenue", "conv_tocart_pdp"],
        dimension: ["sku"], limit: 1000, offset: 0,
      }),
      next: { revalidate: 1800 },
    });
    if (!res.ok) return { ok: false, error: `Ozon ${res.status}: ${(await res.text()).slice(0, 120)}` };
    const j = (await res.json()) as { result?: { data?: { dimensions: { id: string; name: string }[]; metrics: number[] }[] } };
    const rows = (j.result?.data ?? []).map((d) => ({
      sku: d.dimensions[0]?.id ?? "", name: d.dimensions[0]?.name ?? "",
      hits_view: d.metrics[0] ?? 0, hits_tocart: d.metrics[1] ?? 0,
      ordered_units: d.metrics[2] ?? 0, revenue: d.metrics[3] ?? 0, conv: d.metrics[4] ?? 0,
    }));
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) };
  }
}

// Цены/комиссии по SKU (для юнит-экономики).
export interface OzonPriceRow {
  offer_id: string; product_id: number; price: number; commissionPct: number;
  logistics: number; returnLogistics: number; acquiring: number;
}
export async function ozonPrices(
  c: OzonCreds,
): Promise<{ ok: true; rows: OzonPriceRow[] } | { ok: false; error: string }> {
  const rows: OzonPriceRow[] = [];
  try {
    let cursor = "";
    for (let page = 0; page < 20; page++) {
      const res = await fetch(`${BASE}/v5/product/info/prices`, {
        method: "POST", headers: headers(c),
        body: JSON.stringify({ filter: { visibility: "ALL" }, limit: 1000, cursor }),
        next: { revalidate: 1800 },
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
      const res = await fetch(`${BASE}/v2/analytics/stock_on_warehouses`, {
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
      const res = await fetch(`${BASE}/v3/product/list`, {
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
      const res = await fetch(`${BASE}/v3/product/info/list`, {
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
      const res = await fetch(`${BASE}/v3/finance/transaction/list`, {
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
