/**
 * «Маржа по артикулам Ozon» — расчёт строка в строку по вкладке «Маржа по
 * артикулам» эталонной Google-таблицы выгрузки Ozon.
 *
 * В таблице каждая ячейка — СУММЕСЛИМН по вкладке «Список начислений» для
 * одного Ozon SKU id. Здесь то же самое по `ozon_accrual_rows`:
 *  - продажа / возврат / отмена — по знаку `extra.sale_amount` у строки
 *    комиссии (type_id 69), так же, как в «Финансовом отчёте Ozon»;
 *  - эквайринг и колонки логистики — по type_id из opiuOzonSheetLayout.ts;
 *  - расходы в таблице положительные (знак начисления меняется);
 *  - себестоимость и склад = цена за единицу × (продажи − возвраты, шт);
 *  - налог в «ЧП с налогом» — 7,5% × 32% от «Итого продаж, руб» (как в таблице).
 *
 * Два намеренных отличия от таблицы:
 *  - колонка «Прочие (новые типы)»: расходы Ozon с типом, которого нет в раскладке
 *    таблицы, вычитаются из прибыли, чтобы маржа не завышалась;
 *  - в строке «Итого» маржа — это сумма
 * в строке «Итого» маржа — сумма прибыли / сумма выручки (как в марже WB), а не среднее процентов.
 */
import {
  OZON_SHEET_ADS_EXTRA_TYPE_IDS,
  OZON_SHEET_ADS_LINES,
  OZON_SHEET_COMMISSION_TYPE_ID,
  OZON_SHEET_LOGISTICS_LINES,
  OZON_SHEET_LOGISTICS_NAMED_LINES,
  OZON_SHEET_OTHER_LINES,
} from "./opiuOzonSheetLayout.ts";

export const OZON_MARGIN_TAX_RATE = 0.075 * 0.32;
const ACQUIRING_TYPE_ID = 1;
const NO_SKU = "-";

export interface OzonMarginAccrualRow {
  accrual_id: string;
  sku: string;
  type_id: number;
  accrued_category: string;
  amount: number;
  quantity: number | null;
  extra: { sale_amount?: number } | null;
}

export interface OzonSkuCost {
  article: string;
  cost: number;
  warehouse: number;
}

/** Колонки логистики (K:T таблицы) — в порядке OZON_SHEET_LOGISTICS_LINES. */
export const OZON_MARGIN_LOGISTICS_KEYS = [
  "assembly",
  "dropOff",
  "trunk",
  "lastMile",
  "reverseTrunk",
  "returnProcessing",
  "cancelProcessing",
  "unredeemedProcessing",
  "logistics",
  "reverseLogistics",
] as const;
export type OzonMarginLogisticsKey = (typeof OZON_MARGIN_LOGISTICS_KEYS)[number];

export interface OzonMarginRow extends Record<OzonMarginLogisticsKey, number> {
  sku: string;
  article: string;
  salesQty: number;
  salesRub: number;
  returnsQty: number;
  returnsRub: number;
  netQty: number;
  netRub: number;
  acquiring: number;
  commission: number;
  logisticsTotal: number;
  /** Расходы Ozon новых типов (нет в раскладке таблицы) — вычитаются из прибыли. */
  newTypes: number;
  /** null — себестоимости нет; в прибыли считается как 0. */
  cost: number | null;
  warehouse: number;
  profitAfterTax: number;
  profitBeforeTax: number;
  marginAfterTaxPct: number | null;
  marginBeforeTaxPct: number | null;
}

