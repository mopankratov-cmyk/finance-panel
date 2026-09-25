import { OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID } from "@/lib/ozon/accrualRows";
import { describeOzonPostingStatus, type OzonPostingStage } from "@/lib/ozon/postingStatus";

export interface OzonOpiuAccrualInput {
  accrued_category: string;
  type_id: number;
  amount: number;
  /** Только у строк-комиссий (type_id = OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID) — сумма продажи на момент начисления, используется для «Продажи → Заказы» (спека §7). */
  extra?: { sale_amount?: number } | null;
}

export interface OzonOpiuPostingInput {
  status: string;
  amount: number;
}

export type OzonOpiuSectionKey = "orders" | "sales" | "cogs" | "commission" | "logistics" | "ads" | "other";

export interface OzonOpiuChildRow {
  key: string;
  label: string;
  amount: number;
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
}

export interface OzonOpiuReport {
  sections: OzonOpiuSection[];
  total: number;
  newCategories: OzonOpiuNewCategory[];
}

export interface OzonOpiuReportInput {
  accrualRows: OzonOpiuAccrualInput[];
  postings: OzonOpiuPostingInput[];
  /** Положительная сумма расхода на рекламу (сырой SUM(spent) из ozon_ad_daily) — знак меняется внутри. */
  adSpend: number;
  /** type_id → имя, из кэша ozon_accrual_types (Task 1). Отсутствие имени не блокирует сумму — только подпись строки. */
  typeNames: Map<number, string>;
  /** Все type_id, когда-либо закэшированные — для баннера новых категорий (спека §6). */
  knownTypeIds: Set<number>;
}

const STAGE_LABELS: Record<OzonPostingStage, string> = {
  delivered: "Доставлено",
  cancelled: "Отменено",
  transit: "Доставляется",
  shipping: "Ожидает отгрузки/упаковки",
  problem: "Спор/арбитраж",
  unknown: "Без статуса",
};

/** Порядок показа — доставленное и отменённое первыми, как в исходной таблице. */
const STAGE_ORDER: OzonPostingStage[] = ["delivered", "cancelled", "transit", "shipping", "problem", "unknown"];

function labelForType(typeId: number, typeNames: Map<number, string>): string {
  return typeNames.get(typeId) ?? `Категория #${typeId}`;
}

function sumByType(rows: OzonOpiuAccrualInput[]): Map<number, number> {
  const byType = new Map<number, number>();
  for (const row of rows) {
    byType.set(row.type_id, (byType.get(row.type_id) ?? 0) + row.amount);
  }
  return byType;
}

function toChildren(byType: Map<number, number>, typeNames: Map<number, string>): OzonOpiuChildRow[] {
  return [...byType.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([typeId, amount]) => ({ key: String(typeId), label: labelForType(typeId, typeNames), amount }));
}

/**
 * Разбивка по разделам (Комиссия/Логистика/Прочие удержания) — структурная,
 * проверена по коду синка, не по названиям категорий: POSTING+69 — всегда
 * синтетическая комиссия (OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID, см.
 * lib/ozon/accrualRows.ts), любая другая POSTING-строка — всегда услуга
 * доставки (по построению flattenOzonAccrual), ITEM/NON_ITEM — «Прочие
 * удержания». Ни одна строка не может остаться без раздела — сумма «К
 * выплате» верна независимо от того, насколько точно расставлены отдельные
 * строки. «Продажи → Заказы» — исключение: она не структурная, а
 * приближение через extra.sale_amount (спека §7), пока нет живого доступа к
 * Ozon для точной сверки с эталонной таблицей.
 */
