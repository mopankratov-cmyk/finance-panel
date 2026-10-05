import { describeOzonPostingStatus } from "@/lib/ozon/postingStatus";
import {
  OZON_SHEET_ADS_EXTRA_TYPE_IDS,
  OZON_SHEET_ADS_LINES,
  OZON_SHEET_COGS_LINES,
  OZON_SHEET_COMMISSION_TYPE_ID,
  OZON_SHEET_LOGISTICS_LINES,
  OZON_SHEET_LOGISTICS_NAMED_LINES,
  OZON_SHEET_OTHER_COMPENSATIONS_LABEL,
  OZON_SHEET_OTHER_LINES,
  OZON_SHEET_SALES_LABELS,
} from "@/lib/ozon/opiuOzonSheetLayout";

/**
 * Финансовый отчёт Ozon — повторяет вкладку «К выплате» эталонной таблицы
 * строка в строку (раскладка — lib/ozon/opiuOzonSheetLayout.ts):
 *
 * - «Продажи» — колонка «Стоимость товаров с учётом скидок продавца» списка
 *   начислений = `extra.sale_amount` строки комиссии. Как таблица делит её по
 *   строкам, видно по данным: положительная — «Доставка покупателю»;
 *   отрицательная — возврат («Получение возврата, отмены, невыкупа от
 *   покупателя»), а если у того же начисления вернулись и услуги (положительные
 *   суммы) — «Доставка покупателю — отмена начисления».
 * - «Комиссия за продажу» — тип 69; «Логистика» — колонки M:V и три строки по
 *   названию; «Реклама» и «Прочие удержания» — типы начислений по названию.
 * - Разделы-расходы показаны положительными, строки «Логистики» и «Прочих
 *   удержаний» — с исходным знаком Ozon, строки «Рекламы» — с обратным: ровно
 *   как в таблице. ИТОГО = Продажи − Комиссия − Логистика − Реклама − Прочие
 *   удержания − Прочие компенсации.
 *
 * Тип начисления, которого нет ни в одной строке таблицы (Ozon добавил новую
 * категорию), не пропадает: он выводится отдельной строкой в «Логистике»
 * (если это услуга отправления) или в «Прочих удержаниях» и попадает в
 * `newCategories` для баннера.
 */

export interface OzonOpiuAccrualInput {
  accrual_id: number | string;
  accrued_category: string;
  type_id: number;
  amount: number;
  /** Только у строки комиссии (тип 69): сумма продажи на момент начисления. */
  extra?: { sale_amount?: number } | null;
}

export interface OzonOpiuPostingInput {
  status: string;
  amount: number;
}

export type OzonOpiuSectionKey =
  | "orders"
  | "sales"
  | "cogs"
  | "warehouse"
  | "commission"
  | "logistics"
  | "ads"
  | "other"
  | "otherCompensations";

export interface OzonOpiuChildRow {
  key: string;
  label: string;
  /** null — источника нет (заглушка). */
  amount: number | null;
}

export interface OzonOpiuSection {
  key: OzonOpiuSectionKey;
  label: string;
  kind: "metric" | "stub";
  amount: number | null;
  children: OzonOpiuChildRow[];
}

export interface OzonOpiuNewCategory {
  typeId: number;
  label: string;
  /** Куда попала категория: её нет в строках таблицы. */
  section: "logistics" | "other";
}

export interface OzonOpiuReport {
  sections: OzonOpiuSection[];
  total: number;
  totalLabel: string;
  newCategories: OzonOpiuNewCategory[];
}

export interface OzonOpiuReportInput {
  accrualRows: OzonOpiuAccrualInput[];
  postings: OzonOpiuPostingInput[];
  /** type_id → название (description из ozon_accrual_types) — только для строк, которых нет в таблице. */
  typeNames: Map<number, string>;
}

type LineGroup = "logistics" | "logisticsNamed" | "ads" | "adsExtra" | "other";

const LINE_INDEX: Map<number, { group: LineGroup; index: number }> = (() => {
  const map = new Map<number, { group: LineGroup; index: number }>();
  const put = (group: LineGroup, lines: { typeIds: number[] }[]) =>
    lines.forEach((line, index) => line.typeIds.forEach((id) => { if (!map.has(id)) map.set(id, { group, index }); }));
  put("logistics", OZON_SHEET_LOGISTICS_LINES);
  put("logisticsNamed", OZON_SHEET_LOGISTICS_NAMED_LINES);
  put("ads", OZON_SHEET_ADS_LINES);
  put("other", OZON_SHEET_OTHER_LINES);
  OZON_SHEET_ADS_EXTRA_TYPE_IDS.forEach((id) => { if (!map.has(id)) map.set(id, { group: "adsExtra", index: 0 }); });
  return map;
})();

