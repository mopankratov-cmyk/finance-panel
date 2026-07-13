import { purchaseOrderTotals, type PurchaseOrderInput } from "./order";

export interface PurchaseOrderView extends PurchaseOrderInput {
  id: string;
  receiptBatchId: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  totals: ReturnType<typeof purchaseOrderTotals>;
}

type DbRecord = Record<string, unknown>;

const rows = (value: unknown): DbRecord[] => Array.isArray(value) ? value.filter((entry): entry is DbRecord => Boolean(entry) && typeof entry === "object") : [];
const string = (value: unknown): string => typeof value === "string" ? value : "";
const nullableString = (value: unknown): string | null => typeof value === "string" && value ? value : null;
const number = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;

export function purchaseOrderFromDb(row: DbRecord): PurchaseOrderView {
  const order: PurchaseOrderInput = {
    id: string(row.id),
    cabinetId: string(row.cabinet_id),
    orderNumber: string(row.order_number),
    supplier: string(row.supplier),
    orderDate: string(row.order_date),
    productionDays: number(row.production_days),
    expectedReadyDate: string(row.expected_ready_date),
    currency: string(row.currency) as PurchaseOrderInput["currency"],
    exchangeRate: number(row.exchange_rate),
    status: string(row.status) as PurchaseOrderInput["status"],
    note: string(row.note),
    idempotencyKey: string(row.idempotency_key) || undefined,
    items: rows(row.purchase_order_items)
      .map((item) => ({
        nmId: number(item.nm_id),
        article: string(item.article),
        name: string(item.name),
        quantity: number(item.quantity),
        unitPrice: number(item.unit_price),
      }))
      .sort((a, b) => a.article.localeCompare(b.article, "ru") || a.nmId - b.nmId),
    paymentStages: rows(row.purchase_payment_stages)
      .sort((a, b) => number(a.position) - number(b.position))
      .map((stage) => ({
        title: string(stage.title),
        percent: number(stage.percent),
        amount: number(stage.amount),
        dueDate: nullableString(stage.due_date),
        paidAt: nullableString(stage.paid_at),
        status: string(stage.status) as PurchaseOrderInput["paymentStages"][number]["status"],
      })),
    logisticsStages: rows(row.purchase_logistics_stages)
      .sort((a, b) => number(a.position) - number(b.position))
      .map((stage) => ({
        title: string(stage.title),
        provider: string(stage.provider),
        dueDate: nullableString(stage.due_date),
        completedAt: nullableString(stage.completed_at),
        cost: number(stage.cost),
        status: string(stage.status) as PurchaseOrderInput["logisticsStages"][number]["status"],
      })),
    expenses: rows(row.purchase_expenses)
      .sort((a, b) => number(a.position) - number(b.position))
      .map((expense) => ({
        title: string(expense.title),
        amount: number(expense.amount),
        currency: string(expense.currency) as PurchaseOrderInput["expenses"][number]["currency"],
      })),
  };

  return {
    ...order,
    id: string(row.id),
    receiptBatchId: nullableString(row.receipt_batch_id),
    createdBy: nullableString(row.created_by),
    updatedBy: nullableString(row.updated_by),
    createdAt: string(row.created_at),
    updatedAt: string(row.updated_at),
    totals: purchaseOrderTotals(order),
  };
}

export const PURCHASE_ORDER_SELECT = "*, purchase_order_items(*), purchase_payment_stages(*), purchase_logistics_stages(*), purchase_expenses(*)";
