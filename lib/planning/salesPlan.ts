import { moscowCalendarDate } from "./mpstatsSeasonality";

export type SalesPlanMarketplace = "wb" | "ozon";
export type SalesPlanStatus = "draft" | "review" | "approved";
export const SALES_PLAN_ACTIONS = ["save", "submit", "approve", "return", "new_version"] as const;
export type SalesPlanAction = (typeof SALES_PLAN_ACTIONS)[number];
export const SALES_PLAN_EVENT_TYPES = ["created", "saved", "submitted", "resubmitted", "returned", "approved", "new_version"] as const;
export type SalesPlanEventType = (typeof SALES_PLAN_EVENT_TYPES)[number];
export const SALES_PLAN_RETURN_COMMENT_MIN_LENGTH = 3;

export interface SalesPlanMonthState {
  monthKey: string;
  status: SalesPlanStatus;
  version: number;
  revision: number;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  returnedAt: string | null;
  returnedBy: string | null;
  returnComment: string | null;
  rnpSyncedAt: string | null;
}

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
  openingStocks?: Record<string, number>;
  ffAllocatedStocks?: Record<string, number>;
  marketplaceStocks?: Record<string, SalesPlanStockSnapshot>;
  image: string | null;
  isNew: boolean;
  months: Record<string, number[]>;
}

export type SalesPlanStockSnapshot = {
  quantity: number;
  asOf: string | null;
  stale: boolean;
  unavailableReason?: never;
} | {
  quantity: null;
  asOf: null;
  stale: false;
  unavailableReason: "not_found";
};

export interface SalesPlanCatalogRequestScope {
  contextScope: string;
  requestScope: string;
}

export function isSalesPlanCatalogResponseCurrent(
  request: SalesPlanCatalogRequestScope,
  current: SalesPlanCatalogRequestScope,
) {
  return request.contextScope === current.contextScope
    && request.requestScope === current.requestScope;
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
  monthStates: Partial<Record<string, SalesPlanMonthState>>;
  rnpSyncedAt: string | null;
}

export interface SalesPlanEnvelope {
  working: SalesPlanDocument | null;
  approved: SalesPlanDocument | null;
  approvedByMonth: Partial<Record<string, SalesPlanDocument>>;
  events: SalesPlanEvent[];
}

