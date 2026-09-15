export const PURCHASE_ORDER_STATUSES = ["draft", "placed", "production", "transit", "received", "cancelled"] as const;
export const PURCHASE_CURRENCIES = ["CNY", "RUB", "USD"] as const;

export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];
export type PurchaseCurrency = (typeof PURCHASE_CURRENCIES)[number];
export type PurchasePaymentStatus = "planned" | "paid" | "cancelled";
export type PurchaseLogisticsStatus = "planned" | "in_progress" | "done" | "cancelled";

export interface PurchaseOrderItem {
  nmId: number;
  article: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface PurchasePaymentStage {
  title: string;
  percent: number;
  amount: number;
  /** §13/§27.5 ТЗ: курс на дату именно ЭТОГО платежа, не курс заказа
   *  (purchase_orders.exchange_rate — один на весь документ). `amount`
   *  остаётся тем, что реально ушло со счёта в рублях, — это поле не
   *  участвует в расчёте суммы, только фиксирует курс для истории и §13. */
  exchangeRate: number | null;
  dueDate: string | null;
  paidAt: string | null;
  status: PurchasePaymentStatus;
}

export interface PurchaseLogisticsStage {
  title: string;
  provider: string;
  dueDate: string | null;
  completedAt: string | null;
  cost: number;
  status: PurchaseLogisticsStatus;
}

export interface PurchaseExpense {
  title: string;
  amount: number;
  currency: PurchaseCurrency;
}

export interface PurchaseOrderInput {
  id?: string;
  cabinetId: string;
  orderNumber: string;
  supplier: string;
  /** Ссылка на suppliers.id, если поставщик выбран из справочника, а не
   *  вписан руками. `supplier` остаётся источником отображаемого имени — так
   *  старые заказы без привязки продолжают показывать то, что в них было. */
  supplierId: string | null;
  orderDate: string;
  productionDays: number;
  expectedReadyDate: string;
  currency: PurchaseCurrency;
  exchangeRate: number;
  status: PurchaseOrderStatus;
  note: string;
  idempotencyKey?: string;
  items: PurchaseOrderItem[];
  paymentStages: PurchasePaymentStage[];
  logisticsStages: PurchaseLogisticsStage[];
  expenses: PurchaseExpense[];
}

export interface PurchaseOrderTotals {
  goodsCurrency: number;
  goodsRub: number;
  logisticsRub: number;
  expensesRub: number;
  totalRub: number;
  quantity: number;
}

type ValidationResult =
  | { ok: true; value: PurchaseOrderInput }
  | { ok: false; error: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function nullableId(value: unknown): string | null {
  const candidate = text(value, 60);
  return UUID.test(candidate) ? candidate : null;
}
const PAYMENT_STATUSES = new Set<PurchasePaymentStatus>(["planned", "paid", "cancelled"]);
const LOGISTICS_STATUSES = new Set<PurchaseLogisticsStatus>(["planned", "in_progress", "done", "cancelled"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function number(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

function nullableDate(value: unknown): string | null {
  const candidate = text(value, 10);
  return ISO_DATE.test(candidate) ? candidate : null;
}

function nullableTimestamp(value: unknown): string | null {
  const candidate = text(value, 40);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function nullablePositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function addDays(date: string, days: number): string {
  const parsed = ISO_DATE.test(date) ? new Date(`${date}T12:00:00.000Z`) : new Date();
  parsed.setUTCDate(parsed.getUTCDate() + Math.max(0, Math.round(days)));
  return parsed.toISOString().slice(0, 10);
}

export function purchaseOrderTotals(order: Pick<PurchaseOrderInput, "items" | "exchangeRate" | "logisticsStages" | "expenses">): PurchaseOrderTotals {
  const goodsCurrency = order.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const logisticsRub = order.logisticsStages.reduce((sum, stage) => sum + stage.cost, 0);
  const expensesRub = order.expenses.reduce((sum, expense) => sum + expense.amount * (expense.currency === "RUB" ? 1 : order.exchangeRate), 0);
  const goodsRub = goodsCurrency * order.exchangeRate;
  return {
    goodsCurrency,
    goodsRub,
    logisticsRub,
    expensesRub,
    totalRub: goodsRub + logisticsRub + expensesRub,
    quantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
  };
}

export function disallowedPurchaseNmIds(items: Pick<PurchaseOrderItem, "nmId">[], allowedNmIds: Set<number> | null): number[] {
  if (allowedNmIds === null) return [];
  return [...new Set(items.map((item) => item.nmId).filter((nmId) => !allowedNmIds.has(nmId)))];
}

export type OrderRevisionField = "orderNumber" | "supplier" | "orderDate" | "productionDays" | "expectedReadyDate" | "currency" | "exchangeRate" | "status" | "note";

export type OrderRevisionChange =
  | { kind: "field"; field: OrderRevisionField; before: string; after: string }
  | { kind: "itemAdded"; nmId: number; article: string; quantity: number; unitPrice: number }
  | { kind: "itemRemoved"; nmId: number; article: string }
  | {
      kind: "itemChanged";
      nmId: number;
      article: string;
      quantityBefore: number;
      quantityAfter: number;
      unitPriceBefore: number;
      unitPriceAfter: number;
      articleBefore: string;
      articleAfter: string;
      nameBefore: string;
      nameAfter: string;
    };

interface RevisionItem { nmId: number; article: string; name: string; quantity: number; unitPrice: number }

interface RevisionSnapshot {
  orderNumber: string;
  supplier: string;
  orderDate: string;
  productionDays: number;
  expectedReadyDate: string;
  currency: string;
  exchangeRate: number;
  status: string;
  note: string;
  /**
   * `null` — снимок из operation_audit_log, записанный ДО 202609140005
   * (у него в принципе нет ключа `items`): позиций в нём не было НЕ потому,
   * что заказ был пуст, а потому что старая версия функции их не снимала.
   * Раскрывать такой снимок как «было 0 позиций» превратило бы каждую
   * позицию текущего заказа в фиктивное «добавлено» на всех старых
   * редакциях — отличаем это от настоящего пустого списка `[]`.
   */
  items: RevisionItem[] | null;
}

function revisionText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function revisionNumber(value: unknown): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

/**
 * `save_purchase_order` пишет before/after заказа в operation_audit_log сама
 * (202609140005) — верхний уровень снимка приходит с колонками БД
 * (snake_case), а items/paymentStages/логистика/расходы — тем же camelCase,
 * каким их отправляет форма. Здесь просто читаем то, что уже записано, а не
 * решаем заново, что в снимок класть.
 */
function readRevisionSnapshot(raw: unknown): RevisionSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const items = "items" in source
    ? (Array.isArray(source.items)
        ? source.items
            .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
            .map((entry) => ({
              nmId: revisionNumber(entry.nmId),
              article: revisionText(entry.article),
              name: revisionText(entry.name),
              quantity: revisionNumber(entry.quantity),
              unitPrice: revisionNumber(entry.unitPrice),
            }))
        : [])
    : null;
  return {
    orderNumber: revisionText(source.order_number),
    supplier: revisionText(source.supplier),
    orderDate: revisionText(source.order_date),
    productionDays: revisionNumber(source.production_days),
    expectedReadyDate: revisionText(source.expected_ready_date),
    currency: revisionText(source.currency),
    exchangeRate: revisionNumber(source.exchange_rate),
    status: revisionText(source.status),
    note: revisionText(source.note),
    items,
  };
}

/**
 * Сравнивает два снимка заказа из operation_audit_log (before_data/after_data)
 * и возвращает список того, что реально изменилось — то, что раньше правка
 * молча стирала (§6.3 ТЗ), а не просто «заказ изменён» одной строкой.
 * `before === null` (первое сохранение) — не редакция, вызывающий код это
 * уже знает по `action === "created"` и сюда обращаться не должен.
 */
export function diffPurchaseOrderRevision(before: unknown, after: unknown): OrderRevisionChange[] {
  const from = readRevisionSnapshot(before);
  const to = readRevisionSnapshot(after);
  if (!from || !to) return [];

  const changes: OrderRevisionChange[] = [];
  const pushField = (field: OrderRevisionField, beforeValue: string, afterValue: string) => {
    if (beforeValue !== afterValue) changes.push({ kind: "field", field, before: beforeValue, after: afterValue });
  };
  pushField("orderNumber", from.orderNumber, to.orderNumber);
  pushField("supplier", from.supplier, to.supplier);
  pushField("orderDate", from.orderDate, to.orderDate);
  pushField("productionDays", String(from.productionDays), String(to.productionDays));
  pushField("expectedReadyDate", from.expectedReadyDate, to.expectedReadyDate);
  pushField("currency", from.currency, to.currency);
  pushField("exchangeRate", String(from.exchangeRate), String(to.exchangeRate));
  pushField("status", from.status, to.status);
  pushField("note", from.note, to.note);

  // items === null значит «этот снимок сделан до 202609140005 и позиций в
  // нём нет вовсе» — сравнивать тут нечего: пустой список означал бы, что
  // все текущие позиции «добавлены», хотя на самом деле просто не с чем
  // сверить.
  if (from.items !== null && to.items !== null) {
    const beforeItems = new Map(from.items.map((item) => [item.nmId, item]));
    const afterItems = new Map(to.items.map((item) => [item.nmId, item]));
    for (const [nmId, itemAfter] of afterItems) {
      const itemBefore = beforeItems.get(nmId);
      if (!itemBefore) {
        changes.push({ kind: "itemAdded", nmId, article: itemAfter.article, quantity: itemAfter.quantity, unitPrice: itemAfter.unitPrice });
        continue;
      }
      if (
        itemBefore.quantity !== itemAfter.quantity ||
        itemBefore.unitPrice !== itemAfter.unitPrice ||
        itemBefore.article !== itemAfter.article ||
        itemBefore.name !== itemAfter.name
      ) {
        changes.push({
          kind: "itemChanged",
          nmId,
          article: itemAfter.article,
          quantityBefore: itemBefore.quantity,
          quantityAfter: itemAfter.quantity,
          unitPriceBefore: itemBefore.unitPrice,
          unitPriceAfter: itemAfter.unitPrice,
          articleBefore: itemBefore.article,
          articleAfter: itemAfter.article,
          nameBefore: itemBefore.name,
          nameAfter: itemAfter.name,
        });
      }
    }
    for (const [nmId, itemBefore] of beforeItems) {
      if (!afterItems.has(nmId)) changes.push({ kind: "itemRemoved", nmId, article: itemBefore.article });
    }
  }
  return changes;
}

export function normalizePurchaseOrderPayload(raw: unknown, forced?: { id?: string; cabinetId?: string }): ValidationResult {
  const source = record(raw);
  const cabinetId = text(forced?.cabinetId ?? source.cabinetId, 60);
  const id = text(forced?.id ?? source.id, 60) || undefined;
  const orderNumber = text(source.orderNumber, 100);
  const supplierId = nullableId(source.supplierId);
  const orderDate = nullableDate(source.orderDate);
  const productionDays = number(source.productionDays);
  const currency = text(source.currency, 3) as PurchaseCurrency;
  const exchangeRate = number(source.exchangeRate);
  const status = text(source.status, 20) as PurchaseOrderStatus;

  if (!cabinetId) return { ok: false, error: "Укажите кабинет" };
  if (!orderNumber) return { ok: false, error: "Укажите номер заказа" };
  if (!orderDate) return { ok: false, error: "Укажите корректную дату заказа" };
  if (!Number.isInteger(productionDays) || productionDays < 0 || productionDays > 365) return { ok: false, error: "Срок производства должен быть от 0 до 365 дней" };
  if (!PURCHASE_CURRENCIES.includes(currency)) return { ok: false, error: "Поддерживаются валюты CNY, RUB и USD" };
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0 || exchangeRate > 1_000_000) return { ok: false, error: "Укажите корректный курс валюты" };
  if (!PURCHASE_ORDER_STATUSES.includes(status)) return { ok: false, error: "Некорректный статус заказа" };

  const itemRows = Array.isArray(source.items) ? source.items : [];
  const items: PurchaseOrderItem[] = [];
  const seenNmIds = new Set<number>();
  for (let index = 0; index < itemRows.length; index += 1) {
    const item = record(itemRows[index]);
    const nmId = number(item.nmId);
    const quantity = number(item.quantity);
    const unitPrice = number(item.unitPrice);
    if (!Number.isSafeInteger(nmId) || nmId <= 0) return { ok: false, error: `Позиция ${index + 1}: некорректный nmId` };
    if (seenNmIds.has(nmId)) return { ok: false, error: `Позиция ${index + 1}: nmId ${nmId} уже добавлен` };
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 10_000_000) return { ok: false, error: `Позиция ${index + 1}: количество должно быть целым и больше нуля` };
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1_000_000_000) return { ok: false, error: `Позиция ${index + 1}: некорректная цена` };
    seenNmIds.add(nmId);
    items.push({ nmId, article: text(item.article, 200), name: text(item.name, 300), quantity, unitPrice });
  }

  const paymentRows = Array.isArray(source.paymentStages) ? source.paymentStages : [];
  const paymentStages: PurchasePaymentStage[] = [];
  for (let index = 0; index < paymentRows.length; index += 1) {
    const stage = record(paymentRows[index]);
    const title = text(stage.title, 200);
    const percent = number(stage.percent);
    const amount = number(stage.amount);
    const paymentStatus = text(stage.status, 20) as PurchasePaymentStatus;
    if (!title) continue;
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return { ok: false, error: `Этап оплаты ${index + 1}: процент должен быть от 0 до 100` };
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: `Этап оплаты ${index + 1}: некорректная сумма` };
    if (!PAYMENT_STATUSES.has(paymentStatus)) return { ok: false, error: `Этап оплаты ${index + 1}: некорректный статус` };
    paymentStages.push({ title, percent, amount, exchangeRate: nullablePositiveNumber(stage.exchangeRate), dueDate: nullableDate(stage.dueDate), paidAt: nullableTimestamp(stage.paidAt), status: paymentStatus });
  }

  const logisticsRows = Array.isArray(source.logisticsStages) ? source.logisticsStages : [];
  const logisticsStages: PurchaseLogisticsStage[] = [];
  for (let index = 0; index < logisticsRows.length; index += 1) {
    const stage = record(logisticsRows[index]);
    const title = text(stage.title, 200);
    const cost = number(stage.cost);
    const logisticsStatus = text(stage.status, 20) as PurchaseLogisticsStatus;
    if (!title) continue;
    if (!Number.isFinite(cost) || cost < 0) return { ok: false, error: `Этап логистики ${index + 1}: некорректная стоимость` };
    if (!LOGISTICS_STATUSES.has(logisticsStatus)) return { ok: false, error: `Этап логистики ${index + 1}: некорректный статус` };
    logisticsStages.push({ title, provider: text(stage.provider, 200), dueDate: nullableDate(stage.dueDate), completedAt: nullableTimestamp(stage.completedAt), cost, status: logisticsStatus });
  }

  const expenseRows = Array.isArray(source.expenses) ? source.expenses : [];
  const expenses: PurchaseExpense[] = [];
  for (let index = 0; index < expenseRows.length; index += 1) {
    const expense = record(expenseRows[index]);
    const title = text(expense.title, 200);
    const amount = number(expense.amount);
    const expenseCurrency = text(expense.currency, 3) as PurchaseCurrency;
    if (!title) continue;
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: `Расход ${index + 1}: некорректная сумма` };
    if (!PURCHASE_CURRENCIES.includes(expenseCurrency)) return { ok: false, error: `Расход ${index + 1}: некорректная валюта` };
    if (expenseCurrency !== "RUB" && expenseCurrency !== currency) return { ok: false, error: `Расход ${index + 1}: используйте RUB или валюту заказа ${currency}` };
    expenses.push({ title, amount, currency: expenseCurrency });
  }

  const paymentPercent = paymentStages.filter((stage) => stage.status !== "cancelled").reduce((sum, stage) => sum + stage.percent, 0);
  if (paymentPercent > 100.001) return { ok: false, error: "Сумма этапов оплаты не может превышать 100%" };
  if (status !== "draft" && status !== "cancelled" && items.length === 0) return { ok: false, error: "Перед запуском заказа добавьте хотя бы одну позицию" };
  if (status !== "draft" && status !== "cancelled" && Math.abs(paymentPercent - 100) > 0.001) return { ok: false, error: "Перед запуском заказа распределите оплату на 100%" };

  return {
    ok: true,
    value: {
      ...(id ? { id } : {}),
      cabinetId,
      orderNumber,
      supplier: text(source.supplier, 300),
      supplierId,
      orderDate,
      productionDays,
      expectedReadyDate: addDays(orderDate, productionDays),
      currency,
      exchangeRate,
      status,
      note: text(source.note, 5_000),
      ...(text(source.idempotencyKey, 100) ? { idempotencyKey: text(source.idempotencyKey, 100) } : {}),
      items,
      paymentStages,
      logisticsStages,
      expenses,
    },
  };
}
