/**
 * Плоские строки под таблицу ozon_accrual_rows — из ответа
 * /v1/finance/accrual/by-day. Чистая функция: никакого I/O, весь разбор из
 * реально захваченного во время разведки API JSON (см. docs/superpowers/plans
 * /2026-09-24-ozon-accrual-sync.md).
 */

/** Нет SKU у строки (NON_ITEM — платёж не по конкретному товару). */
export const OZON_ACCRUAL_NO_SKU = "-";

/**
 * У блока `commission` внутри posting.products[] нет своего type_id — это не
 * список услуг, а экономика продажи одной строкой. sale_commission по смыслу
 * — ровно категория "SaleCommission" (id 69) из /v1/finance/accrual/types.
 */
export const OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID = 69;

interface RawMoney {
  amount?: string | number;
  currency?: string;
}

interface RawService {
  type_id: number;
  accrued?: RawMoney;
}

interface RawItemFeeEntry {
  sku?: number | string;
  quantity?: number;
  fees?: { type_id: number; accrued?: RawMoney }[];
}

interface RawCommission {
  seller_price?: RawMoney;
  sale_price?: RawMoney;
  sale_commission?: RawMoney;
  commission?: RawMoney;
  commission_ratio?: string;
  sale_amount?: RawMoney;
  coinvestment?: RawMoney;
  bonus?: RawMoney;
}

interface RawProduct {
  sku?: number | string;
  quantity?: number;
  delivery?: { total_accrued?: RawMoney; services?: RawService[] };
  commission?: RawCommission | null;
}

export interface OzonRawAccrual {
  accrual_id: number;
  date: string;
  total_amount?: RawMoney;
  unit_number?: string | null;
  accrued_category: string;
  posting?: { delivery_schema?: string; products?: RawProduct[] } | null;
  item_fees?: { fees?: RawItemFeeEntry[] } | null;
  non_item_fee?: { type_id: number; accrued?: RawMoney } | null;
  container_fees?: unknown;
}

export interface OzonAccrualRow {
  accrual_id: number;
  date: string;
  unit_number: string | null;
  accrued_category: string;
  currency: string;
  sku: string;
  type_id: number;
  amount: number;
  quantity: number | null;
  extra: Record<string, number | string | null> | null;
}

function moneyAmount(money: RawMoney | undefined): number {
  const value = Number(money?.amount ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function skuText(sku: number | string | undefined): string {
  return sku !== undefined && sku !== null && sku !== "" ? String(sku) : OZON_ACCRUAL_NO_SKU;
}

export function flattenOzonAccrual(raw: OzonRawAccrual): OzonAccrualRow[] {
  const rows: OzonAccrualRow[] = [];
  const base = {
    accrual_id: raw.accrual_id,
    date: raw.date,
    unit_number: raw.unit_number ?? null,
    accrued_category: raw.accrued_category,
    currency: raw.total_amount?.currency ?? "RUB",
  };

  for (const product of raw.posting?.products ?? []) {
    const sku = skuText(product.sku);
    for (const service of product.delivery?.services ?? []) {
      rows.push({
        ...base,
        sku,
        type_id: service.type_id,
        amount: moneyAmount(service.accrued),
        quantity: product.quantity ?? null,
        extra: null,
      });
    }
    if (product.commission) {
      const commission = product.commission;
      rows.push({
        ...base,
        sku,
        type_id: OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID,
        amount: moneyAmount(commission.sale_commission ?? commission.commission),
        quantity: product.quantity ?? null,
        extra: {
          seller_price: moneyAmount(commission.seller_price),
          sale_price: moneyAmount(commission.sale_price),
          sale_amount: moneyAmount(commission.sale_amount),
          coinvestment: moneyAmount(commission.coinvestment),
          bonus: moneyAmount(commission.bonus),
          commission_ratio: commission.commission_ratio ?? null,
        },
      });
    }
  }

  for (const entry of raw.item_fees?.fees ?? []) {
    const sku = skuText(entry.sku);
    for (const fee of entry.fees ?? []) {
      rows.push({
        ...base,
        sku,
        type_id: fee.type_id,
        amount: moneyAmount(fee.accrued),
        quantity: entry.quantity ?? null,
        extra: null,
      });
    }
  }

  if (raw.non_item_fee) {
    rows.push({
      ...base,
      sku: OZON_ACCRUAL_NO_SKU,
      type_id: raw.non_item_fee.type_id,
      amount: moneyAmount(raw.non_item_fee.accrued),
      quantity: null,
      extra: null,
    });
  }

  return mergeDuplicateAccrualRows(rows);
}

/**
 * `(accrual_id, sku, type_id)` is the DB upsert key for этой таблицы — если
 * два источника внутри одного начисления когда-нибудь дадут одинаковый ключ
 * (например, реальная услуга delivery.services[] с type_id, совпадающим с
 * OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID), upsert молча затрёт одну строку
 * другой. Складываем такие строки заранее, а не полагаемся на то, что ключи
 * никогда не столкнутся.
 */
export function mergeDuplicateAccrualRows(rows: OzonAccrualRow[]): OzonAccrualRow[] {
  const byKey = new Map<string, OzonAccrualRow>();
  for (const row of rows) {
    const key = `${row.accrual_id}\u0000${row.sku}\u0000${row.type_id}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...row });
      continue;
    }
    existing.amount += row.amount;
    existing.quantity =
      existing.quantity === null && row.quantity === null
        ? null
        : (existing.quantity ?? 0) + (row.quantity ?? 0);
    existing.extra = existing.extra ?? row.extra;
  }
  return [...byKey.values()];
}