export interface OzonMarginResult {
  rows: OzonMarginRow[];
  /** Артикулы (или SKU, если артикул не найден) без себестоимости. */
  missingCost: string[];
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const pct = (profit: number, revenue: number) => (revenue !== 0 ? round2((profit / revenue) * 100) : null);

// Типы, которые раскладка таблицы знает (в том числе те, что в маржу не входят — реклама, прочие
// удержания). Всё остальное — «новый тип».
const KNOWN_TYPE_IDS = new Set<number>([
  OZON_SHEET_COMMISSION_TYPE_ID,
  ACQUIRING_TYPE_ID,
  ...[
    ...OZON_SHEET_LOGISTICS_LINES,
    ...OZON_SHEET_LOGISTICS_NAMED_LINES,
    ...OZON_SHEET_ADS_LINES,
    ...OZON_SHEET_OTHER_LINES,
  ].flatMap((line) => line.typeIds),
  ...OZON_SHEET_ADS_EXTRA_TYPE_IDS,
]);

const LOGISTICS_KEY_BY_TYPE = new Map<number, OzonMarginLogisticsKey>();
OZON_SHEET_LOGISTICS_LINES.forEach((line, index) => {
  for (const typeId of line.typeIds) LOGISTICS_KEY_BY_TYPE.set(typeId, OZON_MARGIN_LOGISTICS_KEYS[index]);
});

interface Acc extends Record<OzonMarginLogisticsKey, number> {
  salesQty: number;
  salesRub: number;
  returnsQty: number;
  returnsRub: number;
  acquiring: number;
  commission: number;
  newTypes: number;
}

function emptyAcc(): Acc {
  const acc = { salesQty: 0, salesRub: 0, returnsQty: 0, returnsRub: 0, acquiring: 0, commission: 0, newTypes: 0 } as Acc;
  for (const key of OZON_MARGIN_LOGISTICS_KEYS) acc[key] = 0;
  return acc;
}

export function buildOzonMarginBySku(input: {
  accrualRows: OzonMarginAccrualRow[];
  costBySku: Map<string, OzonSkuCost>;
}): OzonMarginResult {
  // Начисление, у которого вернулась услуга (сумма > 0), — отмена начисления, а не возврат.
  const reversed = new Set<string>();
  for (const r of input.accrualRows) {
    if (r.type_id !== OZON_SHEET_COMMISSION_TYPE_ID && r.accrued_category === "POSTING" && r.amount > 0) {
      reversed.add(r.accrual_id);
    }
  }

  const bySku = new Map<string, Acc>();
  for (const r of input.accrualRows) {
    if (!r.sku || r.sku === NO_SKU) continue;
    const acc = bySku.get(r.sku) ?? emptyAcc();
    bySku.set(r.sku, acc);
    const amount = Number(r.amount);
    if (r.type_id === OZON_SHEET_COMMISSION_TYPE_ID) {
      acc.commission -= amount;
      const saleAmount = Number(r.extra?.sale_amount ?? 0);
      const qty = Math.abs(Number(r.quantity ?? 0));
      if (saleAmount > 0) {
        acc.salesQty += qty;
        acc.salesRub += saleAmount;
      } else if (saleAmount < 0) {
        acc.returnsRub += saleAmount;
        if (!reversed.has(r.accrual_id)) acc.returnsQty += qty;
      }
    } else if (r.type_id === ACQUIRING_TYPE_ID) {
      acc.acquiring -= amount;
    } else {
      const key = LOGISTICS_KEY_BY_TYPE.get(r.type_id);
      if (key) acc[key] -= amount;
      else if (!KNOWN_TYPE_IDS.has(r.type_id)) acc.newTypes -= amount;
    }
  }

  const rows: OzonMarginRow[] = [];
  const missing = new Set<string>();
  for (const [sku, acc] of bySku) {
    const logisticsSum = OZON_MARGIN_LOGISTICS_KEYS.reduce((s, k) => s + acc[k], 0);
    const hasActivity =
      acc.salesQty || acc.salesRub || acc.returnsQty || acc.returnsRub || acc.acquiring || acc.commission || acc.newTypes || logisticsSum;
    if (!hasActivity) continue;

    const known = input.costBySku.get(sku);
    const article = known?.article || sku;
    const unitCost = known && known.cost > 0 ? known.cost : null;
    if (unitCost === null) missing.add(article);

    const netQty = acc.salesQty - acc.returnsQty;
    const netRub = acc.salesRub + acc.returnsRub;
    const cost = unitCost === null ? null : unitCost * netQty;
    const warehouse = (known?.warehouse ?? 0) * netQty;
    const profitBeforeTax = netRub - acc.acquiring - acc.commission - logisticsSum - acc.newTypes - (cost ?? 0) - warehouse;
    const profitAfterTax = profitBeforeTax - OZON_MARGIN_TAX_RATE * netRub;

    const row = {
      sku,
      article,
      salesQty: acc.salesQty,
      salesRub: round2(acc.salesRub),
      returnsQty: acc.returnsQty,
      returnsRub: round2(acc.returnsRub),
      netQty,
      netRub: round2(netRub),
      acquiring: round2(acc.acquiring),
      commission: round2(acc.commission),
      logisticsTotal: round2(logisticsSum),
      newTypes: round2(acc.newTypes),
      cost: cost === null ? null : round2(cost),
      warehouse: round2(warehouse),
      profitAfterTax: round2(profitAfterTax),
      profitBeforeTax: round2(profitBeforeTax),
      marginAfterTaxPct: pct(profitAfterTax, netRub),
      marginBeforeTaxPct: pct(profitBeforeTax, netRub),
    } as OzonMarginRow;
    for (const key of OZON_MARGIN_LOGISTICS_KEYS) row[key] = round2(acc[key]);
    rows.push(row);
  }

  rows.sort((a, b) => b.netRub - a.netRub || a.article.localeCompare(b.article));
  return { rows, missingCost: [...missing].sort() };
}

export type OzonMarginTotals = Omit<OzonMarginRow, "sku" | "article" | "cost"> & { cost: number };

/** Итого: суммы по строкам, маржа — сумма прибыли / сумма выручки. */
export function totalOzonMargin(rows: OzonMarginRow[]): OzonMarginTotals {
  const sum = (pick: (r: OzonMarginRow) => number) => round2(rows.reduce((s, r) => s + pick(r), 0));
  const total = {
    salesQty: rows.reduce((s, r) => s + r.salesQty, 0),
    salesRub: sum((r) => r.salesRub),
    returnsQty: rows.reduce((s, r) => s + r.returnsQty, 0),
    returnsRub: sum((r) => r.returnsRub),
    netQty: rows.reduce((s, r) => s + r.netQty, 0),
    netRub: sum((r) => r.netRub),
    acquiring: sum((r) => r.acquiring),
    commission: sum((r) => r.commission),
    logisticsTotal: sum((r) => r.logisticsTotal),
    newTypes: sum((r) => r.newTypes),
    cost: sum((r) => r.cost ?? 0),
    warehouse: sum((r) => r.warehouse),
    profitAfterTax: sum((r) => r.profitAfterTax),
    profitBeforeTax: sum((r) => r.profitBeforeTax),
  } as OzonMarginTotals;
  for (const key of OZON_MARGIN_LOGISTICS_KEYS) total[key] = sum((r) => r[key]);
  total.marginAfterTaxPct = pct(total.profitAfterTax, total.netRub);
  total.marginBeforeTaxPct = pct(total.profitBeforeTax, total.netRub);
  return total;
}
