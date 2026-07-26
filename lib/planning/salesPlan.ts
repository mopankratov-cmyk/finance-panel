export type SalesPlanMarketplace = "wb" | "ozon";
export type SalesPlanStatus = "draft" | "review" | "approved";
export const SALES_PLAN_ACTIONS = ["save", "submit", "approve", "return", "new_version"] as const;
export type SalesPlanAction = (typeof SALES_PLAN_ACTIONS)[number];
export const SALES_PLAN_RETURN_COMMENT_MIN_LENGTH = 3;

export interface SalesPlanRow {
  id: string;
  model: string;
  modelName: string;
  variant: string;
  color: string;
  externalId: string;
  price: number;
  buyout: number;
  adPct: number;
  stock: number;
  image: string | null;
  isNew: boolean;
  months: Record<string, number[]>;
}
export interface SalesPlanDocument {
  schemaVersion: 1;
  marketplace: SalesPlanMarketplace;
  cabinetId: string;
  year: number;
  version: number;
  revision: number;
  status: SalesPlanStatus;
  responsible: string;
  rows: SalesPlanRow[];
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  returnedAt: string | null;
  returnedBy: string | null;
  returnComment: string | null;
  rnpSyncedAt: string | null;
}

export interface SalesPlanEnvelope {
  working: SalesPlanDocument | null;
  approved: SalesPlanDocument | null;
}

export interface SalesPlanValidationIssue {
  rowId?: string;
  field: string;
  message: string;
}

export interface SalesPlanDailyMetrics {
  orders: number;
  buyouts: number;
  gross: number;
  ads: number;
  revenue: number;
  drr: number;
}

export interface SalesPlanSummary extends SalesPlanDailyMetrics {
  buyoutPct: number;
  adPct: number;
  variants: number;
}

const MONTH_KEYS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = "") {
  const normalized = String(value ?? "").normalize("NFKC").trim();
  return normalized || fallback;
}

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function canModerateSalesPlan(user: { role?: string } | null | undefined) {
  return user?.role === "director" || user?.role === "finance";
}

export function normalizeSalesPlanAction(value: unknown, fallback: SalesPlanAction = "save"): SalesPlanAction | null {
  if (value === undefined || value === null || value === "") return fallback;
  return typeof value === "string" && SALES_PLAN_ACTIONS.includes(value as SalesPlanAction)
    ? (value as SalesPlanAction)
    : null;
}

export function normalizeSalesPlanReturnComment(value: unknown) {
  const comment = text(value).replace(/\s+/g, " ");
  return comment.length >= SALES_PLAN_RETURN_COMMENT_MIN_LENGTH ? comment.slice(0, 1000) : "";
}

export function daysInSalesPlanMonth(year: number, monthKey: string) {
  const month = Math.min(12, Math.max(1, Number(monthKey) || 1));
  return new Date(year, month, 0).getDate();
}

export function emptySalesPlanMonths(year: number): Record<string, number[]> {
  return Object.fromEntries(
    MONTH_KEYS.map((monthKey) => [
      monthKey,
      Array.from({ length: daysInSalesPlanMonth(year, monthKey) }, () => 0),
    ]),
  );
}

function normalizeMonthValues(value: unknown, days: number) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: days }, (_, index) => finite(source[index]));
}

export function normalizeSalesPlanRow(value: unknown, year: number, index = 0): SalesPlanRow {
  const source = record(value);
  const monthsSource = record(source.months);
  const variant = text(source.variant, `SKU-${index + 1}`);
  const model = text(source.model, inferModelArticle(variant));
  const color = text(source.color, inferColorFromVariant(variant));
  const months = Object.fromEntries(
    MONTH_KEYS.map((monthKey) => [
      monthKey,
      normalizeMonthValues(monthsSource[monthKey], daysInSalesPlanMonth(year, monthKey)),
    ]),
  );

  return {
    id: text(source.id, `${model}:${variant}:${index}`),
    model,
    modelName: text(source.modelName, variant),
    variant,
    color,
    externalId: text(source.externalId),
    price: finite(source.price),
    buyout: finite(source.buyout),
    adPct: finite(source.adPct),
    stock: Math.max(0, finite(source.stock)),
    image: text(source.image) || null,
    isNew: Boolean(source.isNew),
    months,
  };
}

export function normalizeSalesPlanDocument(
  value: unknown,
  context: { marketplace: SalesPlanMarketplace; cabinetId: string; year: number },
): SalesPlanDocument {
  const source = record(value);
  const now = new Date().toISOString();
  const status = source.status === "review" || source.status === "approved" ? source.status : "draft";
  return {
    schemaVersion: 1,
    marketplace: context.marketplace,
    cabinetId: context.cabinetId,
    year: context.year,
    version: Math.max(1, Math.round(finite(source.version, 1))),
    revision: Math.max(0, Math.round(finite(source.revision))),
    status,
    responsible: text(source.responsible),
    rows: Array.isArray(source.rows)
      ? source.rows.map((row, index) => normalizeSalesPlanRow(row, context.year, index))
      : [],
    createdAt: text(source.createdAt, now),
    updatedAt: text(source.updatedAt, now),
    approvedAt: text(source.approvedAt) || null,
    approvedBy: text(source.approvedBy) || null,
    submittedAt: text(source.submittedAt) || null,
    submittedBy: text(source.submittedBy) || null,
    returnedAt: text(source.returnedAt) || null,
    returnedBy: text(source.returnedBy) || null,
    returnComment: normalizeSalesPlanReturnComment(source.returnComment) || null,
    rnpSyncedAt: text(source.rnpSyncedAt) || null,
  };
}