/** Копейки и без «-0»: суммы начислений дают хвосты вида 0.30000000000000004. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100 || 0;
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function labelFor(typeId: number, typeNames: Map<number, string>): string {
  return typeNames.get(typeId) ?? `Категория #${typeId}`;
}

function extraChildren(
  extras: Map<number, number>,
  typeNames: Map<number, string>,
  sign: 1 | -1,
): OzonOpiuChildRow[] {
  return [...extras.entries()]
    .filter(([, raw]) => round2(raw) !== 0)
    .sort((a, b) => a[0] - b[0])
    .map(([typeId, raw]) => ({ key: `type-${typeId}`, label: labelFor(typeId, typeNames), amount: round2(sign * raw) }));
}

function add(map: Map<number, number>, key: number, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

export function buildOzonOpiuReport(input: OzonOpiuReportInput): OzonOpiuReport {
  // «Заказы» — воронка отправлений по статусам (в таблице — отдельный список отправлений).
  const orderBuckets = { delivered: 0, cancelled: 0, transit: 0, waitingShip: 0, waitingPack: 0, other: 0 };
  for (const posting of input.postings) {
    const { stage } = describeOzonPostingStatus(posting.status);
    if (stage === "delivered") orderBuckets.delivered += posting.amount;
    else if (stage === "cancelled") orderBuckets.cancelled += posting.amount;
    else if (stage === "transit") orderBuckets.transit += posting.amount;
    else if (stage === "shipping") {
      if (posting.status.trim().toLowerCase() === "awaiting_packaging") orderBuckets.waitingPack += posting.amount;
      else orderBuckets.waitingShip += posting.amount;
    } else orderBuckets.other += posting.amount;
  }
  const ordersChildren: OzonOpiuChildRow[] = [
    { key: "delivered", label: "Доставлено", amount: round2(orderBuckets.delivered) },
    { key: "cancelled", label: "Отменено", amount: round2(orderBuckets.cancelled) },
    { key: "transit", label: "Доставляется", amount: round2(orderBuckets.transit) },
    { key: "waitingShip", label: "Ожидает отгрузки", amount: round2(orderBuckets.waitingShip) },
    { key: "waitingPack", label: "Ожидает упаковки", amount: round2(orderBuckets.waitingPack) },
  ];
  if (round2(orderBuckets.other) !== 0) {
    ordersChildren.push({ key: "other", label: "Другие статусы", amount: round2(orderBuckets.other) });
  }
  const ordersTotal = round2(sum(ordersChildren.map((c) => c.amount ?? 0)));

  // Начисления, у которых вернулись услуги (положительные суммы), — отмена начисления, а не возврат.
  const reversedServices = new Set<string>();
  for (const row of input.accrualRows) {
    if (row.type_id !== OZON_SHEET_COMMISSION_TYPE_ID && row.accrued_category === "POSTING" && row.amount > 0) {
      reversedServices.add(String(row.accrual_id));
    }
  }

  let commissionRaw = 0;
  const sales = { sale: 0, returnReceipt: 0, saleCancelled: 0 };
  const logisticsSums = OZON_SHEET_LOGISTICS_LINES.map(() => 0);
  const namedSums = OZON_SHEET_LOGISTICS_NAMED_LINES.map(() => 0);
  const adsSums = OZON_SHEET_ADS_LINES.map(() => 0);
  const otherSums = OZON_SHEET_OTHER_LINES.map(() => 0);
  const adsExtras = new Map<number, number>();
  const logisticsExtras = new Map<number, number>();
  const otherExtras = new Map<number, number>();

  for (const row of input.accrualRows) {
    const amount = Number(row.amount);
    if (row.type_id === OZON_SHEET_COMMISSION_TYPE_ID) {
      commissionRaw += amount;
      const saleAmount = Number(row.extra?.sale_amount ?? 0);
      if (saleAmount > 0) sales.sale += saleAmount;
      else if (saleAmount < 0) {
        if (reversedServices.has(String(row.accrual_id))) sales.saleCancelled += saleAmount;
        else sales.returnReceipt += saleAmount;
      }
      continue;
    }
    const slot = LINE_INDEX.get(row.type_id);
    if (!slot) {
      if (row.accrued_category === "POSTING") add(logisticsExtras, row.type_id, amount);
      else add(otherExtras, row.type_id, amount);
      continue;
    }
    if (slot.group === "logistics") logisticsSums[slot.index] += amount;
    else if (slot.group === "logisticsNamed") namedSums[slot.index] += amount;
    else if (slot.group === "ads") adsSums[slot.index] += amount;
    else if (slot.group === "adsExtra") add(adsExtras, row.type_id, amount);
    else otherSums[slot.index] += amount;
  }

  const salesChildren: OzonOpiuChildRow[] = [
    { key: "sale", label: OZON_SHEET_SALES_LABELS.sale, amount: round2(sales.sale) },
    { key: "returns", label: OZON_SHEET_SALES_LABELS.returns, amount: 0 },
    { key: "returnFlow", label: OZON_SHEET_SALES_LABELS.returnFlow, amount: 0 },
    { key: "returnReceipt", label: OZON_SHEET_SALES_LABELS.returnReceipt, amount: round2(sales.returnReceipt) },
    { key: "saleCancelled", label: OZON_SHEET_SALES_LABELS.saleCancelled, amount: round2(sales.saleCancelled) },
  ];
  const salesTotal = round2(sum(salesChildren.map((c) => c.amount ?? 0)));

  const logisticsChildren: OzonOpiuChildRow[] = [
    ...OZON_SHEET_LOGISTICS_LINES.map((line, i) => ({ key: `logistics-${i}`, label: line.label, amount: round2(logisticsSums[i]) })),
    ...OZON_SHEET_LOGISTICS_NAMED_LINES.map((line, i) => ({ key: `named-${i}`, label: line.label, amount: round2(namedSums[i]) })),
    ...extraChildren(logisticsExtras, input.typeNames, 1),
  ];
  const logisticsAmount = round2(-sum(logisticsChildren.map((c) => c.amount ?? 0)));

  const adsChildren: OzonOpiuChildRow[] = [
    ...OZON_SHEET_ADS_LINES.map((line, i) => ({ key: `ads-${i}`, label: line.label, amount: round2(-adsSums[i]) })),
    ...extraChildren(adsExtras, input.typeNames, -1),
  ];
  const adsAmount = round2(sum(adsChildren.map((c) => c.amount ?? 0)));

  const otherChildren: OzonOpiuChildRow[] = [
    ...OZON_SHEET_OTHER_LINES.map((line, i) => ({ key: `other-${i}`, label: line.label, amount: round2(otherSums[i]) })),
    ...extraChildren(otherExtras, input.typeNames, 1),
  ];
  const otherAmount = round2(-sum(otherChildren.map((c) => c.amount ?? 0)));

  const commissionAmount = round2(-commissionRaw);
  const compensationsAmount = 0;

  const total = round2(salesTotal - commissionAmount - logisticsAmount - adsAmount - otherAmount - compensationsAmount);

  const newCategories: OzonOpiuNewCategory[] = [
    ...[...logisticsExtras.keys()].map((typeId) => ({ typeId, label: labelFor(typeId, input.typeNames), section: "logistics" as const })),
    ...[...otherExtras.keys()].map((typeId) => ({ typeId, label: labelFor(typeId, input.typeNames), section: "other" as const })),
  ]
    .filter((c) => (c.section === "logistics" ? logisticsExtras : otherExtras).get(c.typeId) !== 0)
    .sort((a, b) => a.typeId - b.typeId);

  const sections: OzonOpiuSection[] = [
    { key: "orders", label: "Заказы", kind: "metric", amount: ordersTotal, children: ordersChildren },
    { key: "sales", label: "Продажи", kind: "metric", amount: salesTotal, children: salesChildren },
    {
      key: "cogs",
      label: "Себестоимость",
      kind: "stub",
      amount: null,
      children: OZON_SHEET_COGS_LINES.map((label, i) => ({ key: `cogs-${i}`, label, amount: null })),
    },
    { key: "warehouse", label: "Склад", kind: "stub", amount: null, children: [] },
    { key: "commission", label: "Комиссия за продажу:", kind: "metric", amount: commissionAmount, children: [] },
    { key: "logistics", label: "Логистика:", kind: "metric", amount: logisticsAmount, children: logisticsChildren },
    { key: "ads", label: "Реклама:", kind: "metric", amount: adsAmount, children: adsChildren },
    { key: "other", label: "Прочие удержания:", kind: "metric", amount: otherAmount, children: otherChildren },
    {
      key: "otherCompensations",
      label: OZON_SHEET_OTHER_COMPENSATIONS_LABEL,
      kind: "metric",
      amount: compensationsAmount,
      children: [],
    },
  ];

  return { sections, total, totalLabel: "ИТОГО К ВЫПЛАТЕ", newCategories };
}