export function buildOzonOpiuReport(input: OzonOpiuReportInput): OzonOpiuReport {
  const byStage = new Map<OzonPostingStage, number>();
  for (const posting of input.postings) {
    const { stage } = describeOzonPostingStatus(posting.status);
    byStage.set(stage, (byStage.get(stage) ?? 0) + posting.amount);
  }
  const ordersChildren: OzonOpiuChildRow[] = STAGE_ORDER.filter((stage) => byStage.has(stage)).map((stage) => ({
    key: stage,
    label: STAGE_LABELS[stage],
    amount: byStage.get(stage) ?? 0,
  }));
  const ordersTotal = ordersChildren.reduce((sum, c) => sum + c.amount, 0);

  let commissionTotal = 0;
  let salesOrdersAmount = 0;
  const logisticsByType = new Map<number, number>();
  const otherRows: OzonOpiuAccrualInput[] = [];
  for (const row of input.accrualRows) {
    if (row.accrued_category === "POSTING" && row.type_id === OZON_ACCRUAL_SALE_COMMISSION_TYPE_ID) {
      commissionTotal += row.amount;
      // Приближение к категории «Доставка покупателю» из эталонной таблицы —
      // точный type_id для неё неизвестен без живого доступа к Ozon (спека
      // §7). sale_amount — сумма продажи, зафиксированная на тот же момент
      // начисления, что и комиссия; проверено на реальном примере.
      salesOrdersAmount += row.extra?.sale_amount ?? 0;
    } else if (row.accrued_category === "POSTING") {
      logisticsByType.set(row.type_id, (logisticsByType.get(row.type_id) ?? 0) + row.amount);
    } else {
      otherRows.push(row);
    }
  }

  // «Возвраты и отмены» — из отменённых отправлений (надёжный источник,
  // отдельный от «Заказы» выше; спека §4/§7 не требует, чтобы оба числа шли
  // из одного и того же места).
  const cancelledAmount = byStage.get("cancelled") ?? 0;
  const salesTotal = salesOrdersAmount - cancelledAmount;
  const salesChildren: OzonOpiuChildRow[] = [
    { key: "orders", label: "Заказы", amount: salesOrdersAmount },
    { key: "cancelled", label: "Возвраты и отмены", amount: -cancelledAmount },
  ];

  const otherByType = sumByType(otherRows);
  const logisticsChildren = toChildren(logisticsByType, input.typeNames);
  const otherChildren = toChildren(otherByType, input.typeNames);
  const logisticsTotal = logisticsChildren.reduce((sum, c) => sum + c.amount, 0);
  const otherTotal = otherChildren.reduce((sum, c) => sum + c.amount, 0);

  // -0 || 0 нормализует отрицательный ноль обратно в 0 — иначе adSpend=0 даёт
  // -0, и assert.equal (Object.is под капотом) отличает его от 0.
  const adsAmount = -input.adSpend || 0;

  const newCategories: OzonOpiuNewCategory[] = [...new Set([...logisticsByType.keys(), ...otherByType.keys()])]
    .filter((typeId) => !input.knownTypeIds.has(typeId))
    .sort((a, b) => a - b)
    .map((typeId) => ({ typeId, label: labelForType(typeId, input.typeNames) }));

  const total = salesTotal + commissionTotal + logisticsTotal + adsAmount + otherTotal;

  const sections: OzonOpiuSection[] = [
    { key: "orders", label: "Заказы", kind: "metric", amount: ordersTotal, children: ordersChildren },
    { key: "sales", label: "Продажи", kind: "metric", amount: salesTotal, children: salesChildren },
    { key: "cogs", label: "Себестоимость", kind: "stub", amount: null, children: [] },
    { key: "commission", label: "Комиссия за продажу", kind: "metric", amount: commissionTotal, children: [] },
    { key: "logistics", label: "Логистика", kind: "metric", amount: logisticsTotal, children: logisticsChildren },
    { key: "ads", label: "Реклама", kind: "metric", amount: adsAmount, children: [] },
    { key: "other", label: "Прочие удержания", kind: "metric", amount: otherTotal, children: otherChildren },
  ];

  return { sections, total, newCategories };
}
