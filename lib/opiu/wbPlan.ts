import {
  calculateSalesPlanRowMonth,
  type SalesPlanDocument,
  type SalesPlanRow,
} from "@/lib/planning/salesPlan";

// §2. Прогноз WB читает план из planning_state → sales_plan_v1 → wb → cabinetId,
// а не из устаревшей (пустой) таблицы sales_plan. Логика выбора документа
// повторяет уже проверенную схему Ozon-прогноза (planForMonth), чтобы источник
// плана вёл себя одинаково на обоих маркетплейсах.

export type WbPlanSource = "approved_sales_plan" | "working_sales_plan" | "none";

export interface WbPlanArticle {
  /** Артикул продавца (row.variant), нормализованный в верхний регистр. */
  article: string;
  /** Плановая выручка месяца = выкупы × цена (реализация), совпадает с базой payoutRate. */
  planRevenue: number;
  planOrders: number;
  planBuyouts: number;
  externalId: string;
  model: string;
  price: number;
  buyout: number;
}

export interface WbPlanSelection {
  source: WbPlanSource;
  articles: WbPlanArticle[];
  planRevenue: number;
  planOrders: number;
}

interface WbPlanEnvelope {
  approvedByMonth?: Record<string, SalesPlanDocument | undefined>;
  approved?: SalesPlanDocument | null;
  working?: SalesPlanDocument | null;
}

const numberOrZero = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

function asEnvelope(value: unknown): WbPlanEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as WbPlanEnvelope;
}

function planRows(document: SalesPlanDocument | null | undefined): SalesPlanRow[] {
  return Array.isArray(document?.rows) ? document!.rows : [];
}

function hasMonthOrders(
  document: SalesPlanDocument | null | undefined,
  monthKey: string,
) {
  return planRows(document).some((row) =>
    (row.months?.[monthKey] ?? []).some((orders) => numberOrZero(orders) > 0));
}

/**
 * Выбирает документ плана строго за один месяц с приоритетом утверждённой версии.
 * Возвращает null, если ни в утверждённом, ни в рабочем плане нет заказов на месяц.
 */
export function selectWbPlanDocument(
  value: unknown,
  monthKey: string,
): { document: SalesPlanDocument; source: Exclude<WbPlanSource, "none"> } | null {
  const envelope = asEnvelope(value);
  if (!envelope) return null;

  const approvedForMonth = envelope.approvedByMonth?.[monthKey];
  const approved = approvedForMonth
    ?? (hasMonthOrders(envelope.approved, monthKey) ? envelope.approved ?? undefined : undefined);
  if (approved) {
    return { document: approved, source: "approved_sales_plan" };
  }
  if (hasMonthOrders(envelope.working, monthKey)) {
    return { document: envelope.working as SalesPlanDocument, source: "working_sales_plan" };
  }
  return null;
}

/**
 * Считает плановую выручку и заказы по артикулам выбранного месяца.
 * Не мутирует исходный документ. Артикулы агрегируются по row.variant (верхний регистр).
 */
export function deriveWbPlanForMonth(value: unknown, monthKey: string): WbPlanSelection {
  const selected = selectWbPlanDocument(value, monthKey);
  if (!selected) {
    return { source: "none", articles: [], planRevenue: 0, planOrders: 0 };
  }

  const byArticle = new Map<string, WbPlanArticle>();
  for (const row of planRows(selected.document)) {
    const article = String(row.variant ?? "").trim().toUpperCase();
    if (!article) continue;
    const month = calculateSalesPlanRowMonth(row, monthKey);
    if (month.orders <= 0 && month.revenue <= 0) continue;
    const existing = byArticle.get(article);
    if (existing) {
      existing.planRevenue += month.revenue;
      existing.planOrders += month.orders;
      existing.planBuyouts += month.buyouts;
    } else {
      byArticle.set(article, {
        article,
        planRevenue: month.revenue,
        planOrders: month.orders,
        planBuyouts: month.buyouts,
        externalId: String(row.externalId ?? ""),
        model: String(row.model ?? ""),
        price: numberOrZero(row.price),
        buyout: numberOrZero(row.buyout),
      });
    }
  }

  const articles = [...byArticle.values()];
  return {
    source: selected.source,
    articles,
    planRevenue: articles.reduce((sum, item) => sum + item.planRevenue, 0),
    planOrders: articles.reduce((sum, item) => sum + item.planOrders, 0),
  };
}

/**
 * Месяцы запрошенного года, для которых в рабочем/утверждённом плане есть заказы.
 * Используется, чтобы подсказать пользователю, где план реально заполнен,
 * когда выбранный месяц пуст.
 */
export function listWbPlanMonths(
  value: unknown,
  year: number,
): Array<{ year: number; month: number }> {
  const envelope = asEnvelope(value);
  if (!envelope) return [];
  const candidates = [
    envelope.working,
    envelope.approved,
    ...Object.values(envelope.approvedByMonth ?? {}),
  ];
  const months = new Set<number>();
  for (let month = 1; month <= 12; month += 1) {
    const monthKey = String(month).padStart(2, "0");
    if (candidates.some((document) => hasMonthOrders(document, monthKey))) {
      months.add(month);
    }
  }
  return [...months].sort((a, b) => a - b).map((month) => ({ year, month }));
}
