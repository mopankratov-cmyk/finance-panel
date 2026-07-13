export type OperationalState = "ok" | "warning" | "error";
export type TimelineStageState = "done" | "active" | "planned" | "warning" | "overdue";

export interface OperationalAlert {
  key: string;
  severity: "warning" | "critical";
  title: string;
  detail: string;
  orderId?: string;
}

export interface OperationalStage {
  key: string;
  label: string;
  detail: string;
  startDate: string;
  dueDate: string | null;
  durationDays: number;
  state: TimelineStageState;
}

export interface OperationalOrder {
  id: string;
  orderNumber: string;
  supplier: string;
  status: string;
  orderDate: string;
  expectedReadyDate: string;
  itemsCount: number;
  quantity: number;
  progressPct: number;
  state: "healthy" | "warning" | "overdue" | "complete";
  stages: OperationalStage[];
  alerts: OperationalAlert[];
}

export interface HealthCheck {
  key: string;
  name: string;
  state: OperationalState;
  detail: string;
  updatedAt: string | null;
  href?: string;
}

export interface RawOperationalOrder {
  id: string;
  orderNumber: string;
  supplier: string;
  status: string;
  orderDate: string;
  expectedReadyDate: string;
  receiptBatchId: string | null;
  items: Array<{ nmId: number; quantity: number }>;
  logisticsStages: Array<{
    title: string;
    provider: string;
    dueDate: string | null;
    completedAt: string | null;
    status: string;
  }>;
}

export interface RawOperationalReceipt {
  batchId: string;
  expectedAt: string | null;
  receivedAt: string | null;
  status: "expected" | "received";
}

const DAY_MS = 86_400_000;

function dayValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(`${value.slice(0, 10)}T12:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDay(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function duration(start: string, end: string | null): number {
  const startMs = dayValue(start);
  const endMs = dayValue(end);
  if (startMs === null || endMs === null) return 1;
  return Math.max(1, Math.round((endMs - startMs) / DAY_MS));
}

function beforeToday(value: string | null, todayMs: number): boolean {
  const due = dayValue(value);
  return due !== null && due < todayMs;
}

function stageProgress(stage: OperationalStage, todayMs: number): number {
  if (stage.state === "done") return stage.durationDays;
  if (stage.state !== "active" && stage.state !== "overdue") return 0;
  const start = dayValue(stage.startDate);
  if (start === null) return 0;
  return Math.min(stage.durationDays, Math.max(0, Math.round((todayMs - start) / DAY_MS)));
}

export function buildOperationalOrder(
  order: RawOperationalOrder,
  allReceipts: RawOperationalReceipt[],
  now = new Date(),
): OperationalOrder {
  const todayMs = dayValue(now.toISOString()) ?? Date.now();
  const alerts: OperationalAlert[] = [];
  const stages: OperationalStage[] = [];
  const productionDone = order.status === "transit" || order.status === "received";
  const productionOverdue = !productionDone && beforeToday(order.expectedReadyDate, todayMs);
  stages.push({
    key: "production",
    label: "Производство",
    detail: productionDone ? "Товар готов" : `Готовность ${order.expectedReadyDate}`,
    startDate: order.orderDate,
    dueDate: order.expectedReadyDate,
    durationDays: duration(order.orderDate, order.expectedReadyDate),
    state: productionDone ? "done" : productionOverdue ? "overdue" : order.status === "production" ? "active" : "planned",
  });
  if (productionOverdue) alerts.push({ key: `${order.id}:production`, severity: "critical", title: `Заказ ${order.orderNumber}: производство просрочено`, detail: `Плановая готовность ${order.expectedReadyDate}`, orderId: order.id });

  let cursor = order.expectedReadyDate;
  if (!order.logisticsStages.length && ["production", "transit"].includes(order.status)) {
    alerts.push({ key: `${order.id}:logistics-missing`, severity: "warning", title: `Заказ ${order.orderNumber}: нет срока логистики`, detail: "Добавьте этап и плановую дату в заказе фабрике", orderId: order.id });
  }
  order.logisticsStages.forEach((stage, index) => {
    const done = stage.status === "done" || Boolean(stage.completedAt);
    const cancelled = stage.status === "cancelled";
    const dueDate = stage.dueDate ?? (stage.completedAt ? stage.completedAt.slice(0, 10) : null);
    const overdue = !done && !cancelled && beforeToday(dueDate, todayMs);
    const state: TimelineStageState = done ? "done" : overdue ? "overdue" : stage.status === "in_progress" ? "active" : cancelled ? "warning" : "planned";
    stages.push({
      key: `logistics-${index}`,
      label: stage.title || `Логистика ${index + 1}`,
      detail: stage.provider || (done ? "Завершено" : dueDate ? `До ${dueDate}` : "Срок не задан"),
      startDate: cursor,
      dueDate,
      durationDays: duration(cursor, dueDate),
      state,
    });
    if (overdue) alerts.push({ key: `${order.id}:logistics-${index}`, severity: "critical", title: `Заказ ${order.orderNumber}: задержка логистики`, detail: `${stage.title || "Этап логистики"} · срок ${dueDate}`, orderId: order.id });
    if (!dueDate && !done && !cancelled) alerts.push({ key: `${order.id}:logistics-date-${index}`, severity: "warning", title: `Заказ ${order.orderNumber}: у логистики нет даты`, detail: stage.title || `Этап ${index + 1}`, orderId: order.id });
    if (dueDate) cursor = dueDate;
  });

  const receipts = order.receiptBatchId ? allReceipts.filter((receipt) => receipt.batchId === order.receiptBatchId) : [];
  const receivingDone = receipts.length > 0 && receipts.every((receipt) => receipt.status === "received");
  const expectedReceipts = receipts.filter((receipt) => receipt.status === "expected");
  const receiptDue = expectedReceipts.map((receipt) => receipt.expectedAt).filter((value): value is string => Boolean(value)).sort()[0]
    ?? receipts.map((receipt) => receipt.receivedAt?.slice(0, 10) ?? null).filter((value): value is string => Boolean(value)).sort().at(-1)
    ?? null;
  const receivingOverdue = expectedReceipts.some((receipt) => beforeToday(receipt.expectedAt, todayMs));
  if (order.receiptBatchId || order.status === "transit" || order.status === "received") {
    stages.push({
      key: "receiving",
      label: "Приёмка",
      detail: receivingDone ? "Партия принята" : receiptDue ? `Ожидается ${receiptDue}` : "Ожидание факта",
      startDate: cursor,
      dueDate: receiptDue,
      durationDays: duration(cursor, receiptDue),
      state: receivingDone || order.status === "received" ? "done" : receivingOverdue ? "overdue" : receipts.length ? "active" : "warning",
    });
    if (receivingOverdue) alerts.push({ key: `${order.id}:receiving`, severity: "critical", title: `Заказ ${order.orderNumber}: приёмка просрочена`, detail: `Ожидалась ${receiptDue}`, orderId: order.id });
    if (!order.receiptBatchId && order.status === "transit") alerts.push({ key: `${order.id}:receiving-missing`, severity: "warning", title: `Заказ ${order.orderNumber}: приёмка не создана`, detail: "Передайте заказ в журнал приёмки", orderId: order.id });
  }

  const totalDays = stages.reduce((sum, stage) => sum + stage.durationDays, 0);
  const completedDays = stages.reduce((sum, stage) => sum + stageProgress(stage, todayMs), 0);
  const progressPct = order.status === "received" || receivingDone ? 100 : Math.min(99, Math.round((completedDays / Math.max(1, totalDays)) * 100));
  const state = order.status === "received" || receivingDone
    ? "complete"
    : alerts.some((alert) => alert.severity === "critical")
      ? "overdue"
      : alerts.length ? "warning" : "healthy";

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    supplier: order.supplier,
    status: order.status,
    orderDate: order.orderDate,
    expectedReadyDate: order.expectedReadyDate,
    itemsCount: order.items.length,
    quantity: order.items.reduce((sum, item) => sum + item.quantity, 0),
    progressPct,
    state,
    stages,
    alerts,
  };
}

export function freshnessState(
  updatedAt: string | null,
  now = new Date(),
  warningAfterHours = 30,
  errorAfterHours = 72,
): OperationalState {
  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) return "warning";
  const ageHours = Math.max(0, (now.getTime() - Date.parse(updatedAt)) / 3_600_000);
  if (ageHours > errorAfterHours) return "error";
  if (ageHours > warningAfterHours) return "warning";
  return "ok";
}

export function healthScore(checks: HealthCheck[]): number {
  if (!checks.length) return 0;
  const points = checks.reduce((sum, check) => sum + (check.state === "ok" ? 1 : check.state === "warning" ? 0.5 : 0), 0);
  return Math.round((points / checks.length) * 100);
}

export function addOperationalDays(value: string, days: number): string {
  const start = dayValue(value) ?? Date.now();
  return isoDay(start + Math.max(0, Math.round(days)) * DAY_MS);
}