export function createEmptySalesPlan(input: {
  marketplace: SalesPlanMarketplace;
  cabinetId: string;
  year: number;
  responsible?: string;
}): SalesPlanDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    marketplace: input.marketplace,
    cabinetId: input.cabinetId,
    year: input.year,
    version: 1,
    revision: 0,
    status: "draft",
    responsible: input.responsible ?? "",
    rows: [],
    createdAt: now,
    updatedAt: now,
    approvedAt: null,
    approvedBy: null,
    submittedAt: null,
    submittedBy: null,
    returnedAt: null,
    returnedBy: null,
    returnComment: null,
    rnpSyncedAt: null,
  };
}

export function inferModelArticle(variant: string) {
  const normalized = text(variant);
  const parts = normalized.split("-").filter(Boolean);
  return parts.length >= 4 ? parts.slice(0, -1).join("-") : normalized;
}

export function inferColorFromVariant(variant: string) {
  const normalized = text(variant);
  const parts = normalized.split("-").filter(Boolean);
  return parts.length >= 4 ? parts.at(-1)! : "Вариация";
}

export function salesPlanMonthLabel(year: number, monthKey: string, long = true) {
  return new Intl.DateTimeFormat("ru-RU", {
    month: long ? "long" : "short",
    year: long ? "numeric" : undefined,
    timeZone: "Europe/Moscow",
  }).format(new Date(Date.UTC(year, Math.max(0, Number(monthKey) - 1), 1)));
}

export function visibleSalesPlanMonths(_year: number, pivotMonth = new Date().getMonth() + 1) {
  const start = Math.min(12, Math.max(1, pivotMonth));
  return Array.from({ length: 13 - start }, (_, index) => String(start + index).padStart(2, "0"));
}

export function calculateSalesPlanDaily(row: SalesPlanRow, orders: number): SalesPlanDailyMetrics {
  const safeOrders = Number.isFinite(orders) ? orders : 0;
  const gross = Math.round(safeOrders * row.price);
  const buyouts = Math.round((safeOrders * row.buyout) / 100);
  const ads = Math.round((gross * row.adPct) / 100);
  return {
    orders: safeOrders,
    buyouts,
    gross,
    ads,
    revenue: Math.round(buyouts * row.price),
    drr: gross > 0 ? (ads / gross) * 100 : 0,
  };
}

export function calculateSalesPlanRowMonth(row: SalesPlanRow, monthKey: string): SalesPlanDailyMetrics {
  const orders = (row.months[monthKey] ?? []).reduce((sum, value) => sum + finite(value), 0);
  const gross = Math.round(orders * row.price);
  const buyouts = Math.round((orders * row.buyout) / 100);
  const ads = Math.round((gross * row.adPct) / 100);
  return {
    orders,
    buyouts,
    gross,
    ads,
    revenue: Math.round(buyouts * row.price),
    drr: gross > 0 ? (ads / gross) * 100 : 0,
  };
}

export function calculateSalesPlanSummary(
  plan: Pick<SalesPlanDocument, "rows">,
  monthKeys: string[],
): SalesPlanSummary {
  const summary = plan.rows.reduce(
    (total, row) => {
      for (const monthKey of monthKeys) {
        const current = calculateSalesPlanRowMonth(row, monthKey);
        total.orders += current.orders;
        total.buyouts += current.buyouts;
        total.gross += current.gross;
        total.ads += current.ads;
        total.revenue += current.revenue;
      }
      return total;
    },
    { orders: 0, buyouts: 0, gross: 0, ads: 0, revenue: 0 },
  );
  return {
    ...summary,
    drr: summary.gross > 0 ? (summary.ads / summary.gross) * 100 : 0,
    buyoutPct: summary.orders > 0 ? (summary.buyouts / summary.orders) * 100 : 0,
    adPct: summary.gross > 0 ? (summary.ads / summary.gross) * 100 : 0,
    variants: plan.rows.length,
  };
}

export function validateSalesPlan(plan: SalesPlanDocument): SalesPlanValidationIssue[] {
  const issues: SalesPlanValidationIssue[] = [];
  if (!plan.cabinetId) issues.push({ field: "cabinetId", message: "Не выбран кабинет" });
  if (!plan.responsible) issues.push({ field: "responsible", message: "Не указан ответственный" });
  if (plan.rows.length === 0) issues.push({ field: "rows", message: "Добавьте хотя бы один SKU" });

  const variants = new Map<string, string>();
  for (const row of plan.rows) {
    if (!row.model) issues.push({ rowId: row.id, field: "model", message: "Не указан артикул модели" });
    if (!row.color) issues.push({ rowId: row.id, field: "color", message: "Не указан цвет" });
    if (!row.variant) issues.push({ rowId: row.id, field: "variant", message: "Не указан артикул вариации" });
    const variantKey = row.variant.toLocaleLowerCase("ru-RU");
    if (variants.has(variantKey)) issues.push({ rowId: row.id, field: "variant", message: `Дубль вариации ${row.variant}` });
    else variants.set(variantKey, row.id);
    if (!(row.price > 0)) issues.push({ rowId: row.id, field: "price", message: `${row.variant}: цена должна быть больше нуля` });
    if (row.buyout < 0 || row.buyout > 100) issues.push({ rowId: row.id, field: "buyout", message: `${row.variant}: выкуп должен быть от 0 до 100%` });
    if (row.adPct < 0 || row.adPct > 100) issues.push({ rowId: row.id, field: "adPct", message: `${row.variant}: реклама должна быть от 0 до 100%` });
    for (const [monthKey, values] of Object.entries(row.months)) {
      values.forEach((value, day) => {
        if (!Number.isInteger(value) || value < 0) {
          issues.push({ rowId: row.id, field: `${monthKey}.${day + 1}`, message: `${row.variant}: заказы должны быть целыми и неотрицательными` });
        }
      });
    }
  }
  return issues;
}