export interface SalesPlanEvent {
  id: string;
  type: SalesPlanEventType;
  at: string;
  actor: string;
  role: string;
  monthKey: string | null;
  version: number;
  revision: number;
  comment: string | null;
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

export interface SalesPlanStockRisk {
  forecastAvailable: boolean;
  unavailableReason: string | null;
  currentStock: number;
  ffAllocated: number;
  marketplaceStock: number;
  marketplaceAsOf: string | null;
  marketplaceStale: boolean;
  remainingOrders: number;
  targetMonthOrders: number;
  plannedOrders: number;
  plannedBuyouts: number;
  endingStock: number;
  shortageDay: number | null;
  shortageQty: number;
}

export interface SalesPlanStockRiskSummary extends SalesPlanStockRisk {
  shortageRows: number;
}

export type SalesPlanSuggestionConfidence = "high" | "medium" | "low" | "unavailable";

export interface SalesPlanSuggestionBasis {
  stock: number;
  ordersWeek: number;
  revenueWeek: number;
  ordersMonth: number;
  revenueMonth: number;
  seasonalityFactor?: number;
  seasonalityRawFactor?: number;
  seasonalitySource?: string;
  seasonalitySubject?: string;
  seasonalityNote?: string;
  demandFactor?: number;
}

export interface SalesPlanSuggestionRow {
  rowId: string;
  variant: string;
  currentOrders: number;
  proposedOrders: number;
  dailyOrders: number;
  changedCells: number;
  avgDaily7: number;
  seasonalityFactor: number;
  seasonalityRawFactor: number;
  seasonalitySource: string;
  seasonalitySubject: string;
  seasonalityNote: string;
  demandFactor: number;
  endingStock: number;
  confidence: SalesPlanSuggestionConfidence;
  warnings: string[];
  proposedDays: number[];
}

export interface SalesPlanSuggestion {
  monthKey: string;
  replaceFilled: boolean;
  currentOrders: number;
  proposedOrders: number;
  deltaOrders: number;
  changedCells: number;
  rows: SalesPlanSuggestionRow[];
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

function isSalesPlanEventType(value: unknown): value is SalesPlanEventType {
  return typeof value === "string" && SALES_PLAN_EVENT_TYPES.includes(value as SalesPlanEventType);
}

function normalizeSalesPlanEvent(value: unknown, index = 0): SalesPlanEvent | null {
  const source = record(value);
  const type = isSalesPlanEventType(source.type) ? source.type : null;
  if (!type) return null;
  const at = text(source.at);
  const actor = text(source.actor);
  if (!at || !actor) return null;
  const monthKey = normalizeSalesPlanMonthKey(source.monthKey) || null;
  const version = Math.max(1, Math.round(finite(source.version, 1)));
  const revision = Math.max(0, Math.round(finite(source.revision, 0)));
  return {
    id: text(source.id, `legacy-${index}-${type}-${at}`),
    type,
    at,
    actor,
    role: text(source.role, "unknown"),
    monthKey,
    version,
    revision,
    comment: text(source.comment) || null,
  };
}

export function normalizeSalesPlanEvents(value: unknown): SalesPlanEvent[] {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((event, index) => normalizeSalesPlanEvent(event, index))
    .filter((event): event is SalesPlanEvent => Boolean(event));
}

export function appendSalesPlanEvent(
  events: SalesPlanEvent[],
  input: Omit<SalesPlanEvent, "id"> & { id?: string },
): SalesPlanEvent[] {
  const normalizedMonth = normalizeSalesPlanMonthKey(input.monthKey) || null;
  const event: SalesPlanEvent = {
    id: input.id || `${input.at}:${input.type}:${normalizedMonth ?? "all"}:${input.version}:${input.revision}:${events.length}`,
    type: input.type,
    at: input.at,
    actor: input.actor,
    role: input.role,
    monthKey: normalizedMonth,
    version: Math.max(1, Math.round(input.version)),
    revision: Math.max(0, Math.round(input.revision)),
    comment: input.comment ? normalizeSalesPlanReturnComment(input.comment) || text(input.comment).slice(0, 1000) : null,
  };
  return [...events, event];
}

export function normalizeSalesPlanReturnComment(value: unknown) {
  const comment = text(value).replace(/\s+/g, " ");
  return comment.length >= SALES_PLAN_RETURN_COMMENT_MIN_LENGTH ? comment.slice(0, 1000) : "";
}

export function normalizeSalesPlanMonthKey(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1 || number > 12) return "";
  return String(number).padStart(2, "0");
}

function normalizeSalesPlanMonthState(
  value: unknown,
  monthKey: string,
  fallback: Partial<SalesPlanMonthState> & { status: SalesPlanStatus },
): SalesPlanMonthState {
  const source = record(value);
  const has = (field: string) => Object.prototype.hasOwnProperty.call(source, field);
  const nullableText = (field: string, fallbackValue: string | null | undefined) => has(field)
    ? text(source[field]) || null
    : fallbackValue ?? null;
  const status = source.status === "draft" || source.status === "review" || source.status === "approved" ? source.status : fallback.status;
  return {
    monthKey,
    status,
    version: Math.max(1, Math.round(finite(source.version, fallback.version ?? 1))),
    revision: Math.max(0, Math.round(finite(source.revision, fallback.revision ?? 0))),
    submittedAt: nullableText("submittedAt", fallback.submittedAt),
    submittedBy: nullableText("submittedBy", fallback.submittedBy),
    approvedAt: nullableText("approvedAt", fallback.approvedAt),
    approvedBy: nullableText("approvedBy", fallback.approvedBy),
    returnedAt: nullableText("returnedAt", fallback.returnedAt),
    returnedBy: nullableText("returnedBy", fallback.returnedBy),
    returnComment: has("returnComment")
      ? normalizeSalesPlanReturnComment(source.returnComment) || null
      : fallback.returnComment ?? null,
    rnpSyncedAt: nullableText("rnpSyncedAt", fallback.rnpSyncedAt),
  };
}

function normalizeSalesPlanMonthStates(
  value: unknown,
  fallback: Partial<SalesPlanMonthState> & { status: SalesPlanStatus },
) {
  const source = record(value);
  return Object.fromEntries(
    MONTH_KEYS.map((monthKey) => [monthKey, normalizeSalesPlanMonthState(source[monthKey], monthKey, fallback)]),
  ) as Record<string, SalesPlanMonthState>;
}

export function getSalesPlanMonthState(plan: SalesPlanDocument, monthKey: string): SalesPlanMonthState {
  const normalizedMonth = normalizeSalesPlanMonthKey(monthKey) || "01";
  return normalizeSalesPlanMonthState(plan.monthStates?.[normalizedMonth], normalizedMonth, {
    status: plan.status,
    version: plan.version,
    revision: plan.revision,
    submittedAt: plan.submittedAt,
    submittedBy: plan.submittedBy,
    approvedAt: plan.approvedAt,
    approvedBy: plan.approvedBy,
    returnedAt: plan.returnedAt,
    returnedBy: plan.returnedBy,
    returnComment: plan.returnComment,
    rnpSyncedAt: plan.rnpSyncedAt,
  });
}

export function summarizeSalesPlanStatus(plan: Pick<SalesPlanDocument, "monthStates" | "status">): SalesPlanStatus {
  const states = MONTH_KEYS.map((monthKey) => plan.monthStates?.[monthKey]?.status ?? plan.status);
  if (states.some((status) => status === "review")) return "review";
  if (states.length > 0 && states.every((status) => status === "approved")) return "approved";
  return "draft";
}

export function setSalesPlanMonthState(
  plan: SalesPlanDocument,
  monthKey: string,
  patch: Partial<SalesPlanMonthState> & { status: SalesPlanStatus },
): SalesPlanDocument {
  const normalizedMonth = normalizeSalesPlanMonthKey(monthKey) || "01";
  const current = getSalesPlanMonthState(plan, normalizedMonth);
  const monthState = normalizeSalesPlanMonthState({ ...current, ...patch, monthKey: normalizedMonth }, normalizedMonth, current);
  const next = {
    ...plan,
    monthStates: {
      ...plan.monthStates,
      [normalizedMonth]: monthState,
    },
  };
  return { ...next, status: summarizeSalesPlanStatus(next) };
}

export function getApprovedSalesPlanForMonth(envelope: SalesPlanEnvelope, monthKey: string) {
  const normalizedMonth = normalizeSalesPlanMonthKey(monthKey);
  if (!normalizedMonth) return null;
  const monthly = envelope.approvedByMonth[normalizedMonth];
  if (monthly && getSalesPlanMonthState(monthly, normalizedMonth).status === "approved") return monthly;
  if (!envelope.approved) return null;
  return getSalesPlanMonthState(envelope.approved, normalizedMonth).status === "approved" ? envelope.approved : null;
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

export function emptySalesPlanOpeningStocks(stock = 0): Record<string, number> {
  const openingStock = Math.max(0, Math.round(finite(stock)));
  return Object.fromEntries(MONTH_KEYS.map((monthKey) => [monthKey, openingStock]));
}

function normalizeMonthValues(value: unknown, days: number) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: days }, (_, index) => finite(source[index]));
}

function normalizeStockSnapshot(value: unknown): SalesPlanStockSnapshot | null {
  const source = record(value);
  if (!Object.hasOwn(source, "quantity")) return null;
  if (source.quantity === null) {
    return { quantity: null, asOf: null, stale: false, unavailableReason: "not_found" };
  }
  return {
    quantity: Math.max(0, Math.round(finite(source.quantity))),
    asOf: text(source.asOf) || null,
    stale: Boolean(source.stale),
  };
}

export function salesPlanForecastUnavailableLabel(reason: string | null) {
  return `Прогноз недоступен: ${reason ?? "причина не указана"}`;
}

export function normalizeSalesPlanRow(value: unknown, year: number, index = 0): SalesPlanRow {
  const source = record(value);
  const monthsSource = record(source.months);
  const variant = text(source.variant, `SKU-${index + 1}`);
  const model = text(source.model, inferModelArticle(variant));
  const color = text(source.color, inferColorFromVariant(variant));
  const stock = Math.max(0, finite(source.stock));
  const openingStocksSource = record(source.openingStocks);
  const ffAllocatedStocksSource = record(source.ffAllocatedStocks);
  const marketplaceStocksSource = record(source.marketplaceStocks);
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
    stock,
    openingStocks: Object.fromEntries(MONTH_KEYS.map((monthKey) => [
      monthKey,
      Math.max(0, finite(openingStocksSource[monthKey], stock)),
    ])),
    ffAllocatedStocks: Object.keys(ffAllocatedStocksSource).length > 0
      ? Object.fromEntries(MONTH_KEYS.map((monthKey) => [
        monthKey,
        Math.max(0, Math.round(finite(ffAllocatedStocksSource[monthKey]))),
      ]))
      : undefined,
    marketplaceStocks: Object.fromEntries(MONTH_KEYS.flatMap((monthKey) => {
      const snapshot = normalizeStockSnapshot(marketplaceStocksSource[monthKey]);
      return snapshot ? [[monthKey, snapshot]] : [];
    })),
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
  const version = Math.max(1, Math.round(finite(source.version, 1)));
  const revision = Math.max(0, Math.round(finite(source.revision)));
  const approvedAt = text(source.approvedAt) || null;
  const approvedBy = text(source.approvedBy) || null;
  const submittedAt = text(source.submittedAt) || null;
  const submittedBy = text(source.submittedBy) || null;
  const returnedAt = text(source.returnedAt) || null;
  const returnedBy = text(source.returnedBy) || null;
  const returnComment = normalizeSalesPlanReturnComment(source.returnComment) || null;
  const rnpSyncedAt = text(source.rnpSyncedAt) || null;
  return {
    schemaVersion: 1,
    marketplace: context.marketplace,
    cabinetId: context.cabinetId,
    year: context.year,
    version,
    revision,
    status,
    responsible: text(source.responsible),
    rows: Array.isArray(source.rows)
      ? source.rows.map((row, index) => normalizeSalesPlanRow(row, context.year, index))
      : [],
    createdAt: text(source.createdAt, now),
    updatedAt: text(source.updatedAt, now),
    approvedAt,
    approvedBy,
    submittedAt,
    submittedBy,
    returnedAt,
    returnedBy,
    returnComment,
    monthStates: normalizeSalesPlanMonthStates(source.monthStates, {
      status,
      version,
      revision,
      approvedAt,
      approvedBy,
      submittedAt,
      submittedBy,
      returnedAt,
      returnedBy,
      returnComment,
      rnpSyncedAt,
    }),
    rnpSyncedAt,
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
    monthStates: normalizeSalesPlanMonthStates(null, { status: "draft", version: 1, revision: 0 }),
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

export function salesPlanOpeningStock(row: SalesPlanRow, monthKey: string) {
  return Math.max(0, Math.round(finite(row.openingStocks?.[monthKey], row.stock)));
}

export function salesPlanFfAllocated(row: SalesPlanRow, monthKey: string) {
  return Math.max(0, Math.round(finite(row.ffAllocatedStocks?.[monthKey])));
}

export function salesPlanMarketplaceStock(row: SalesPlanRow, monthKey: string) {
  return row.marketplaceStocks?.[monthKey] ?? null;
}

export function refreshSalesPlanMarketplaceStocks(
  plan: SalesPlanDocument,
  monthKey: string,
  catalog: { externalId: string; variant: string; stock: number; stockAsOf?: string | null }[],
  options: { failed?: boolean; asOf?: string | null } = {},
) {
  if (getSalesPlanMonthState(plan, monthKey).status !== "draft") return plan;
  const externalIdCounts = new Map<string, number>();
  for (const sku of catalog) {
    if (sku.externalId) externalIdCounts.set(sku.externalId, (externalIdCounts.get(sku.externalId) ?? 0) + 1);
  }
  const externalIds = new Map(catalog
    .filter((sku) => sku.externalId && externalIdCounts.get(sku.externalId) === 1)
    .map((sku) => [sku.externalId, sku]));
  const catalogVariantCounts = new Map<string, number>();
  const planVariantCounts = new Map<string, number>();
  for (const sku of catalog) {
    const key = sku.variant.toLocaleLowerCase("ru-RU");
    catalogVariantCounts.set(key, (catalogVariantCounts.get(key) ?? 0) + 1);
  }
  for (const row of plan.rows) {
    const key = row.variant.toLocaleLowerCase("ru-RU");
    planVariantCounts.set(key, (planVariantCounts.get(key) ?? 0) + 1);
  }
  const changedRows = plan.rows.map((row) => {
    const previous = row.marketplaceStocks?.[monthKey];
    const variantKey = row.variant.toLocaleLowerCase("ru-RU");
    const stableExternalId = text(row.externalId);
    const fallback = !stableExternalId
      && catalogVariantCounts.get(variantKey) === 1
      && planVariantCounts.get(variantKey) === 1
      ? catalog.find((sku) => sku.variant.toLocaleLowerCase("ru-RU") === variantKey)
      : undefined;
    const match = options.failed ? undefined : (externalIds.get(stableExternalId) ?? fallback);
    const snapshot: SalesPlanStockSnapshot | undefined = match
      ? {
        quantity: Math.max(0, Math.round(finite(match.stock))),
        asOf: !text(match.stockAsOf)
          && previous?.quantity === Math.max(0, Math.round(finite(match.stock)))
          && previous.stale === false
          ? previous.asOf
          : text(match.stockAsOf ?? options.asOf) || null,
        stale: false,
      }
      : previous
        ? previous.quantity !== null
          ? { ...previous, stale: true }
          : options.failed
            ? previous
            : { quantity: null, asOf: null, stale: false, unavailableReason: "not_found" }
        : options.failed
          ? undefined
          : { quantity: null, asOf: null, stale: false, unavailableReason: "not_found" };
    if (!snapshot || (
      previous?.quantity === snapshot.quantity
      && previous.asOf === snapshot.asOf
      && previous.stale === snapshot.stale
      && previous.unavailableReason === snapshot.unavailableReason
    )) return row;
    return {
      ...row,
      marketplaceStocks: { ...row.marketplaceStocks, [monthKey]: snapshot },
    };
  });
  return changedRows.every((row, index) => row === plan.rows[index]) ? plan : { ...plan, rows: changedRows };
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

export function calculateSalesPlanRowStockRisk(row: SalesPlanRow, monthKey: string, year?: number): SalesPlanStockRisk {
  const orders = row.months[monthKey] ?? [];
  const snapshot = salesPlanMarketplaceStock(row, monthKey);
  const ffAllocated = salesPlanFfAllocated(row, monthKey);
  const marketplaceStock = snapshot?.quantity ?? 0;
  const currentStock = snapshot?.quantity !== null && snapshot?.quantity !== undefined
    ? ffAllocated + marketplaceStock
    : row.isNew
      ? ffAllocated
      : salesPlanOpeningStock(row, monthKey);
  const snapshotDate = snapshot?.asOf ? new Date(snapshot.asOf) : null;
  const validSnapshotDate = snapshotDate && Number.isFinite(snapshotDate.getTime()) ? snapshotDate : null;
  const [snapshotYear, snapshotMonth, snapshotDay] = validSnapshotDate
    ? moscowCalendarDate(validSnapshotDate).split("-").map(Number)
    : [0, 0, 0];
  const targetYear = year ?? (snapshotYear || new Date().getFullYear());
  const forecastAvailable = snapshot?.unavailableReason === "not_found"
    ? false
    : snapshot
    ? Boolean(validSnapshotDate && snapshotYear === targetYear)
    : !row.isNew;
  const unavailableReason = forecastAvailable
    ? null
    : snapshot?.unavailableReason === "not_found"
      ? "SKU или остаток не найден в актуальном каталоге"
    : !snapshot
      ? "нет снимка маркетплейса"
      : validSnapshotDate
      ? "нет непрерывного плана через границу года"
      : "нет даты снимка маркетплейса";
  const snapshotIsTargetMonth = validSnapshotDate
    && snapshotYear === targetYear
    && snapshotMonth === Number(monthKey);
  const targetStartIndex = snapshotIsTargetMonth ? snapshotDay : 0;
  let remainingOrders = 0;
  if (snapshot && validSnapshotDate && forecastAvailable) {
    const targetMonth = Number(monthKey);
    for (let currentMonth = 1; currentMonth <= 12; currentMonth += 1) {
      const afterSnapshotMonth = targetYear > snapshotYear || currentMonth > snapshotMonth;
      const isSnapshotMonth = targetYear === snapshotYear && currentMonth === snapshotMonth;
      if (currentMonth >= targetMonth) break;
      if (!afterSnapshotMonth && !isSnapshotMonth) continue;
      const values = row.months[String(currentMonth).padStart(2, "0")] ?? [];
      const fromIndex = isSnapshotMonth ? snapshotDay : 0;
      remainingOrders += values.slice(fromIndex).reduce((sum, value) => sum + Math.max(0, finite(value)), 0);
    }
  }
  let cumulativeOrders = 0;
  let shortageDay: number | null = null;
  const buyoutRate = Math.max(0, finite(row.buyout)) / 100;

  for (let index = targetStartIndex; index < orders.length; index += 1) {
    cumulativeOrders += Math.max(0, finite(orders[index]));
    if (shortageDay === null && (remainingOrders + cumulativeOrders) * buyoutRate > currentStock) {
      shortageDay = index + 1;
    }
  }

  const targetMonthOrders = Math.round(cumulativeOrders);
  const plannedOrders = Math.round(remainingOrders + cumulativeOrders);
  const plannedBuyouts = Math.round((remainingOrders + cumulativeOrders) * buyoutRate);
  const endingStock = currentStock - plannedBuyouts;
  return {
    forecastAvailable,
    unavailableReason,
    currentStock,
    ffAllocated,
    marketplaceStock,
    marketplaceAsOf: snapshot?.asOf ?? null,
    marketplaceStale: snapshot?.stale ?? false,
    remainingOrders: Math.round(remainingOrders),
    targetMonthOrders,
    plannedOrders,
    plannedBuyouts,
    endingStock,
    shortageDay: forecastAvailable ? shortageDay : null,
    shortageQty: forecastAvailable && endingStock < 0 ? Math.abs(endingStock) : 0,
  };
}

export function calculateSalesPlanStockRiskSummary(
  plan: Pick<SalesPlanDocument, "rows"> & Partial<Pick<SalesPlanDocument, "year">>,
  monthKey: string,
): SalesPlanStockRiskSummary {
  const risks = plan.rows.map((row) => calculateSalesPlanRowStockRisk(row, monthKey, "year" in plan ? plan.year : undefined));
  const summary = risks.reduce<SalesPlanStockRiskSummary>(
    (total, risk) => {
      total.currentStock += risk.currentStock;
      total.forecastAvailable &&= risk.forecastAvailable;
      total.unavailableReason ??= risk.unavailableReason;
      total.ffAllocated += risk.ffAllocated;
      total.marketplaceStock += risk.marketplaceStock;
      total.marketplaceStale ||= risk.marketplaceStale;
      total.remainingOrders += risk.remainingOrders;
      total.targetMonthOrders += risk.targetMonthOrders;
      total.plannedOrders += risk.plannedOrders;
      total.plannedBuyouts += risk.plannedBuyouts;
      total.endingStock += risk.endingStock;
      total.shortageQty += risk.shortageQty;
      if (risk.shortageDay !== null) {
        total.shortageRows += 1;
        total.shortageDay = total.shortageDay === null ? risk.shortageDay : Math.min(total.shortageDay, risk.shortageDay);
      }
      return total;
    },
    {
      currentStock: 0,
      forecastAvailable: true,
      unavailableReason: null,
      ffAllocated: 0,
      marketplaceStock: 0,
      marketplaceAsOf: null,
      marketplaceStale: false,
      remainingOrders: 0,
      targetMonthOrders: 0,
      plannedOrders: 0,
      plannedBuyouts: 0,
      endingStock: 0,
      shortageDay: null,
      shortageQty: 0,
      shortageRows: 0,
    } as SalesPlanStockRiskSummary,
  );
  return summary;
}

function suggestionFactor(value: unknown) {
  const number = finite(value, 1);
  return number > 0 ? number : 1;
}

function suggestionConfidence(basis: SalesPlanSuggestionBasis | undefined): SalesPlanSuggestionConfidence {
  if (!basis) return "unavailable";
  if (basis.ordersWeek >= 14) return "high";
  if (basis.ordersWeek >= 4) return "medium";
  if (basis.ordersMonth > 0) return "low";
  return "unavailable";
}

export function calculateSalesPlanSuggestedDailyOrders(basis: SalesPlanSuggestionBasis | undefined) {
  if (!basis) return 0;
  const avgDaily7 = Math.max(0, finite(basis.ordersWeek) / 7);
  const proposed = avgDaily7 * suggestionFactor(basis.seasonalityFactor) * suggestionFactor(basis.demandFactor);
  return Math.max(0, Math.round(proposed));
}

export function buildSalesPlanSuggestion(
  plan: SalesPlanDocument,
  monthKey: string,
  basisByRowId: Record<string, SalesPlanSuggestionBasis | undefined>,
  options: { replaceFilled?: boolean } = {},
): SalesPlanSuggestion {
  const days = daysInSalesPlanMonth(plan.year, monthKey);
  const replaceFilled = Boolean(options.replaceFilled);
  const rows = plan.rows.map((row): SalesPlanSuggestionRow => {
    const basis = basisByRowId[row.id];
    const currentDays = Array.from({ length: days }, (_, index) => Math.max(0, finite(row.months[monthKey]?.[index])));
    const dailyOrders = calculateSalesPlanSuggestedDailyOrders(basis);
    const proposedDays = currentDays.map((value) => replaceFilled || value <= 0 ? dailyOrders : value);
    const currentOrders = Math.round(currentDays.reduce((sum, value) => sum + value, 0));
    const proposedOrders = Math.round(proposedDays.reduce((sum, value) => sum + value, 0));
    const changedCells = proposedDays.reduce((count, value, index) => count + (value !== currentDays[index] ? 1 : 0), 0);
    const stock = salesPlanOpeningStock(row, monthKey);
    const plannedBuyouts = Math.round((proposedOrders * Math.max(0, finite(row.buyout))) / 100);
    const endingStock = stock - plannedBuyouts;
    const confidence = suggestionConfidence(basis);
    const warnings: string[] = [];
    if (!basis) warnings.push("нет фактической базы");
    else if (basis.ordersWeek <= 0) warnings.push("нет заказов за 7 дней");
    const seasonalityFactor = suggestionFactor(basis?.seasonalityFactor);
    const seasonalityRawFactor = suggestionFactor(basis?.seasonalityRawFactor);
    if (basis?.seasonalitySource === "unavailable") warnings.push("сезонность MPSTATS недоступна");
    if (seasonalityRawFactor > seasonalityFactor + 0.01) {
      warnings.push(`рынок ${seasonalityRawFactor.toLocaleString("ru-RU")}× ограничен до ${seasonalityFactor.toLocaleString("ru-RU")}×`);
    }
    if (endingStock < 0) warnings.push(`дефицит ${Math.abs(endingStock).toLocaleString("ru-RU")} шт.`);
    if (!replaceFilled && currentDays.some((value) => value > 0)) warnings.push("ручные ячейки сохранены");
    return {
      rowId: row.id,
      variant: row.variant,
      currentOrders,
      proposedOrders,
      dailyOrders,
      changedCells,
      avgDaily7: basis ? Math.max(0, finite(basis.ordersWeek) / 7) : 0,
      seasonalityFactor,
      seasonalityRawFactor,
      seasonalitySource: basis?.seasonalitySource ?? "",
      seasonalitySubject: basis?.seasonalitySubject ?? "",
      seasonalityNote: basis?.seasonalityNote ?? "",
      demandFactor: suggestionFactor(basis?.demandFactor),
      endingStock,
      confidence,
      warnings,
      proposedDays,
    };
  });
  const currentOrders = rows.reduce((sum, row) => sum + row.currentOrders, 0);
  const proposedOrders = rows.reduce((sum, row) => sum + row.proposedOrders, 0);
  return {
    monthKey,
    replaceFilled,
    currentOrders,
    proposedOrders,
    deltaOrders: proposedOrders - currentOrders,
    changedCells: rows.reduce((sum, row) => sum + row.changedCells, 0),
    rows,
  };
}

export function applySalesPlanSuggestion(plan: SalesPlanDocument, suggestion: SalesPlanSuggestion): SalesPlanDocument {
  const byRow = new Map(suggestion.rows.map((row) => [row.rowId, row.proposedDays]));
  return {
    ...plan,
    rows: plan.rows.map((row) => {
      const proposedDays = byRow.get(row.id);
      if (!proposedDays) return row;
      return { ...row, months: { ...row.months, [suggestion.monthKey]: proposedDays } };
    }),
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

export function validateSalesPlanMonth(plan: SalesPlanDocument, monthKey: string): SalesPlanValidationIssue[] {
  const issues = validateSalesPlan(plan);
  const normalizedMonth = normalizeSalesPlanMonthKey(monthKey);
  if (!normalizedMonth) {
    return [...issues, { field: "monthKey", message: "Не выбран месяц плана" }];
  }
  if (calculateSalesPlanSummary(plan, [normalizedMonth]).orders <= 0) {
    issues.push({
      field: `${normalizedMonth}.orders`,
      message: `Заполните план заказов на ${salesPlanMonthLabel(plan.year, normalizedMonth, false)}`,
    });
  }
  return issues;
}
