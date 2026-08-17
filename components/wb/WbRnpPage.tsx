"use client";

import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Download,
  Loader2,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ActionableError } from "@/components/ui/ActionableError";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { MARKETPLACE_METRICS } from "@/lib/analytics/marketplaceMetrics";
import { heat } from "@/lib/analytics/heat";
import { deploymentPinnedFetch } from "@/lib/http/deploymentPinnedFetch";
import { readApiResponse, readOkApiResponse } from "@/lib/http/readApiResponse";
import { buildRnpArticleCompare } from "@/lib/rnp/articleCompare";
import { buildRnpFocusSummary, type RnpFocusSignal } from "@/lib/rnp/focusSummary";
import {
  filterRnpProductFacets,
  rnpBrandOptions,
  rnpCategoryOptions,
  sortRnpProducts,
} from "@/lib/rnp/productFacets";
import {
  RNP_METRIC_FIELDS,
  RNP_VIEW_PRESETS,
  anomalyDirection,
  detectSkuSignals,
  formatAnomalyBadge,
  scaleAnomalyThresholds,
  dayOverDayBaseline,
  detectSkuAnomalies,
  filterAnomalies,
  isOpenMoscowDayLabel,
  matchesArticleList,
  metricDelta,
  previousEqualRange,
  sanitizeMetricFields,
  type RnpAnomaly,
  type RnpAnomalyDirection,
  type RnpDeltaMode,
  type RnpMetricField,
  type RnpViewId,
} from "@/lib/rnp/operatingMatrix";
import { RNP_DEFAULT_TURNOVER_WINDOW_DAYS } from "@/lib/rnp/warmupPlan";
import { appendTaxMetrics, RNP_DEFAULT_TAX_PCT } from "@/lib/rnp/taxMetrics";
import { useCategoryMap } from "@/lib/useCategoryMap";
import {
  RnpOperatingToolbar,
  type RnpTagOption,
} from "./RnpOperatingToolbar";
import {
  RnpProductOperationsDrawer,
  type RnpJournalEntry,
} from "./RnpProductOperationsDrawer";
import { WbProductImage } from "./WbProductImage";
import { useWbCabinet } from "./WbCabinetContext";

interface Metric {
  field: string;
  label: string;
  kind: string;
  daily: (number | null)[];
  total: number | null;
  forecast: number | null;
  forecastLow?: number | null;
  forecastHigh?: number | null;
  forecastConfidencePct?: number | null;
  forecastMethod?: string | null;
  coveragePct?: number;
  status?: "ready" | "partial" | "unavailable";
  source?: string;
  note?: string;
  qualityReason?: "no_activity" | "missing_cost" | "missing_rates" | "stale_source" | "api_error" | "unsupported_source";
  group_start?: boolean;
}

interface Sku {
  nm: number;
  art: string;
  name: string;
  brand?: string;
  subject?: string;
  img_url: string;
  metrics: Metric[];
}

interface RnpTable {
  shop_label: string;
  sku_count: number;
  generated_at: string;
  as_of: string;
  scope_freshness?: Array<{
    cabinet_id: string | null;
    label: string;
    as_of: string;
    orders_as_of: string | null;
    sales_as_of: string | null;
    adverts_as_of?: string | null;
    funnel_as_of?: string | null;
  }>;
  forecast_note: string;
  period: { label: string; period_type: string }[];
  summary: Metric[];
  skus: Sku[];
  error?: string;
}

interface DateRange {
  from: string;
  to: string;
  preset: "today" | "yesterday" | "week" | "two_weeks" | "month" | "quarter" | "previous" | "custom";
}

interface RnpFilterPreset {
  id: string;
  label: string;
  description?: string;
  system?: boolean;
  cabinetId?: string;
  category?: string;
  categoryKeywords?: string[];
  rangePreset?: DateRange["preset"];
  from?: string;
  to?: string;
  sortField?: string;
  sortDirection?: 1 | -1;
  compareMetric?: (typeof COMPARE_METRICS)[number]["field"];
}

interface RnpTagAssignment {
  nm_id: number;
  tag_id: string;
}

interface RnpOperationsPayload {
  available?: boolean;
  tags?: RnpTagOption[];
  assignments?: RnpTagAssignment[];
  journal?: RnpJournalEntry[];
  message?: string;
  error?: string;
}

interface RnpMatrixPreferences {
  metricFields: RnpMetricField[];
  showDeltas: boolean;
  deltaMode: RnpDeltaMode;
  heatmapEnabled: boolean;
  sparklinesEnabled: boolean;
  compactNumbers: boolean;
  anomalyThreshold: number;
  turnoverWindowDays: number;
  taxPct: number;
}

const METRIC_ORDER = [...RNP_METRIC_FIELDS];

const METRIC_FALLBACKS: Record<string, { label: string; kind: string }> = {
  views: { label: "Рекламные показы", kind: "int" },
  clicks: { label: "Рекламные клики", kind: "int" },
  ctr: { label: `Рекламный ${MARKETPLACE_METRICS.ctr.label}, %`, kind: "pct" },
  open_card: { label: "Переходы в карточку", kind: "int" },
  cart: { label: "Корзины", kind: "int" },
  cart_cr: { label: "Конв. в корзину, %", kind: "pct" },
  order_cr: { label: "Конв. в заказ, %", kind: "pct" },
  orders_sum: { label: "Заказы, ₽", kind: "money" },
  orders_count: { label: "Заказы, шт", kind: "int" },
  orders_fbs_count: { label: "Заказы FBS, шт", kind: "int" },
  orders_fbs_sum: { label: "Заказы FBS, ₽", kind: "money" },
  orders_fbw_count: { label: "Заказы FBW, шт", kind: "int" },
  orders_fbw_sum: { label: "Заказы FBW, ₽", kind: "money" },
  fbs_share_pct: { label: "Доля FBS в заказах, %", kind: "pct" },
  cancels_count: { label: "Отмены, шт", kind: "int" },
  cancel_pct: { label: "Доля отмен, %", kind: "pct" },
  buyouts_sum: { label: "Продажи, ₽", kind: "money" },
  buyouts_count: { label: "Продажи, шт", kind: "int" },
  returns_count: { label: "Возвраты, шт", kind: "int" },
  returns_sum: { label: "Возвраты, ₽", kind: "money" },
  return_pct: { label: "Доля возвратов, %", kind: "pct" },
  buyout_pct: { label: "Выкуп потока, %", kind: "pct" },
  actual_buyout_pct: { label: "Фактический % выкупа, %", kind: "pct" },
  buyouts_gross_count: { label: "Выкуплено, шт", kind: "int" },
  buyouts_gross_rub: { label: "Выкуплено, ₽", kind: "money" },
  orders_spp_sum: { label: "Заказы с СПП, ₽", kind: "money" },
  avg_order_price: { label: "Средняя цена заказа, ₽", kind: "money" },
  seller_discount_pct: { label: "Скидка продавца, %", kind: "pct" },
  avg_buyout_price: { label: "Средняя цена выкупа, ₽", kind: "money" },
  final_price: { label: "Цена для покупателя, ₽", kind: "money" },
  spp_pct: { label: "СПП, %", kind: "pct" },
  gross: { label: "Прибыль после расходов МП, ₽", kind: "money" },
  agent_commission_rub: { label: "Комиссия кабинета, ₽", kind: "money" },
  tax_rub: { label: "Налог, ₽", kind: "money" },
  net_profit: { label: "Чистая прибыль, ₽", kind: "money" },
  net_margin_pct: { label: "Чистая маржа, %", kind: "pct" },
  cogs: { label: "Себестоимость проданного, ₽", kind: "money" },
  commission_rub: { label: "Комиссия WB, ₽", kind: "money" },
  acquiring_rub: { label: "Эквайринг, ₽", kind: "money" },
  logistics_rub: { label: "Логистика и прочие удержания, ₽", kind: "money" },
  delivery_rub: { label: "Логистика, ₽", kind: "money" },
  storage_rub: { label: "Хранение, ₽", kind: "money" },
  penalty_rub: { label: "Штрафы, ₽", kind: "money" },
  acceptance_rub: { label: "Приёмка, ₽", kind: "money" },
  deduction_rub: { label: "Прочие удержания, ₽", kind: "money" },
  mp_cost_rub: { label: "Расходы МП всего, ₽", kind: "money" },
  profit_per_unit: { label: "Прибыль на единицу, ₽", kind: "money" },
  romi: { label: "ROMI, %", kind: "pct" },
  margin_pct: { label: `${MARKETPLACE_METRICS.marginAfterMarketplace.label}, %`, kind: "pct" },
  ad_spent: { label: "Рекл. расход, ₽", kind: "money" },
  drr: { label: `${MARKETPLACE_METRICS.drrOrders.label}, %`, kind: "pct" },
  stock: { label: "Остаток, шт", kind: "int" },
  stock_in_way_to_client: { label: "В пути к клиенту, шт", kind: "int" },
  stock_in_way_from_client: { label: "В пути от клиента, шт", kind: "int" },
  stock_total: { label: "Всего на складах, шт", kind: "int" },
  turnover: { label: "Оборачиваемость, дней", kind: "int" },
  money: { label: "Деньги в остатках, ₽", kind: "money" },
  gmroi: { label: "GMROI, %", kind: "pct" },
};

const METRIC_ROW_HEIGHT = 34;
const DELTA_METRIC_ROW_HEIGHT = 42;
const MOBILE_PAGE_SIZE = 20;
const MONTHLY_FLOW_FIELDS = new Set([
  "views",
  "clicks",
  "open_card",
  "cart",
  "orders_sum",
  "orders_count",
  "orders_fbs_count",
  "orders_fbs_sum",
  "orders_fbw_count",
  "orders_fbw_sum",
  "cancels_count",
  "buyouts_sum",
  "buyouts_count",
  "buyouts_gross_count",
  "buyouts_gross_rub",
  "orders_spp_sum",
  "returns_count",
  "returns_sum",
  "gross",
  "cogs",
  "commission_rub",
  "acquiring_rub",
  "logistics_rub",
  "delivery_rub",
  "storage_rub",
  "penalty_rub",
  "acceptance_rub",
  "deduction_rub",
  "mp_cost_rub",
  "tax_rub",
  "net_profit",
  "ad_spent",
]);

const SORTS = [
  { field: "stock", label: "Остаток" },
  { field: "orders_sum", label: "Заказы" },
  { field: "turnover", label: "Оборач" },
  { field: "gmroi", label: "GMROI" },
  { field: "drr", label: "ДРР" },
  { field: "money", label: "Деньги в остатках" },
] as const;

const COMPARE_METRICS = [
  { field: "orders_sum", label: "Заказы ₽" },
  { field: "orders_count", label: "Заказы шт" },
  { field: "open_card", label: "Переходы" },
  { field: "cart_conversion", label: "CR в корзину" },
  { field: "ad_spent", label: "Реклама" },
  { field: "drr", label: "ДРР" },
  { field: "stock", label: "Остаток" },
] as const;

const COMPARE_COLORS = ["#7c3aed", "#ec4899", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#6366f1", "#14b8a6", "#f97316", "#84cc16", "#06b6d4", "#a855f7"];
const DEFAULT_COMPARE_SELECTED_LIMIT = 12;

const PRESETS = [
  { value: "week", label: "Неделя" },
  { value: "two_weeks", label: "2 недели" },
  { value: "month", label: "Месяц" },
  { value: "quarter", label: "Квартал" },
] as const;

const OPTIMA_TABLE_GROUPS: ReadonlyArray<{ id: string; label: string; fields: readonly RnpMetricField[]; expanded: boolean }> = [
  { id: "main", label: "Основное", fields: ["orders_count", "buyout_pct", "buyouts_count", "ad_spent", "drr"], expanded: true },
  { id: "sales", label: "Продажи и возвраты", fields: ["orders_sum", "orders_spp_sum", "orders_fbs_count", "orders_fbs_sum", "orders_fbw_count", "orders_fbw_sum", "fbs_share_pct", "cancels_count", "cancel_pct", "buyouts_gross_count", "buyouts_gross_rub", "buyouts_sum", "returns_count", "returns_sum", "return_pct", "actual_buyout_pct"], expanded: false },
  { id: "price", label: "Цены", fields: ["avg_order_price", "seller_discount_pct", "avg_buyout_price", "final_price", "spp_pct"], expanded: false },
  { id: "funnel", label: "Воронка", fields: ["views", "clicks", "ctr", "open_card", "cart", "cart_cr", "order_cr"], expanded: false },
  { id: "economy", label: "Экономика", fields: ["cogs", "commission_rub", "acquiring_rub", "logistics_rub", "delivery_rub", "storage_rub", "penalty_rub", "acceptance_rub", "deduction_rub", "mp_cost_rub", "gross", "margin_pct", "agent_commission_rub", "tax_rub", "net_profit", "net_margin_pct", "profit_per_unit", "romi", "gmroi"], expanded: false },
  { id: "stock", label: "Остатки", fields: ["stock", "stock_in_way_to_client", "stock_in_way_from_client", "stock_total", "turnover", "money"], expanded: false },
];

const RNP_FILTER_PRESETS_STORAGE_KEY = "finance-panel:wb-rnp-filter-presets:v1";
const RNP_MATRIX_STORAGE_KEY = "finance-panel:wb-rnp-operating-matrix:v2";
const MAX_USER_FILTER_PRESETS = 8;
const SHOW_RNP_ASSISTANT_BLOCKS = false;

const SYSTEM_FILTER_PRESETS: RnpFilterPreset[] = [
  {
    id: "system-stock-risk",
    label: "Дефицит / остатки",
    description: "SKU с минимальной оборачиваемостью наверху",
    system: true,
    rangePreset: "month",
    sortField: "turnover",
    sortDirection: 1,
    compareMetric: "stock",
  },
  {
    id: "system-high-drr",
    label: "Высокий ДРР",
    description: "Быстро найти SKU, где реклама давит маржу",
    system: true,
    rangePreset: "week",
    sortField: "drr",
    sortDirection: -1,
    compareMetric: "drr",
  },
  {
    id: "system-stock-money",
    label: "Деньги в остатках",
    description: "Самые дорогие складские остатки сверху",
    system: true,
    rangePreset: "month",
    sortField: "money",
    sortDirection: -1,
    compareMetric: "stock",
  },
  {
    id: "system-jackets",
    label: "Ветровки / куртки",
    description: "Категория верхней одежды, если заведена в себестоимости",
    system: true,
    rangePreset: "month",
    categoryKeywords: ["ветров", "куртк"],
    sortField: "orders_sum",
    sortDirection: -1,
    compareMetric: "orders_sum",
  },
  {
    id: "system-bags",
    label: "Сумки",
    description: "Категория сумок, если заведена в себестоимости",
    system: true,
    rangePreset: "month",
    categoryKeywords: ["сумк"],
    sortField: "orders_sum",
    sortDirection: -1,
    compareMetric: "orders_sum",
  },
];

function toIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rangeFor(preset: DateRange["preset"]): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);

  if (preset === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (preset === "week") {
    start.setDate(start.getDate() - 6);
  } else if (preset === "two_weeks") {
    start.setDate(start.getDate() - 13);
  } else if (preset === "month") {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 0);
  } else if (preset === "quarter") {
    start.setDate(start.getDate() - 89);
  } else if (preset === "previous") {
    start.setMonth(start.getMonth() - 1, 1);
    end.setDate(0);
  }

  return { from: toIso(start), to: toIso(end), preset };
}

function isCompareMetric(value: unknown): value is (typeof COMPARE_METRICS)[number]["field"] {
  return typeof value === "string" && COMPARE_METRICS.some((metric) => metric.field === value);
}

function normalizeUserPreset(raw: unknown): RnpFilterPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const label = typeof value.label === "string" ? value.label.trim() : "";
  if (!label) return null;
  const sortDirection = value.sortDirection === 1 ? 1 : -1;
  return {
    id: typeof value.id === "string" && value.id ? value.id : `user-${Date.now()}`,
    label: label.slice(0, 40),
    cabinetId: typeof value.cabinetId === "string" ? value.cabinetId : undefined,
    category: typeof value.category === "string" ? value.category : "",
    rangePreset: ["today", "yesterday", "week", "two_weeks", "month", "quarter", "previous", "custom"].includes(String(value.rangePreset))
      ? value.rangePreset as DateRange["preset"]
      : "custom",
    from: typeof value.from === "string" ? value.from : undefined,
    to: typeof value.to === "string" ? value.to : undefined,
    sortField: typeof value.sortField === "string" ? value.sortField : "orders_sum",
    sortDirection,
    compareMetric: isCompareMetric(value.compareMetric) ? value.compareMetric : "orders_sum",
  };
}

function readUserFilterPresets(): RnpFilterPreset[] {
  try {
    const raw = window.localStorage.getItem(RNP_FILTER_PRESETS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.map(normalizeUserPreset).filter((preset): preset is RnpFilterPreset => Boolean(preset)).slice(0, MAX_USER_FILTER_PRESETS)
      : [];
  } catch {
    return [];
  }
}

function writeUserFilterPresets(presets: RnpFilterPreset[]) {
  try {
    window.localStorage.setItem(RNP_FILTER_PRESETS_STORAGE_KEY, JSON.stringify(presets.slice(0, MAX_USER_FILTER_PRESETS)));
  } catch {
    // Корпоративный браузер может запретить localStorage — пресеты просто останутся в текущей сессии.
  }
}

function readMatrixPreferences(): RnpMatrixPreferences {
  const fallback: RnpMatrixPreferences = {
    metricFields: [...RNP_VIEW_PRESETS[0].fields],
    showDeltas: true,
    deltaMode: "percent",
    heatmapEnabled: true,
    sparklinesEnabled: true,
    compactNumbers: false,
    anomalyThreshold: 30,
    turnoverWindowDays: RNP_DEFAULT_TURNOVER_WINDOW_DAYS,
    taxPct: RNP_DEFAULT_TAX_PCT,
  };
  try {
    const raw = window.localStorage.getItem(RNP_MATRIX_STORAGE_KEY);
    if (!raw) return fallback;
    const value = JSON.parse(raw) as Partial<RnpMatrixPreferences>;
    return {
      metricFields: sanitizeMetricFields(value.metricFields, fallback.metricFields),
      showDeltas: value.showDeltas !== false,
      deltaMode: value.deltaMode === "absolute" ? "absolute" : "percent",
      heatmapEnabled: value.heatmapEnabled !== false,
      sparklinesEnabled: value.sparklinesEnabled !== false,
      compactNumbers: value.compactNumbers === true,
      anomalyThreshold: Math.max(10, Math.min(100, Number(value.anomalyThreshold) || 30)),
      turnoverWindowDays: [7, 14, 30, 60, 90].includes(Number(value.turnoverWindowDays)) ? Number(value.turnoverWindowDays) : RNP_DEFAULT_TURNOVER_WINDOW_DAYS,
      taxPct: Number.isFinite(Number(value.taxPct)) && Number(value.taxPct) >= 0 && Number(value.taxPct) <= 50
        ? Number(value.taxPct)
        : RNP_DEFAULT_TAX_PCT,
    };
  } catch {
    return fallback;
  }
}

function writeMatrixPreferences(value: RnpMatrixPreferences) {
  try {
    window.localStorage.setItem(RNP_MATRIX_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // В закрытом браузере настройки останутся в текущей сессии.
  }
}

function matchingPresetCategory(preset: RnpFilterPreset, categories: string[]) {
  if (preset.category) return preset.category === "__none" || categories.includes(preset.category) ? preset.category : "";
  const keywords = preset.categoryKeywords ?? [];
  if (!keywords.length) return "";
  const loweredKeywords = keywords.map((keyword) => keyword.toLocaleLowerCase("ru-RU"));
  return categories.find((category) => {
    const lowered = category.toLocaleLowerCase("ru-RU");
    return loweredKeywords.some((keyword) => lowered.includes(keyword));
  }) ?? "";
}

function fmt(value: number | null | undefined, kind: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (kind === "pct") return `${Math.round(value * 10) / 10}%`;
  if (kind === "money") return `${Math.round(value).toLocaleString("ru-RU")} ₽`;
  return Math.round(value).toLocaleString("ru-RU");
}

function compactFmt(value: number | null | undefined, kind: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (kind === "pct") return `${Math.round(value * 10) / 10}%`;
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(Math.round(value));
}

function denseFmt(value: number | null | undefined, kind: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (kind === "pct") return fmt(value, kind);
  if (kind === "money" && Math.abs(value) >= 100_000) return `${compactFmt(value, kind)} ₽`;
  if (kind !== "money" && Math.abs(value) >= 1_000_000) return compactFmt(value, kind);
  return fmt(value, kind);
}

function matrixFmt(value: number | null | undefined, kind: string, compactNumbers: boolean) {
  return compactNumbers ? denseFmt(value, kind) : fmt(value, kind);
}

function formatChartValue(value: number | null | undefined, kind: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (kind === "money") return `${compactFmt(value, kind)} ₽`;
  return compactFmt(value, kind);
}

function findMetric(metrics: Metric[], field: string) {
  return metrics.find((metric) => metric.field === field);
}

// Метрики, которым для расчёта нужна себестоимость: без неё строка остаётся
// пустой с внятной причиной, а не выглядит как «активности не было».
const ECONOMY_FALLBACK_FIELDS = new Set([
  "gross", "margin_pct", "money", "gmroi",
  "cogs", "commission_rub", "acquiring_rub", "logistics_rub", "mp_cost_rub", "profit_per_unit", "romi",
  "delivery_rub", "storage_rub", "penalty_rub", "acceptance_rub", "deduction_rub",
  "tax_rub", "net_profit", "net_margin_pct",
]);

function completeMetrics(metrics: Metric[], periodLength: number, fields: readonly string[] = METRIC_ORDER) {
  return fields.map((field) => {
    const existing = findMetric(metrics, field);
    if (existing) return existing;
    const fallback = METRIC_FALLBACKS[field];
    return {
      field,
      label: fallback.label,
      kind: fallback.kind,
      daily: Array.from({ length: periodLength }, () => null),
      total: Number.NaN,
      forecast: null,
      status: "unavailable",
      coveragePct: 0,
      qualityReason: ECONOMY_FALLBACK_FIELDS.has(field) ? "missing_cost" : "no_activity",
    } satisfies Metric;
  });
}

function sumPlan(plan: Record<string, Record<string, number>>, skus: Sku[], field: string) {
  const values = skus
    .map((sku) => plan[String(sku.nm)]?.[field])
    .filter((value): value is number => value != null && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function averagePlan(plan: Record<string, Record<string, number>>, skus: Sku[], field: string) {
  const values = skus
    .map((sku) => plan[String(sku.nm)]?.[field])
    .filter((value): value is number => value != null && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function aggregatePlanValue(plan: Record<string, Record<string, number>>, skus: Sku[], field: string, monthDays: number) {
  const ratio = (numeratorField: string, denominatorField: string, multiplier = 100) => {
    const numerator = sumPlan(plan, skus, numeratorField);
    const denominator = sumPlan(plan, skus, denominatorField);
    return numerator != null && denominator != null && denominator !== 0 ? numerator / denominator * multiplier : null;
  };
  if (field === "ctr") return ratio("clicks", "views") ?? averagePlan(plan, skus, field);
  if (field === "buyout_pct") return ratio("buyouts_count", "orders_count") ?? averagePlan(plan, skus, field);
  if (field === "drr") return ratio("ad_spent", "orders_sum") ?? averagePlan(plan, skus, field);
  if (field === "margin_pct") return ratio("gross", "buyouts_sum") ?? averagePlan(plan, skus, field);
  if (field === "turnover") {
    const stock = sumPlan(plan, skus, "stock");
    const buyouts = sumPlan(plan, skus, "buyouts_count");
    return stock != null && buyouts != null && buyouts > 0 ? stock / (buyouts / monthDays) : averagePlan(plan, skus, field);
  }
  if (field === "gmroi") return ratio("gross", "money") ?? averagePlan(plan, skus, field);
  return sumPlan(plan, skus, field);
}

function daysInMonth(month: string) {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(year, monthIndex, 0).getDate();
}

function cellBackground(metric: Metric, value: number | null) {
  if (value == null) return undefined;
  if (metric.field === "margin_pct") return heat("margin", value) || undefined;
  if (metric.field === "drr") return heat("drr", value) || undefined;
  if (metric.field === "turnover" && value >= 120) return "#fee2e2";
  if (metric.field === "turnover" && value <= 45) return "#dcfce7";
  if (metric.field === "gmroi" && value >= 100) return "#dcfce7";
  return undefined;
}

function toneClass(metric: Metric, value: number | null) {
  if (value == null) return "text-slate-400";
  if (metric.field === "margin_pct") return value < 0 ? "text-rose-700" : "text-emerald-800";
  if (metric.field === "drr") return value >= 30 ? "text-rose-700" : "text-slate-700";
  return "text-slate-700";
}

export function WbRnpPage() {
  const { cabinets, cabinetId, activeCabinet, ready, loading: cabinetsLoading, error: cabinetsError, hasExactCabinet, canWrite, setCabinetId } = useWbCabinet();
  const [range, setRange] = useState<DateRange>(() => rangeFor("week"));
  const [data, setData] = useState<RnpTable | null>(null);
  const [previousData, setPreviousData] = useState<RnpTable | null>(null);
  const [dataKey, setDataKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [sortField, setSortField] = useState("orders_sum");
  const [sortDirection, setSortDirection] = useState<1 | -1>(-1);
  const [compareMetric, setCompareMetric] = useState<(typeof COMPARE_METRICS)[number]["field"]>("orders_sum");
  const [compareQuery, setCompareQuery] = useState("");
  const [selectedCompareNms, setSelectedCompareNms] = useState<number[]>([]);
  const [focusedNm, setFocusedNm] = useState<number | null>(null);
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<Record<string, Record<string, number>>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [planMessage, setPlanMessage] = useState<string | null>(null);
  const [skuWindow, setSkuWindow] = useState({ start: 0, end: 4 });
  const [mobileLimit, setMobileLimit] = useState(MOBILE_PAGE_SIZE);
  const [userFilterPresets, setUserFilterPresets] = useState<RnpFilterPreset[]>([]);
  const [matrixReady, setMatrixReady] = useState(false);
  const [metricViewId, setMetricViewId] = useState<RnpViewId>("main");
  const [metricFields, setMetricFields] = useState<RnpMetricField[]>([...RNP_VIEW_PRESETS[0].fields]);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [articleQuery, setArticleQuery] = useState("");
  const [showDeltas, setShowDeltas] = useState(true);
  const [deltaMode, setDeltaMode] = useState<RnpDeltaMode>("percent");
  const [heatmapEnabled, setHeatmapEnabled] = useState(true);
  const [sparklinesEnabled, setSparklinesEnabled] = useState(true);
  const [compactNumbers, setCompactNumbers] = useState(false);
  const [anomalyMode, setAnomalyMode] = useState<"off" | RnpAnomalyDirection>("off");
  const [anomalyThreshold, setAnomalyThreshold] = useState(30);
  const [turnoverWindowDays, setTurnoverWindowDays] = useState(RNP_DEFAULT_TURNOVER_WINDOW_DAYS);
  const [taxPct, setTaxPct] = useState(RNP_DEFAULT_TAX_PCT);
  // Ставки кабинета (налог, комиссия посредника) — задаются на экране юнитки и
  // хранятся по кабинету. Настройка перебивает сохранённый в браузере дефолт,
  // ручной ввод на экране перебивает настройку.
  const [cabinetExtraPct, setCabinetExtraPct] = useState(0);
  const [operationsAvailable, setOperationsAvailable] = useState(false);
  const [operationsMessage, setOperationsMessage] = useState<string | null>(null);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [operationsBusy, setOperationsBusy] = useState(false);
  const [tags, setTags] = useState<RnpTagOption[]>([]);
  const [tagAssignments, setTagAssignments] = useState<RnpTagAssignment[]>([]);
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const [selectedOperationNms, setSelectedOperationNms] = useState<number[]>([]);
  const [operationsSkuNm, setOperationsSkuNm] = useState<number | null>(null);
  const [operationsInitialDate, setOperationsInitialDate] = useState<string | undefined>();
  const [journal, setJournal] = useState<RnpJournalEntry[]>([]);
  const tableViewportRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const dataKeyRef = useRef<string | null>(null);
  const elapsed = useElapsedSeconds(loading);
  const { byArticle } = useCategoryMap();
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const month = range.from.slice(0, 7);
  const currentDataKey = `${cabinetId || "all"}:${range.from}:${range.to}:${turnoverWindowDays}`;
  // Ставка налога применяется поверх готового снимка, а не на сервере: снимок
  // кэшируется на 12 часов по периоду, и ставка в ключе размножила бы кэш.
  // Копируем массивы метрик — исходный ответ остаётся без налоговых строк,
  // поэтому смена ставки всегда пересчитывается от чистого источника.
  const withTax = useCallback((source: RnpTable | null) => {
    if (!source) return null;
    return {
      ...source,
      summary: appendTaxMetrics([...source.summary], taxPct, { extraCommissionPct: cabinetExtraPct }),
      skus: source.skus.map((sku) => ({ ...sku, metrics: appendTaxMetrics([...sku.metrics], taxPct, { extraCommissionPct: cabinetExtraPct }) })),
    };
  }, [cabinetExtraPct, taxPct]);
  const activeData = useMemo(
    () => withTax(dataKey === currentDataKey ? data : null),
    [currentDataKey, data, dataKey, withTax],
  );

  useEffect(() => {
    if (!cabinetId) {
      setCabinetExtraPct(0);
      return;
    }
    let cancelled = false;
    fetch(`/api/cabinet-settings/unit?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { settings?: Array<{ cabinetId: string; taxPct: number | null; extraCommissionPct: number | null }> }) => {
        if (cancelled) return;
        const found = (body.settings ?? []).find((item) => item.cabinetId === cabinetId);
        if (found?.taxPct != null) setTaxPct(found.taxPct);
        setCabinetExtraPct(found?.extraCommissionPct ?? 0);
      })
      .catch(() => { if (!cancelled) setCabinetExtraPct(0); });
    return () => { cancelled = true; };
  }, [cabinetId]);

  useEffect(() => {
    setUserFilterPresets(readUserFilterPresets());
    const preferences = readMatrixPreferences();
    setMetricFields(preferences.metricFields);
    setShowDeltas(preferences.showDeltas);
    setDeltaMode(preferences.deltaMode);
    setHeatmapEnabled(preferences.heatmapEnabled);
    setSparklinesEnabled(preferences.sparklinesEnabled);
    setCompactNumbers(preferences.compactNumbers);
    setAnomalyThreshold(preferences.anomalyThreshold);
    setTurnoverWindowDays(preferences.turnoverWindowDays);
    setTaxPct(preferences.taxPct);
    const preset = RNP_VIEW_PRESETS.find((view) =>
      view.fields.length === preferences.metricFields.length
      && view.fields.every((field, index) => field === preferences.metricFields[index]));
    setMetricViewId(preset?.id ?? "custom");
    setMatrixReady(true);
  }, []);

  useEffect(() => {
    if (!matrixReady) return;
    writeMatrixPreferences({
      metricFields,
      showDeltas,
      deltaMode,
      heatmapEnabled,
      sparklinesEnabled,
      compactNumbers,
      anomalyThreshold,
      turnoverWindowDays,
      taxPct,
    });
  }, [anomalyThreshold, compactNumbers, deltaMode, heatmapEnabled, matrixReady, metricFields, showDeltas, sparklinesEnabled, taxPct, turnoverWindowDays]);

  useEffect(() => {
    setPlanning(false);
    setPlan({});
    setDrafts({});
    setPlanMessage(null);
    setPreviousData(null);
    setTags([]);
    setTagAssignments([]);
    setActiveTagIds([]);
    setSelectedOperationNms([]);
    setOperationsSkuNm(null);
    setOperationsInitialDate(undefined);
    setJournal([]);
    setOperationsMessage(null);
    setBrand("");
    setCategory("");
  }, [cabinetId]);

  useEffect(() => {
    if (!ready || cabinetsLoading) return;
    if (cabinets.length === 0) {
      setLoading(false);
      setData(null);
      dataKeyRef.current = null;
      setDataKey(null);
      setError(cabinetsError || "Подключите хотя бы один активный WB-кабинет в настройках");
      return;
    }
    if (!activeCabinet && cabinetId !== "all") {
      setLoading(false);
      setData(null);
      dataKeyRef.current = null;
      setDataKey(null);
      setError(cabinetsError || "Нет доступного WB-кабинета");
      return;
    }

    const requestKey = `${cabinetId || "all"}:${range.from}:${range.to}:${turnoverWindowDays}`;
    if (dataKeyRef.current !== requestKey) {
      dataKeyRef.current = null;
      setDataKey(null);
      setData(null);
      setPreviousData(null);
    }
    const controller = new AbortController();
    const previousController = new AbortController();
    const currentRequest = ++requestId.current;
    let timedOut = false;
    let previousDeadline: number | null = null;
    const deadline = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 65_000);

    setLoading(true);
    setError(null);

    const loadTable = async (from: string, to: string, label: string, signal: AbortSignal) => {
      const params = new URLSearchParams({
        date_from: from,
        date_to: to,
        turnover_days: String(turnoverWindowDays),
      });
      const response = await deploymentPinnedFetch(`/api/rnp/${encodeURIComponent(cabinetId || "all")}/table?${params.toString()}`, {
        cache: "no-store",
        signal,
      });
      return label === "РНП"
        ? readOkApiResponse<RnpTable>(response, "РНП")
        : readOkApiResponse<RnpTable>(response, label);
    };
    const previousRange = previousEqualRange(range.from, range.to);

    loadTable(range.from, range.to, "РНП", controller.signal)
      .then((body) => {
        if (currentRequest !== requestId.current) return;
        if (body.error) throw new Error(body.error);
        setData(body);
        dataKeyRef.current = requestKey;
        setDataKey(requestKey);
        // Сравнение не конкурирует с основным экраном за тяжёлые запросы Retail
        // Family. Сначала пользователь получает текущий период, затем в фоне
        // догружается предыдущий период для дельт.
        previousDeadline = window.setTimeout(() => previousController.abort(), 45_000);
        void loadTable(previousRange.from, previousRange.to, "РНП за предыдущий период", previousController.signal)
          .then((previous) => {
            if (currentRequest === requestId.current) setPreviousData(previous.error ? null : previous);
          })
          .catch(() => {
            if (currentRequest === requestId.current) setPreviousData(null);
          })
          .finally(() => {
            if (previousDeadline !== null) window.clearTimeout(previousDeadline);
          });
      })
      .catch((cause: unknown) => {
        if (currentRequest !== requestId.current || (controller.signal.aborted && !timedOut)) return;
        setError(
          timedOut
            ? "Расчёт РНП не завершился за 65 секунд. Повторите запрос или проверьте синхронизацию WB."
            : cause instanceof Error
              ? cause.message
              : "Не удалось загрузить РНП",
        );
      })
      .finally(() => {
        window.clearTimeout(deadline);
        if (currentRequest === requestId.current) setLoading(false);
      });

    return () => {
      window.clearTimeout(deadline);
      if (previousDeadline !== null) window.clearTimeout(previousDeadline);
      controller.abort();
      previousController.abort();
    };
  }, [activeCabinet, cabinetId, cabinets.length, cabinetsError, cabinetsLoading, range.from, range.to, ready, retryKey, turnoverWindowDays]);

  useEffect(() => {
    if (!hasExactCabinet) {
      setPlan({});
      return;
    }
    const controller = new AbortController();
    setPlanMessage(null);
    fetch(`/api/rnp/${encodeURIComponent(cabinetId)}/plan?month=${encodeURIComponent(month)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await readApiResponse<{ plan?: Record<string, Record<string, number>>; error?: string }>(response, "План РНП");
        if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        setPlan(body.plan ?? {});
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setPlanMessage(cause instanceof Error ? cause.message : "Не удалось загрузить план");
      });
    return () => controller.abort();
  }, [cabinetId, hasExactCabinet, month]);

  useEffect(() => {
    if (!hasExactCabinet || cabinetId === "all") {
      setOperationsAvailable(false);
      setTags([]);
      setTagAssignments([]);
      setJournal([]);
      return;
    }
    const controller = new AbortController();
    setOperationsLoading(true);
    deploymentPinnedFetch(`/api/rnp/${encodeURIComponent(cabinetId)}/operations`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => readApiResponse<RnpOperationsPayload>(response, "Теги и журнал РНП").then((body) => ({ response, body })))
      .then(({ response, body }) => {
        if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        setOperationsAvailable(body.available === true);
        setOperationsMessage(body.message ?? null);
        setTags(body.tags ?? []);
        setTagAssignments(body.assignments ?? []);
        setJournal(body.journal ?? []);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          const message = cause instanceof Error ? cause.message : "Не удалось загрузить теги и журнал";
          setOperationsAvailable(false);
          setOperationsMessage(message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setOperationsLoading(false);
      });
    return () => controller.abort();
  }, [cabinetId, hasExactCabinet]);

  const previousSkuByNm = useMemo(
    // Прошлый период тоже считаем по текущей ставке — иначе дельта по чистой
    // прибыли сравнивала бы налог с его отсутствием.
    () => new Map((withTax(previousData)?.skus ?? []).map((sku) => [sku.nm, sku])),
    [previousData, withTax],
  );
  const tagsByNm = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const assignment of tagAssignments) {
      const list = map.get(assignment.nm_id) ?? [];
      list.push(assignment.tag_id);
      map.set(assignment.nm_id, list);
    }
    return map;
  }, [tagAssignments]);
  const journalByNm = useMemo(() => {
    const map = new Map<number, RnpJournalEntry[]>();
    for (const entry of journal) {
      const list = map.get(entry.nm_id) ?? [];
      list.push(entry);
      map.set(entry.nm_id, list);
    }
    return map;
  }, [journal]);
  const anomalyByNm = useMemo(() => {
    const map = new Map<number, RnpAnomaly[]>();
    // Пороги по каждой метрике + дефицит остатка + серии падения подряд.
    const thresholds = scaleAnomalyThresholds(anomalyThreshold);
    for (const sku of activeData?.skus ?? []) {
      const anomalies = detectSkuSignals(sku, previousSkuByNm.get(sku.nm), thresholds, anomalyThreshold);
      if (anomalies.length) map.set(sku.nm, anomalies);
    }
    return map;
  }, [activeData?.skus, anomalyThreshold, previousSkuByNm]);

  const brands = useMemo(
    () => rnpBrandOptions(activeData?.skus ?? []),
    [activeData?.skus],
  );
  const productCategories = useMemo(
    () => rnpCategoryOptions(activeData?.skus ?? [], byArticle),
    [activeData?.skus, byArticle],
  );
  useEffect(() => {
    if (brand && !brands.includes(brand)) setBrand("");
  }, [brand, brands]);
  useEffect(() => {
    if (category && category !== "__none" && !productCategories.includes(category)) setCategory("");
  }, [category, productCategories]);
  const facetSkus = useMemo(
    () => filterRnpProductFacets(activeData?.skus ?? [], {
      brand,
      category,
      fallbackCategoryByArticle: byArticle,
    }),
    [activeData?.skus, brand, byArticle, category],
  );
  const filteredSkus = useMemo(() => facetSkus
    .filter((sku) => matchesArticleList(sku, articleQuery))
    .filter((sku) => !activeTagIds.length || (tagsByNm.get(sku.nm) ?? []).some((tagId) => activeTagIds.includes(tagId)))
    .filter((sku) => {
      if (anomalyMode === "off") return true;
      return filterAnomalies(anomalyByNm.get(sku.nm) ?? [], anomalyMode).length > 0;
    }), [activeTagIds, anomalyByNm, anomalyMode, articleQuery, facetSkus, tagsByNm]);

  const sortedSkus = useMemo(
    () => sortRnpProducts(filteredSkus, sortField, sortDirection),
    [filteredSkus, sortDirection, sortField],
  );

  const tableSkus = useMemo(
    () => focusedNm == null ? sortedSkus : sortedSkus.filter((sku) => sku.nm === focusedNm),
    [focusedNm, sortedSkus],
  );

  useEffect(() => {
    if (focusedNm != null && !sortedSkus.some((sku) => sku.nm === focusedNm)) setFocusedNm(null);
  }, [focusedNm, sortedSkus]);

  useEffect(() => {
    setSkuWindow({ start: 0, end: Math.min(4, tableSkus.length) });
    setMobileLimit(MOBILE_PAGE_SIZE);
    if (tableViewportRef.current) tableViewportRef.current.scrollTop = 0;
  }, [metricFields.length, showDeltas, tableSkus]);

  useEffect(() => {
    const available = new Set((activeData?.skus ?? []).map((sku) => sku.nm));
    setSelectedOperationNms((current) => current.filter((nm) => available.has(nm)));
    if (operationsSkuNm != null && !available.has(operationsSkuNm)) setOperationsSkuNm(null);
  }, [activeData?.skus, operationsSkuNm]);

  const visibleSkus = tableSkus.slice(skuWindow.start, skuWindow.end);
  const mobileSkus = tableSkus.slice(0, mobileLimit);
  const operationsSku = operationsSkuNm == null ? null : activeData?.skus.find((sku) => sku.nm === operationsSkuNm) ?? null;
  const anomalyCount = [...anomalyByNm.values()].filter((items) => items.length > 0).length;
  const monthDayCount = daysInMonth(month);
  const planOverview = (() => {
    if (!activeData) return null;
    const metric = findMetric(activeData.summary, "orders_sum") ?? null;
    const planValue = aggregatePlanValue(plan, activeData.skus, "orders_sum", monthDayCount);
    const plannedSku = activeData.skus.filter((sku) => Number.isFinite(plan[String(sku.nm)]?.orders_sum)).length;
    return {
      metric,
      planValue,
      planCoveragePct: activeData.skus.length ? Math.round(plannedSku / activeData.skus.length * 100) : 0,
      progress: planValue && metric?.forecast != null ? metric.forecast / planValue * 100 : null,
      readyMetrics: activeData.summary.filter((item) => item.status === "ready").length,
      partialMetrics: activeData.summary.filter((item) => item.status === "partial").length,
      unavailableMetrics: activeData.summary.filter((item) => item.status === "unavailable").length,
    };
  })();
  const focusSummary = useMemo(
    () => activeData ? buildRnpFocusSummary(sortedSkus) : null,
    [activeData, sortedSkus],
  );
  const articleCompareCatalog = useMemo(
    () => activeData ? buildRnpArticleCompare(sortedSkus, activeData.period, compareMetric, sortedSkus.length || 1) : null,
    [activeData, compareMetric, sortedSkus],
  );
  const compareColorByNm = useMemo(
    () => new Map((articleCompareCatalog?.lines ?? []).map((line, index) => [line.nm, COMPARE_COLORS[index % COMPARE_COLORS.length]])),
    [articleCompareCatalog],
  );
  const compareSkuByNm = useMemo(
    () => new Map(sortedSkus.map((sku) => [sku.nm, sku])),
    [sortedSkus],
  );
  const filteredCompareOptions = useMemo(() => {
    const options = articleCompareCatalog?.lines ?? [];
    const query = compareQuery.trim().toLocaleLowerCase("ru-RU");
    if (!query) return options;
    return options.filter((line) => {
      const sku = compareSkuByNm.get(line.nm);
      const haystack = `${line.label} ${sku?.name ?? ""} ${line.nm}`.toLocaleLowerCase("ru-RU");
      return haystack.includes(query);
    });
  }, [articleCompareCatalog, compareQuery, compareSkuByNm]);
  const selectedCompareSkus = useMemo(() => {
    if (!selectedCompareNms.length) return [];
    const selected = new Set(selectedCompareNms);
    return sortedSkus.filter((sku) => selected.has(sku.nm));
  }, [selectedCompareNms, sortedSkus]);
  const articleCompare = useMemo(
    () => activeData ? buildRnpArticleCompare(selectedCompareSkus, activeData.period, compareMetric, selectedCompareSkus.length || 1) : null,
    [activeData, compareMetric, selectedCompareSkus],
  );
  const visibleSystemPresets = useMemo(
    () => SYSTEM_FILTER_PRESETS.filter((preset) => !preset.categoryKeywords?.length || Boolean(matchingPresetCategory(preset, productCategories))),
    [productCategories],
  );
  const allFilterPresets = useMemo(
    () => [...visibleSystemPresets, ...userFilterPresets],
    [userFilterPresets, visibleSystemPresets],
  );
  const metricDefinitions = useMemo(
    () => RNP_METRIC_FIELDS.map((field) => ({ field, label: METRIC_FALLBACKS[field].label })),
    [],
  );
  const previousSummaryByField = useMemo(
    () => new Map((withTax(previousData)?.summary ?? []).map((metric) => [metric.field, metric])),
    [previousData, withTax],
  );
  const metricRowHeight = showDeltas ? DELTA_METRIC_ROW_HEIGHT : METRIC_ROW_HEIGHT;
  const skuBlockHeight = metricFields.length * metricRowHeight;
  const tablePrefixHeight = 38 + 34 + metricFields.length * metricRowHeight + 34;

  const updateSkuWindow = (element: HTMLDivElement) => {
    const offset = Math.max(0, element.scrollTop - tablePrefixHeight);
    const firstVisible = Math.floor(offset / skuBlockHeight);
    const visibleBlocks = Math.ceil(element.clientHeight / skuBlockHeight);
    const start = Math.max(0, firstVisible - 1);
    const end = Math.min(tableSkus.length, firstVisible + visibleBlocks + 2);
    setSkuWindow((current) => (current.start === start && current.end === end ? current : { start, end }));
  };

  useEffect(() => {
    const available = articleCompareCatalog?.lines.map((line) => line.nm) ?? [];
    setSelectedCompareNms((current) => {
      const availableSet = new Set(available);
      const kept = current.filter((nm) => availableSet.has(nm));
      if (kept.length) return kept;
      return available.slice(0, Math.min(DEFAULT_COMPARE_SELECTED_LIMIT, available.length));
    });
  }, [articleCompareCatalog]);

  useEffect(() => {
    if (focusedNm != null && !selectedCompareNms.includes(focusedNm)) setFocusedNm(null);
  }, [focusedNm, selectedCompareNms]);

  const selectAllCompareSkus = () => setSelectedCompareNms((articleCompareCatalog?.lines ?? []).map((line) => line.nm));
  const selectTopCompareSkus = () => setSelectedCompareNms((articleCompareCatalog?.lines ?? []).slice(0, Math.min(5, DEFAULT_COMPARE_SELECTED_LIMIT)).map((line) => line.nm));
  const clearCompareSkus = () => setSelectedCompareNms([]);
  const toggleCompareSku = (nm: number) => {
    setSelectedCompareNms((current) => current.includes(nm) ? current.filter((item) => item !== nm) : [...current, nm]);
  };

  const applyPreset = (preset: DateRange["preset"]) => setRange(rangeFor(preset));

  const applyMetricView = (viewId: Exclude<RnpViewId, "custom">) => {
    const view = RNP_VIEW_PRESETS.find((item) => item.id === viewId);
    if (!view) return;
    setMetricViewId(viewId);
    setMetricFields([...view.fields]);
  };

  const updateMetricFields = (fields: RnpMetricField[]) => {
    setMetricFields(sanitizeMetricFields(fields));
    setMetricViewId("custom");
  };

  const applyFilterPreset = (preset: RnpFilterPreset) => {
    const nextCabinet = preset.cabinetId;
    if (
      nextCabinet &&
      nextCabinet !== cabinetId &&
      (nextCabinet === "all" || cabinets.some((cabinet) => cabinet.id === nextCabinet))
    ) {
      setCabinetId(nextCabinet);
    }
    if (preset.from && preset.to) {
      setRange({ from: preset.from, to: preset.to, preset: preset.rangePreset ?? "custom" });
    } else if (preset.rangePreset) {
      setRange(rangeFor(preset.rangePreset));
    }
    setCategory(matchingPresetCategory(preset, productCategories));
    setSortField(preset.sortField ?? "orders_sum");
    setSortDirection(preset.sortDirection ?? -1);
    if (isCompareMetric(preset.compareMetric)) setCompareMetric(preset.compareMetric);
    setFocusedNm(null);
  };

  const saveCurrentFilterPreset = () => {
    const defaultName = [
      activeCabinet?.name ?? (cabinetId === "all" ? "Все кабинеты" : "РНП"),
      category && category !== "__none" ? category : null,
      SORTS.find((sort) => sort.field === sortField)?.label ?? sortField,
    ].filter(Boolean).join(" · ");
    const label = window.prompt("Название быстрого среза", defaultName || "Мой срез РНП")?.trim();
    if (!label) return;
    const nextPreset: RnpFilterPreset = {
      id: `user-${Date.now()}`,
      label: label.slice(0, 40),
      cabinetId,
      category,
      rangePreset: range.preset,
      from: range.from,
      to: range.to,
      sortField,
      sortDirection,
      compareMetric,
    };
    setUserFilterPresets((current) => {
      const next = [nextPreset, ...current].slice(0, MAX_USER_FILTER_PRESETS);
      writeUserFilterPresets(next);
      return next;
    });
  };

  const deleteFilterPreset = (id: string) => {
    setUserFilterPresets((current) => {
      const next = current.filter((preset) => preset.id !== id);
      writeUserFilterPresets(next);
      return next;
    });
  };

  const postOperation = async <T extends RnpOperationsPayload>(body: Record<string, unknown>) => {
    if (!canWrite || cabinetId === "all") return null;
    setOperationsBusy(true);
    setOperationsMessage(null);
    try {
      const response = await deploymentPinnedFetch(`/api/rnp/${encodeURIComponent(cabinetId)}/operations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await readApiResponse<T>(response, "Операция РНП");
      if (!response.ok) throw new Error(result.error || `Ошибка ${response.status}`);
      return result;
    } catch (cause) {
      setOperationsMessage(cause instanceof Error ? cause.message : "Не удалось сохранить изменение");
      return null;
    } finally {
      setOperationsBusy(false);
    }
  };

  const createTag = async (name: string, color: string) => {
    const result = await postOperation<RnpOperationsPayload & { tag?: RnpTagOption }>({
      action: "create_tag",
      name,
      color,
    });
    if (result?.tag) setTags((current) => [...current, result.tag!].sort((left, right) => left.name.localeCompare(right.name, "ru")));
    return Boolean(result?.tag);
  };

  const setTagForNms = async (tagId: string, nmIds: number[], assigned: boolean) => {
    if (!nmIds.length) return false;
    const result = await postOperation({ action: "set_tag", tagId, nmIds, assigned });
    if (!result) return false;
    setTagAssignments((current) => {
      const selected = new Set(nmIds);
      const without = current.filter((item) => !(item.tag_id === tagId && selected.has(item.nm_id)));
      return assigned ? [
        ...without,
        ...nmIds.map((nm) => ({ nm_id: nm, tag_id: tagId })),
      ] : without;
    });
    return true;
  };

  const bulkTag = async (tagId: string) => {
    const ok = await setTagForNms(tagId, selectedOperationNms, true);
    if (ok) setSelectedOperationNms([]);
  };

  const addJournal = async (input: { eventDate: string; eventType: string; comment: string }) => {
    if (!operationsSku) return false;
    const result = await postOperation<RnpOperationsPayload & { entry?: RnpJournalEntry }>({
      action: "add_journal",
      nmId: operationsSku.nm,
      ...input,
    });
    if (!result?.entry) return false;
    setJournal((current) => [result.entry!, ...current]);
    return true;
  };

  const savePlan = async (sku: Sku, metric: Metric) => {
    const key = `${sku.nm}:${metric.field}`;
    const raw = drafts[key];
    if (raw === undefined) return;
    const normalized = raw.trim().replace(/\s/g, "").replace(",", ".");
    const value = normalized === "" ? null : Number(normalized);
    if (value != null && !Number.isFinite(value)) {
      setPlanMessage("План должен быть числом");
      return;
    }

    setSaving(key);
    setPlanMessage(null);
    const response = await deploymentPinnedFetch(`/api/rnp/${encodeURIComponent(cabinetId)}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, nm: String(sku.nm), field: metric.field, value }),
    });
    const body = await readApiResponse<{ error?: string }>(response, "Сохранение плана РНП");
    setSaving(null);
    if (!response.ok) {
      setPlanMessage(body.error || `Ошибка ${response.status}`);
      return;
    }
    setPlan((current) => {
      const skuPlan = { ...(current[String(sku.nm)] ?? {}) };
      if (value == null) delete skuPlan[metric.field];
      else skuPlan[metric.field] = value;
      return { ...current, [String(sku.nm)]: skuPlan };
    });
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const downloadTable = () => {
    if (!activeData) return;
    const header = ["Артикул", "WB ID", "Название", "Показатель", "За период", ...activeData.period.map((day) => day.label)];
    const rows = tableSkus.flatMap((sku) =>
      completeMetrics(sku.metrics, activeData.period.length, metricFields).map((metric) => [
        sku.art,
        String(sku.nm),
        sku.name,
        metric.label,
        metric.total == null || !Number.isFinite(metric.total) ? "" : String(metric.total),
        ...metric.daily.map((value) => value == null || !Number.isFinite(value) ? "" : String(value)),
      ]));
    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";"))
      .join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `rnp-${range.from}-${range.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f7f7fb] px-3 pb-20 pt-4 md:px-6 md:pb-8 lg:px-7">
      <header className="mb-3 flex min-h-12 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700">
            <BarChart3Icon bare />
          </span>
          <div className="min-w-0">
            <div className="text-[10px] font-medium leading-3 text-slate-400">Аналитика</div>
            <h1 className="mt-0.5 truncate text-xl font-bold leading-6 tracking-[-0.02em] text-slate-900">Рука на пульсе</h1>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={!canWrite}
            onClick={() => setPlanning((value) => !value)}
            title={!canWrite ? "Для планирования выберите один кабинет" : "Редактировать план внутри таблицы"}
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
              planning ? "border-violet-600 bg-violet-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-violet-200 hover:text-violet-700"
            }`}
          >
            <Pencil className="h-3.5 w-3.5" /> Планирование
          </button>
          <button
            type="button"
            onClick={() => setRetryKey((key) => key + 1)}
            disabled={loading}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#7567e8] px-3.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-[#6558d9] disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Обновить
          </button>
        </div>
      </header>

      <section className="relative z-30 mb-4 rounded-[14px] border border-[#e5e7ef] bg-white p-3.5 shadow-[0_2px_10px_rgba(15,23,42,0.04)]" aria-label="Фильтры РНП">
        <div className="grid items-end gap-2.5 sm:grid-cols-2 xl:grid-cols-[132px_132px_minmax(0,1fr)_110px_142px]">
          <label>
            <span className="mb-1 block h-3 whitespace-nowrap text-[10px] font-medium leading-3 text-slate-500">С даты</span>
            <input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(event) => setRange((current) => ({ ...current, from: event.target.value, preset: "custom" }))}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </label>
          <label>
            <span className="mb-1 block h-3 whitespace-nowrap text-[10px] font-medium leading-3 text-slate-500">По дату</span>
            <input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(event) => setRange((current) => ({ ...current, to: event.target.value, preset: "custom" }))}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </label>
          <div className="flex min-w-0 flex-wrap items-end gap-1.5 xl:flex-nowrap">
            <button
              type="button"
              onClick={downloadTable}
              disabled={!activeData}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" /> Скачать
            </button>
            <button
              type="button"
              onClick={() => applyPreset("today")}
              className={`h-9 whitespace-nowrap rounded-lg border px-2.5 text-[10px] font-medium transition ${
                range.preset === "today"
                  ? "border-violet-200 bg-violet-50 text-violet-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              Сегодня
            </button>
            {PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => applyPreset(preset.value)}
                className={`h-9 whitespace-nowrap rounded-lg border px-2.5 text-[10px] font-medium transition ${
                  range.preset === preset.value
                    ? "border-violet-200 bg-violet-50 text-violet-700"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <label>
            <span className="mb-1 block h-3 whitespace-nowrap text-[10px] font-medium leading-3 text-slate-500">Окно оборота, дн</span>
            <input
              type="number"
              min={1}
              max={180}
              value={turnoverWindowDays}
              onChange={(event) => setTurnoverWindowDays(Math.max(1, Math.min(180, Number(event.target.value) || 7)))}
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[11px] tabular-nums text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </label>
          <label>
            <span className="mb-1 block h-3 whitespace-nowrap text-[10px] font-medium leading-3 text-slate-500">Налог, %</span>
            <input
              type="number"
              min={0}
              max={50}
              step={0.5}
              value={taxPct}
              onChange={(event) => setTaxPct(Math.max(0, Math.min(50, Number(event.target.value) || 0)))}
              title="Ставка налога с выручки. Влияет только на чистую прибыль и чистую маржу; прибыль после расходов МП остаётся до налога."
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[11px] tabular-nums text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </label>
          <div>
            <span className="mb-1 block h-3 whitespace-nowrap text-[10px] font-medium leading-3 text-slate-500">Остатки</span>
            <span className="flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-violet-300 bg-violet-50 px-2 text-center text-[9px] font-semibold leading-3 text-violet-700" title="Используются актуальные остатки WB">
              Актуальные WB
            </span>
          </div>
        </div>

        <RnpOperatingToolbar
          viewId={metricViewId}
          metricFields={metricFields}
          metrics={metricDefinitions}
          metricsOpen={metricsOpen}
          articleQuery={articleQuery}
          showDeltas={showDeltas}
          deltaMode={deltaMode}
          heatmapEnabled={heatmapEnabled}
          sparklinesEnabled={sparklinesEnabled}
          compactNumbers={compactNumbers}
          anomalyMode={anomalyMode}
          anomalyThreshold={anomalyThreshold}
          anomalyCount={anomalyCount}
          turnoverWindowDays={turnoverWindowDays}
          tags={tags}
          activeTagIds={activeTagIds}
          selectedCount={selectedOperationNms.length}
          operationsAvailable={operationsAvailable}
          sortField={sortField}
          sortDirection={sortDirection}
          sortOptions={SORTS}
          busy={operationsBusy}
          onViewChange={applyMetricView}
          onMetricFieldsChange={updateMetricFields}
          onMetricsOpenChange={setMetricsOpen}
          onArticleQueryChange={setArticleQuery}
          onShowDeltasChange={setShowDeltas}
          onDeltaModeChange={setDeltaMode}
          onHeatmapChange={setHeatmapEnabled}
          onSparklinesChange={setSparklinesEnabled}
          onCompactNumbersChange={setCompactNumbers}
          onAnomalyModeChange={setAnomalyMode}
          onAnomalyThresholdChange={setAnomalyThreshold}
          onTurnoverWindowChange={setTurnoverWindowDays}
          onSortFieldChange={setSortField}
          onSortDirectionChange={setSortDirection}
          onTagFilterToggle={(tagId) => setActiveTagIds((current) => current.includes(tagId) ? current.filter((item) => item !== tagId) : [...current, tagId])}
          onCreateTag={createTag}
          onBulkTag={bulkTag}
          onClearSelection={() => setSelectedOperationNms([])}
          brand={brand}
          brands={brands}
          category={category}
          categories={productCategories}
          onBrandChange={setBrand}
          onCategoryChange={setCategory}
        />
      </section>

      {SHOW_RNP_ASSISTANT_BLOCKS && (
        <section className="mb-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.03)]" aria-label="Быстрые срезы РНП">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-1">
              <h2 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Быстрые срезы</h2>
              <p className="text-[9px] text-slate-400">Кабинет · период · категория · сортировка</p>
            </div>
            {allFilterPresets.map((preset) => (
              <span key={preset.id} className="inline-flex h-8 items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                <button
                  type="button"
                  onClick={() => applyFilterPreset(preset)}
                  title={preset.description ?? "Применить сохранённый срез"}
                  className={`h-8 px-2.5 text-[10px] font-semibold transition hover:bg-violet-50 hover:text-violet-700 ${
                    preset.system ? "text-slate-600" : "text-violet-700"
                  }`}
                >
                  {preset.label}
                </button>
                {!preset.system && (
                  <button
                    type="button"
                    onClick={() => deleteFilterPreset(preset.id)}
                    aria-label={`Удалить срез ${preset.label}`}
                    className="grid h-8 w-7 place-items-center border-l border-slate-200 text-[13px] font-semibold text-slate-300 hover:bg-rose-50 hover:text-rose-600"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            <button
              type="button"
              onClick={saveCurrentFilterPreset}
              className="ml-auto h-8 rounded-lg border border-violet-200 bg-violet-50 px-2.5 text-[10px] font-semibold text-violet-700 hover:border-violet-300 hover:bg-violet-100"
            >
              Сохранить текущий срез
            </button>
          </div>
        </section>
      )}

      {planMessage && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {planMessage}
        </div>
      )}
      {operationsMessage && canWrite && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {operationsMessage}
        </div>
      )}

      {SHOW_RNP_ASSISTANT_BLOCKS && activeData?.scope_freshness?.length ? <RnpFreshnessNotice items={activeData.scope_freshness} /> : null}

      {SHOW_RNP_ASSISTANT_BLOCKS && activeData && focusSummary && (
        <section className="mb-2.5 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]" aria-label="Фокус РНП">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-xs font-bold text-slate-800">Фокус по текущему срезу</h2>
              <p className="mt-0.5 text-[10px] text-slate-400">
                Считает {focusSummary.skuCount} SKU после выбора кабинета, периода и категории. ДРР = реклама / заказы.
              </p>
            </div>
            <span className="rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-[9px] font-semibold text-violet-700">
              {category ? "Категория" : "Все категории"} · {SORTS.find((sort) => sort.field === sortField)?.label}
            </span>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
            <OverviewMetric
              label="Заказы"
              value={fmt(focusSummary.ordersRub, "money")}
              detail={`${fmt(focusSummary.ordersCount, "int")} шт`}
              tone="slate"
            />
            <OverviewMetric
              label="Выкупы"
              value={fmt(focusSummary.buyoutsRub, "money")}
              detail={`${fmt(focusSummary.buyoutsCount, "int")} шт · выкуп ${fmt(focusSummary.buyoutPct, "pct")}`}
              tone={focusSummary.buyoutPct == null ? "slate" : focusSummary.buyoutPct < 50 ? "amber" : "emerald"}
            />
            <OverviewMetric
              label="Реклама"
              value={fmt(focusSummary.adSpent, "money")}
              detail={`ДРР к заказам ${fmt(focusSummary.drr, "pct")}`}
              tone={focusSummary.drr != null && focusSummary.drr >= 30 ? "rose" : focusSummary.drr != null && focusSummary.drr >= 20 ? "amber" : "slate"}
            />
            <OverviewMetric
              label="Прибыль после МП"
              value={fmt(focusSummary.gross, "money")}
              detail={`Маржа ${fmt(focusSummary.marginPct, "pct")}`}
              tone={focusSummary.gross == null ? "slate" : focusSummary.gross < 0 ? "rose" : "emerald"}
            />
            <OverviewMetric
              label="Остаток"
              value={`${fmt(focusSummary.stock, "int")} шт`}
              detail={focusSummary.stockMoney == null ? "В деньгах —" : `В деньгах ${compactFmt(focusSummary.stockMoney, "money")} ₽`}
              tone="slate"
            />
            <OverviewMetric
              label="GMROI"
              value={fmt(focusSummary.gmroi, "pct")}
              detail="прибыль / деньги в остатках"
              tone={focusSummary.gmroi == null ? "slate" : focusSummary.gmroi < 30 ? "amber" : "violet"}
            />
          </div>

          <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
            {focusSummary.signals.map((signal) => (
              <FocusSignal key={signal.id} signal={signal} />
            ))}
          </div>
        </section>
      )}

      {SHOW_RNP_ASSISTANT_BLOCKS && activeData && planOverview && (
        <section className="mb-2.5 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]" aria-label="План факт прогноз РНП">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-xs font-bold text-slate-800">План · факт · прогноз заказов</h2>
              <p className="mt-0.5 text-[10px] text-slate-400">Месячный план сравнивается с прогнозом полного месяца, а не с незавершённым фактом.</p>
            </div>
            <div className="text-right text-[9px] leading-4 text-slate-400">
              <div>Факт по {activeData.as_of}</div>
              <div>Снимок {new Date(activeData.generated_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <OverviewMetric
              label="План месяца"
              value={fmt(planOverview.planValue, "money")}
              detail={planOverview.planValue == null ? "План не задан" : `Покрыто ${planOverview.planCoveragePct}% SKU`}
              tone={planOverview.planValue == null ? "amber" : "slate"}
            />
            <OverviewMetric label="Факт месяца" value={fmt(planOverview.metric?.total, "money")} detail={`по ${activeData.as_of}`} tone="slate" />
            <OverviewMetric
              label="Прогноз месяца"
              value={fmt(planOverview.metric?.forecast, "money")}
              detail={planOverview.metric?.forecastLow != null && planOverview.metric.forecastHigh != null
                ? `Диапазон ${compactFmt(planOverview.metric.forecastLow, "money")}–${compactFmt(planOverview.metric.forecastHigh, "money")} ₽`
                : "Недостаточно данных"}
              tone="violet"
            />
            <OverviewMetric
              label="Выполнение плана"
              value={fmt(planOverview.progress, "pct")}
              detail={planOverview.planValue == null ? "Задайте план по SKU" : `Уверенность ${planOverview.metric?.forecastConfidencePct ?? 0}%`}
              tone={planOverview.progress != null && planOverview.progress < 90 ? "rose" : "emerald"}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-2.5 py-2 text-[9px] text-slate-500">
            <span>Качество метрик: {planOverview.readyMetrics} готово · {planOverview.partialMetrics} частично · {planOverview.unavailableMetrics} недоступно</span>
            <span>{activeData.forecast_note}</span>
            <span>«Выкуп потока» не является когортным показателем и может превышать 100%.</span>
          </div>
        </section>
      )}

      {SHOW_RNP_ASSISTANT_BLOCKS && activeData && articleCompare && articleCompareCatalog && (
        <section className="mb-2.5 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]" aria-label="Сравнение артикулов РНП">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-xs font-bold text-slate-800">Сравнение артикулов</h2>
              <p className="mt-0.5 text-[10px] text-slate-400">
                Доступно {articleCompareCatalog.lines.length} SKU из текущей категории. Выберите нужные артикулы, клик по линии фильтрует таблицу до SKU.
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {COMPARE_METRICS.map((metric) => (
                <button
                  key={metric.field}
                  type="button"
                  onClick={() => setCompareMetric(metric.field)}
                  className={`h-7 rounded-md border px-2.5 text-[10px] font-semibold transition ${
                    compareMetric === metric.field
                      ? "border-violet-200 bg-violet-50 text-violet-700"
                      : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {metric.label}
                </button>
              ))}
            </div>
          </div>

          {articleCompareCatalog.lines.length > 0 ? (
            <>
              <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="h-[260px] min-w-0 rounded-lg border border-slate-100 bg-white p-2">
                  {articleCompare.lines.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                      <LineChart data={articleCompare.points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="date" fontSize={10} minTickGap={18} stroke="#94a3b8" />
                        <YAxis
                          width={42}
                          fontSize={10}
                          stroke="#94a3b8"
                          tickFormatter={(value) => formatChartValue(Number(value), articleCompare.metricKind)}
                        />
                        <Tooltip
                          formatter={(value, name) => [
                            formatChartValue(Number(value), articleCompare.metricKind),
                            articleCompare.lines.find((line) => line.key === String(name))?.label ?? String(name),
                          ]}
                          labelFormatter={(label) => `Дата ${label}`}
                        />
                        {articleCompare.lines.map((line, index) => (
                          <Line
                            key={line.key}
                            type="monotone"
                            dataKey={line.key}
                            name={line.key}
                            stroke={compareColorByNm.get(line.nm) ?? COMPARE_COLORS[index % COMPARE_COLORS.length]}
                            strokeWidth={2}
                            dot={{ r: 2 }}
                            connectNulls
                            onClick={() => setFocusedNm(line.nm)}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="grid h-full place-items-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-center text-xs text-slate-400">
                      Выберите хотя бы один артикул справа.
                    </div>
                  )}
                </div>

                <aside className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Артикулы на графике</div>
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        выбрано {selectedCompareNms.length} из {articleCompareCatalog.lines.length}
                      </div>
                    </div>
                    {focusedNm != null && (
                      <button
                        type="button"
                        onClick={() => setFocusedNm(null)}
                        className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-violet-700 hover:bg-violet-50"
                      >
                        Все SKU
                      </button>
                    )}
                  </div>
                  <input
                    value={compareQuery}
                    onChange={(event) => setCompareQuery(event.target.value)}
                    placeholder="поиск по артикулу, названию или WB ID"
                    className="mt-2 h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                  />
                  <div className="mt-2 flex flex-wrap gap-1">
                    <button type="button" onClick={selectAllCompareSkus} className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-600 hover:text-violet-700">
                      Все артикулы
                    </button>
                    <button type="button" onClick={selectTopCompareSkus} className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-600 hover:text-violet-700">
                      Топ-5
                    </button>
                    <button type="button" onClick={clearCompareSkus} className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-600 hover:text-rose-600">
                      Очистить
                    </button>
                  </div>
                  <div className="mt-2 max-h-[210px] space-y-1 overflow-auto pr-1">
                    {filteredCompareOptions.length > 0 ? filteredCompareOptions.map((line) => {
                      const checked = selectedCompareNms.includes(line.nm);
                      const sku = compareSkuByNm.get(line.nm);
                      return (
                        <label
                          key={line.key}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-[10px] transition ${
                            checked ? "border-violet-200 bg-white text-slate-800 shadow-[0_1px_1px_rgba(15,23,42,0.04)]" : "border-transparent bg-white/50 text-slate-500 hover:bg-white"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCompareSku(line.nm)}
                            className="h-3.5 w-3.5 accent-violet-600"
                          />
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: compareColorByNm.get(line.nm) ?? "#94a3b8" }} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-bold">{line.label}</span>
                            <span className="block truncate text-[9px] text-slate-400">
                              WB {line.nm}{sku?.name && sku.name !== line.label ? ` · ${sku.name}` : ""}
                            </span>
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums text-slate-600">{fmt(line.total, articleCompareCatalog.metricKind)}</span>
                        </label>
                      );
                    }) : (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-[10px] text-slate-400">
                        Поиск ничего не нашёл.
                      </div>
                    )}
                  </div>
                </aside>
              </div>

              <div className="mt-2 max-h-16 overflow-auto rounded-lg bg-slate-50 p-1.5 text-[10px] text-slate-500">
                <div className="flex flex-wrap gap-1.5">
                  {articleCompare.lines.map((line, index) => (
                    <button
                      key={line.key}
                      type="button"
                      onClick={() => setFocusedNm((current) => current === line.nm ? null : line.nm)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition ${
                        focusedNm === line.nm ? "bg-violet-50 text-violet-700 ring-1 ring-violet-200" : "bg-white text-slate-500 hover:bg-slate-100"
                      }`}
                      title="Нажмите, чтобы оставить в таблице только этот SKU"
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: compareColorByNm.get(line.nm) ?? COMPARE_COLORS[index % COMPARE_COLORS.length] }} />
                      <span className="font-semibold text-slate-700">{line.label}</span>
                      <span>{fmt(line.total, articleCompare.metricKind)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-8 text-center text-xs text-slate-400">
              По текущему фильтру нет SKU для сравнения.
            </div>
          )}
        </section>
      )}

      {error && activeData && (
        <ActionableError message={`${error} Показан последний готовый снимок для этого кабинета и периода.`} label="РНП" onRetry={() => setRetryKey((key) => key + 1)} compact tone="amber" className="mb-2" />
      )}

      {loading && !activeData ? (
        <>
          <LoadingBanner seconds={elapsed} hint="РНП по SKU" />
          <SkeletonTableRows rows={12} cols={11} />
        </>
      ) : error && !activeData ? (
        <ActionableError message={error} title="Не удалось загрузить РНП" label="РНП" onRetry={() => setRetryKey((key) => key + 1)} />
      ) : activeData && activeData.skus.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <CalendarDays className="mx-auto h-7 w-7 text-slate-300" />
          <h2 className="mt-2 text-sm font-semibold text-slate-700">Нет данных за выбранный период</h2>
          <p className="mt-1 text-xs text-slate-400">Измените даты или проверьте синхронизацию кабинета.</p>
        </div>
      ) : activeData ? (
        <>
          <div className="hidden space-y-4 md:block">
            <OptimaMatrixCard
              title="Общая сводка"
              subtitle={`${sortedSkus.length} артикулов · ${activeData.shop_label} · данные на ${formatAsOf(activeData.generated_at)}`}
              period={activeData.period}
              metrics={completeMetrics(activeData.summary, activeData.period.length, metricFields)}
              previousMetrics={[...previousSummaryByField.values()]}
              showDeltas={showDeltas}
              deltaMode={deltaMode}
              heatmapEnabled={heatmapEnabled}
              sparklinesEnabled={sparklinesEnabled}
              compactNumbers={compactNumbers}
              onHideMetric={(field) => updateMetricFields(metricFields.filter((item) => item !== field))}
            />

            <label className="flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-[#e5e7ef] bg-white px-4 text-[11px] font-medium text-slate-600 shadow-[0_1px_5px_rgba(15,23,42,0.025)]">
              <input
                type="checkbox"
                disabled={!operationsAvailable || tableSkus.length === 0}
                checked={tableSkus.length > 0 && tableSkus.every((sku) => selectedOperationNms.includes(sku.nm))}
                onChange={(event) => setSelectedOperationNms(event.target.checked ? tableSkus.map((sku) => sku.nm) : [])}
                className="h-4 w-4 accent-violet-600 disabled:opacity-40"
              />
              Выбрать все ({tableSkus.length})
            </label>

            {tableSkus.map((sku) => {
              const skuTagIds = tagsByNm.get(sku.nm) ?? [];
              const skuMetrics = completeMetrics(sku.metrics, activeData.period.length, metricFields);
              return (
                <OptimaProductCard
                  key={sku.nm}
                  sku={sku}
                  period={activeData.period}
                  metrics={skuMetrics}
                  previousMetrics={previousSkuByNm.get(sku.nm)?.metrics ?? []}
                  tags={tags.filter((tag) => skuTagIds.includes(tag.id))}
                  anomalies={anomalyByNm.get(sku.nm) ?? []}
                  selected={selectedOperationNms.includes(sku.nm)}
                  selectable={operationsAvailable}
                  canWrite={canWrite}
                  planning={planning}
                  showDeltas={showDeltas}
                  deltaMode={deltaMode}
                  heatmapEnabled={heatmapEnabled}
                  sparklinesEnabled={sparklinesEnabled}
                  compactNumbers={compactNumbers}
                  plan={plan[String(sku.nm)] ?? {}}
                  drafts={drafts}
                  saving={saving}
                  journal={journalByNm.get(sku.nm) ?? []}
                  onSelectedChange={(selected) => setSelectedOperationNms((current) =>
                    selected ? [...new Set([...current, sku.nm])] : current.filter((nm) => nm !== sku.nm))}
                  onOpenOperations={() => {
                    setOperationsInitialDate(undefined);
                    setOperationsSkuNm(sku.nm);
                  }}
                  onOpenJournalDate={(dateLabel) => {
                    const [day, monthPart] = dateLabel.split(".");
                    setOperationsInitialDate(`${range.to.slice(0, 4)}-${monthPart}-${day}`);
                    setOperationsSkuNm(sku.nm);
                  }}
                  onHideMetric={(field) => updateMetricFields(metricFields.filter((item) => item !== field))}
                  onDraftChange={(field, value) => setDrafts((current) => ({ ...current, [`${sku.nm}:${field}`]: value }))}
                  onSave={(metric) => savePlan(sku, metric)}
                />
              );
            })}
          </div>

          <div className="space-y-2.5 md:hidden">
            <p className="rounded-lg bg-violet-50 px-3 py-2 text-[10px] text-violet-700">
              Сначала показаны {Math.min(mobileLimit, tableSkus.length)} SKU по сортировке «{SORTS.find((sort) => sort.field === sortField)?.label}».
            </p>
            {mobileSkus.map((sku) => {
              const selected = completeMetrics(sku.metrics, activeData.period.length, metricFields).slice(0, 8);
              const orders = findMetric(sku.metrics, "orders_sum");
              const previousOrders = findMetric(previousSkuByNm.get(sku.nm)?.metrics ?? [], "orders_sum");
              const orderDelta = metricDelta(orders?.total, previousOrders?.total);
              const skuPlan = plan[String(sku.nm)]?.orders_sum ?? null;
              const skuTagIds = tagsByNm.get(sku.nm) ?? [];
              return (
                <article key={sku.nm} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <WbProductImage nm={sku.nm} src={sku.img_url} className="h-12 w-12 rounded-lg bg-slate-100 object-cover" />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-xs font-semibold text-violet-700">{sku.art}</h2>
                      <p className="mt-0.5 truncate text-[10px] text-slate-400">{sku.name}</p>
                      <p className="mt-1 text-[9px] text-slate-400">WB {sku.nm}</p>
                    </div>
                    {canWrite ? (
                      <button type="button" onClick={() => setOperationsSkuNm(sku.nm)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-slate-400 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700" aria-label={`Теги и журнал ${sku.art}`}>
                        <BookOpen className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                  {skuTagIds.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tags.filter((tag) => skuTagIds.includes(tag.id)).map((tag) => (
                        <span key={tag.id} className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1 text-[8px] font-semibold text-slate-600">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} />{tag.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <dl className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-50 p-1.5">
                    <div className="rounded-md bg-white px-2 py-1.5"><dt className="text-[8px] text-slate-400">План</dt><dd className="mt-0.5 truncate text-[10px] font-semibold text-slate-700">{compactFmt(skuPlan, "money")}</dd></div>
                    <div className="rounded-md bg-white px-2 py-1.5"><dt className="text-[8px] text-slate-400">Факт</dt><dd className="mt-0.5 truncate text-[10px] font-semibold text-slate-700">{compactFmt(orders?.total, "money")}</dd>{showDeltas && orderDelta ? <DeltaMark delta={orderDelta} kind="money" mode={deltaMode} field="orders_sum" /> : null}</div>
                    <div className="rounded-md bg-white px-2 py-1.5"><dt className="text-[8px] text-slate-400">Прогноз</dt><dd className="mt-0.5 truncate text-[10px] font-semibold text-violet-700">{compactFmt(orders?.forecast, "money")}</dd></div>
                  </dl>
                  <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-slate-200">
                    {selected.map((metric) => (
                      <div key={metric.field} className="bg-white px-2.5 py-2">
                        <dt className="text-[9px] text-slate-400">{metric.label}</dt>
                        <dd className="mt-0.5 text-xs font-semibold tabular-nums text-slate-700">{fmt(metric.total, metric.kind)}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              );
            })}
            {mobileLimit < tableSkus.length && (
              <button
                type="button"
                onClick={() => setMobileLimit((current) => Math.min(tableSkus.length, current + MOBILE_PAGE_SIZE))}
                className="min-h-11 w-full rounded-xl border border-violet-200 bg-white text-xs font-semibold text-violet-700"
              >
                Показать ещё {Math.min(MOBILE_PAGE_SIZE, tableSkus.length - mobileLimit)} SKU
              </button>
            )}
          </div>
        </>
      ) : null}

      <RnpProductOperationsDrawer
        sku={operationsSku}
        initialEventDate={operationsInitialDate}
        tags={tags}
        assignedTagIds={operationsSku ? tagsByNm.get(operationsSku.nm) ?? [] : []}
        journal={operationsSku ? journalByNm.get(operationsSku.nm) ?? [] : []}
        loading={operationsLoading}
        available={operationsAvailable}
        message={operationsMessage}
        onClose={() => setOperationsSkuNm(null)}
        onToggleTag={(tagId, assigned) => operationsSku ? setTagForNms(tagId, [operationsSku.nm], assigned) : Promise.resolve(false)}
        onAddJournal={addJournal}
      />
    </div>
  );
}

function formatAsOf(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "—";
  return date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function OptimaMatrixCard({
  title,
  subtitle,
  period,
  metrics,
  previousMetrics,
  showDeltas,
  deltaMode,
  heatmapEnabled,
  sparklinesEnabled,
  compactNumbers,
  onHideMetric,
}: {
  title: string;
  subtitle: string;
  period: RnpTable["period"];
  metrics: Metric[];
  previousMetrics: Metric[];
  showDeltas: boolean;
  deltaMode: RnpDeltaMode;
  heatmapEnabled: boolean;
  sparklinesEnabled: boolean;
  compactNumbers: boolean;
  onHideMetric: (field: RnpMetricField) => void;
}) {
  return (
    <section className="overflow-hidden rounded-[14px] border border-[#e5e7ef] bg-white shadow-[0_2px_10px_rgba(15,23,42,0.035)]">
      <header className="flex min-h-[62px] items-center gap-3 border-b border-[#eceef4] px-4 py-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#f2f0ff] text-[#7567e8]">
          <BarChart3Icon bare />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-slate-900">{title}</h2>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">{subtitle}</p>
        </div>
      </header>
      <OptimaMatrixTable
        period={period}
        metrics={metrics}
        previousMetrics={previousMetrics}
        showDeltas={showDeltas}
        deltaMode={deltaMode}
        heatmapEnabled={heatmapEnabled}
        sparklinesEnabled={sparklinesEnabled}
        compactNumbers={compactNumbers}
        onHideMetric={onHideMetric}
      />
    </section>
  );
}

function OptimaProductCard({
  sku,
  period,
  metrics,
  previousMetrics,
  tags,
  anomalies,
  selected,
  selectable,
  canWrite,
  planning,
  showDeltas,
  deltaMode,
  heatmapEnabled,
  sparklinesEnabled,
  compactNumbers,
  plan,
  drafts,
  saving,
  journal,
  onSelectedChange,
  onOpenOperations,
  onOpenJournalDate,
  onHideMetric,
  onDraftChange,
  onSave,
}: {
  sku: Sku;
  period: RnpTable["period"];
  metrics: Metric[];
  previousMetrics: Metric[];
  tags: RnpTagOption[];
  anomalies: RnpAnomaly[];
  selected: boolean;
  selectable: boolean;
  canWrite: boolean;
  planning: boolean;
  showDeltas: boolean;
  deltaMode: RnpDeltaMode;
  heatmapEnabled: boolean;
  sparklinesEnabled: boolean;
  compactNumbers: boolean;
  plan: Record<string, number>;
  drafts: Record<string, string>;
  saving: string | null;
  journal: RnpJournalEntry[];
  onSelectedChange: (selected: boolean) => void;
  onOpenOperations: () => void;
  onOpenJournalDate: (dateLabel: string) => void;
  onHideMetric: (field: RnpMetricField) => void;
  onDraftChange: (field: string, value: string) => void;
  onSave: (metric: Metric) => void;
}) {
  const risks = anomalies.filter((item) => item.direction === "negative").length;
  const growth = anomalies.filter((item) => item.direction === "positive").length;
  return (
    <article
      className="overflow-hidden rounded-[14px] border border-[#e5e7ef] bg-white shadow-[0_2px_10px_rgba(15,23,42,0.035)]"
      style={{ contentVisibility: "auto", containIntrinsicSize: "620px" }}
    >
      <header className="flex min-h-[76px] flex-wrap items-center gap-3 border-b border-[#eceef4] px-4 py-3">
        <input
          type="checkbox"
          checked={selected}
          disabled={!selectable}
          onChange={(event) => onSelectedChange(event.target.checked)}
          className="h-4 w-4 shrink-0 accent-violet-600 disabled:opacity-30"
          aria-label={`Выбрать артикул ${sku.art}`}
        />
        <WbProductImage nm={sku.nm} src={sku.img_url} className="h-11 w-11 shrink-0 rounded-lg bg-slate-100 object-cover" />
        <div className="min-w-[220px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`https://www.wildberries.ru/catalog/${sku.nm}/detail.aspx`}
              target="_blank"
              rel="noreferrer"
              className="text-[13px] font-bold text-slate-900 hover:text-violet-700"
            >
              {sku.art}
            </a>
            {risks ? <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[8px] font-bold text-rose-600">↓ риск {risks}</span> : null}
            {growth ? <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[8px] font-bold text-emerald-600">↑ рост {growth}</span> : null}
          </div>
          <p className="mt-0.5 max-w-[680px] truncate text-[11px] text-slate-500">{sku.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="grid h-5 min-w-5 place-items-center rounded-md bg-[#f1f2f7] px-1 text-[9px] font-bold text-slate-500">{sku.art.slice(0, 1).toUpperCase()}</span>
            <a href={`https://www.wildberries.ru/catalog/${sku.nm}/detail.aspx`} target="_blank" rel="noreferrer" className="rounded-md bg-[#f7f7fa] px-1.5 py-1 text-[9px] font-medium text-slate-500 hover:text-violet-700">
              WB {sku.nm}
            </a>
            {tags.map((tag) => (
              <span key={tag.id} className="inline-flex items-center gap-1 rounded-md bg-[#f7f7fa] px-1.5 py-1 text-[9px] font-medium text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} />{tag.name}
              </span>
            ))}
            {canWrite ? (
              <button type="button" onClick={onOpenOperations} className="rounded-md border border-dashed border-slate-300 px-1.5 py-0.5 text-[9px] font-medium text-slate-500 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700">
                + тег
              </button>
            ) : null}
          </div>
        </div>
        {canWrite ? (
          <button
            type="button"
            onClick={onOpenOperations}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[9px] font-semibold text-slate-500 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700"
          >
            <BookOpen className="h-3.5 w-3.5" /> Теги и журнал
          </button>
        ) : null}
      </header>
      <OptimaMatrixTable
        period={period}
        metrics={metrics}
        previousMetrics={previousMetrics}
        showDeltas={showDeltas}
        deltaMode={deltaMode}
        heatmapEnabled={heatmapEnabled}
        sparklinesEnabled={sparklinesEnabled}
        compactNumbers={compactNumbers}
        journal={journal}
        onJournalDate={canWrite ? onOpenJournalDate : undefined}
        onHideMetric={onHideMetric}
        planning={planning && canWrite}
        plan={plan}
        drafts={drafts}
        saving={saving}
        skuNm={sku.nm}
        onDraftChange={onDraftChange}
        onSave={onSave}
      />
    </article>
  );
}

function OptimaMatrixTable({
  period,
  metrics,
  previousMetrics,
  showDeltas,
  deltaMode,
  heatmapEnabled,
  sparklinesEnabled,
  compactNumbers,
  journal = [],
  onJournalDate,
  onHideMetric,
  planning = false,
  plan = {},
  drafts = {},
  saving = null,
  skuNm,
  onDraftChange,
  onSave,
}: {
  period: RnpTable["period"];
  metrics: Metric[];
  previousMetrics: Metric[];
  showDeltas: boolean;
  deltaMode: RnpDeltaMode;
  heatmapEnabled: boolean;
  sparklinesEnabled: boolean;
  compactNumbers: boolean;
  journal?: RnpJournalEntry[];
  onJournalDate?: (dateLabel: string) => void;
  onHideMetric: (field: RnpMetricField) => void;
  planning?: boolean;
  plan?: Record<string, number>;
  drafts?: Record<string, string>;
  saving?: string | null;
  skuNm?: number;
  onDraftChange?: (field: string, value: string) => void;
  onSave?: (metric: Metric) => void;
}) {
  const previousByField = new Map(previousMetrics.map((metric) => [metric.field, metric]));
  const openDayIndex = period.findIndex((day) => isOpenMoscowDayLabel(day.label));
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(OPTIMA_TABLE_GROUPS.filter((group) => group.expanded).map((group) => group.id)),
  );
  const groupedMetrics = OPTIMA_TABLE_GROUPS
    .map((group) => ({
      ...group,
      metrics: metrics.filter((metric) => group.fields.includes(metric.field as RnpMetricField)),
    }))
    .filter((group) => group.metrics.length > 0);
  const totalColumns = 2 + (sparklinesEnabled ? 1 : 0) + period.length;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-separate border-spacing-0 text-[11px] leading-[1.15] text-slate-600">
        <thead>
          <tr>
            <th className="sticky left-0 z-20 h-11 w-[205px] min-w-[205px] border-b border-r border-[#e8eaf1] bg-[#fafafd] px-3 text-left text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">Показатель</th>
            <th className="h-11 w-[110px] min-w-[110px] border-b border-r border-[#e8eaf1] bg-[#fafafd] px-3 text-right text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">За период</th>
            {sparklinesEnabled ? <th className="h-11 w-[108px] min-w-[108px] border-b border-r border-[#e8eaf1] bg-[#fafafd] px-2 text-center text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">Мини-график</th> : null}
            {period.map((day, index) => (
              <th key={`${day.label}-${index}`} className="h-11 w-[78px] min-w-[78px] border-b border-r border-[#e8eaf1] bg-[#fafafd] px-2 text-center text-[10px] font-semibold text-slate-600">
                <span className="block">{day.label}</span>
                <span className="mt-0.5 block text-[9px] font-normal lowercase text-slate-400">{day.period_type}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {onJournalDate ? (
            <tr>
              <td className="sticky left-0 z-10 h-9 border-b border-r border-[#eceef4] bg-white px-3 text-[9px] font-bold uppercase tracking-[0.05em] text-slate-500">
                Журнал изменений
              </td>
              <td className="border-b border-r border-[#eceef4] bg-white" />
              {sparklinesEnabled ? <td className="border-b border-r border-[#eceef4] bg-white" /> : null}
              {period.map((day) => {
                const entries = journal.filter((entry) => `${entry.event_date.slice(8, 10)}.${entry.event_date.slice(5, 7)}` === day.label);
                return (
                  <td key={`journal-${day.label}`} className="h-9 border-b border-r border-[#eceef4] bg-white p-1 text-center">
                    <button
                      type="button"
                      onClick={() => onJournalDate(day.label)}
                      title={entries.length ? `${entries.length} событий · добавить запись` : "Добавить запись"}
                      className={`mx-auto grid h-6 min-w-6 place-items-center rounded-md px-1 text-[9px] font-semibold ${
                        entries.length ? "bg-violet-50 text-violet-700" : "text-slate-300 hover:bg-slate-50 hover:text-violet-700"
                      }`}
                    >
                      {entries.length || "—"}
                    </button>
                  </td>
                );
              })}
            </tr>
          ) : null}
          {groupedMetrics.map((group) => {
            const expanded = expandedGroups.has(group.id);
            return (
              <Fragment key={group.id}>
                <tr>
                  <td colSpan={totalColumns} className="h-8 border-b border-[#eceef4] bg-white px-3">
                    <button
                      type="button"
                      onClick={() => setExpandedGroups((current) => {
                        const next = new Set(current);
                        if (next.has(group.id)) next.delete(group.id);
                        else next.add(group.id);
                        return next;
                      })}
                      className="flex h-full w-full items-center gap-1.5 text-left text-[10px] font-semibold text-slate-600 hover:text-violet-700"
                      aria-expanded={expanded}
                    >
                      <span className="text-slate-400">{expanded ? "▼" : "▶"}</span>
                      {group.label}
                      {!expanded ? <span className="ml-1 text-[9px] font-normal text-slate-400">{group.metrics.length}</span> : null}
                    </button>
                  </td>
                </tr>
                {expanded ? group.metrics.map((metric) => {
                  const key = skuNm == null ? metric.field : `${skuNm}:${metric.field}`;
                  const savedPlan = plan[metric.field];
                  const draft = drafts[key] ?? (savedPlan == null ? "" : String(savedPlan));
                  return (
                    <OptimaMetricRow
                      key={metric.field}
                      metric={metric}
                      previousMetric={previousByField.get(metric.field)}
                      showDeltas={showDeltas}
                      deltaMode={deltaMode}
                      heatmapEnabled={heatmapEnabled}
                      sparklinesEnabled={sparklinesEnabled}
                      compactNumbers={compactNumbers}
                      openDayIndex={openDayIndex}
                      canHide={metrics.length > 1}
                      onHide={() => onHideMetric(metric.field as RnpMetricField)}
                      planning={planning}
                      draftValue={draft}
                      saving={saving === key}
                      onDraftChange={(value) => onDraftChange?.(metric.field, value)}
                      onSave={() => onSave?.(metric)}
                    />
                  );
                }) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OptimaMetricRow({
  metric,
  previousMetric,
  showDeltas,
  deltaMode,
  heatmapEnabled,
  sparklinesEnabled,
  compactNumbers,
  openDayIndex,
  canHide,
  onHide,
  planning,
  draftValue,
  saving,
  onDraftChange,
  onSave,
}: {
  metric: Metric;
  previousMetric?: Metric;
  showDeltas: boolean;
  deltaMode: RnpDeltaMode;
  heatmapEnabled: boolean;
  sparklinesEnabled: boolean;
  compactNumbers: boolean;
  openDayIndex: number;
  canHide: boolean;
  onHide: () => void;
  planning: boolean;
  draftValue: string;
  saving: boolean;
  onDraftChange: (value: string) => void;
  onSave: () => void;
}) {
  const totalDelta = showDeltas ? metricDelta(metric.total, previousMetric?.total) : null;
  const qualityTone = metric.status === "ready" ? "bg-[#7567e8]" : metric.status === "partial" ? "bg-amber-400" : "bg-slate-300";
  return (
    <tr className="group">
      <td className="sticky left-0 z-10 h-[48px] w-[205px] min-w-[205px] border-b border-r border-[#eceef4] bg-white px-3 group-hover:bg-[#fbfaff]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canHide}
            onClick={onHide}
            title="Скрыть показатель"
            className={`h-4 w-7 rounded-full p-0.5 transition ${canHide ? "bg-[#7567e8]" : "bg-slate-200"}`}
          >
            <span className="block h-3 w-3 translate-x-3 rounded-full bg-white shadow-sm" />
          </button>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${qualityTone}`} />
          <span className="min-w-0 truncate text-[11px] font-medium text-slate-700" title={metric.label}>{metric.label.replace(/, (₽|%|дней|шт)$/u, "")}</span>
          <span className="ml-auto shrink-0 text-[9px] text-slate-400">{metricUnit(metric)}</span>
        </div>
      </td>
      <td className="h-[48px] w-[110px] min-w-[110px] border-b border-r border-[#eceef4] bg-white px-3 text-right tabular-nums">
        {planning ? (
          <div className="relative">
            <span className="mb-0.5 block text-[8px] text-slate-400">план месяца</span>
            <input
              inputMode="decimal"
              value={draftValue}
              onChange={(event) => onDraftChange(event.target.value)}
              onBlur={onSave}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="h-6 w-full rounded-md border border-amber-200 bg-amber-50 px-1.5 text-right text-[9px] font-semibold text-slate-700 outline-none focus:border-violet-400 focus:bg-white"
              aria-label={`План: ${metric.label}`}
            />
            {saving ? <Loader2 className="absolute left-1 top-[18px] h-3 w-3 animate-spin text-violet-500" /> : null}
          </div>
        ) : (
          <>
            <span className="block text-[11px] font-bold text-slate-800">{matrixFmt(metric.total, metric.kind, compactNumbers)}</span>
            {totalDelta ? <DeltaMark delta={totalDelta} kind={metric.kind} mode={deltaMode} field={metric.field} /> : null}
          </>
        )}
      </td>
      {sparklinesEnabled ? (
        <td className="h-[48px] w-[108px] min-w-[108px] border-b border-r border-[#eceef4] bg-white px-2 text-center">
          <OptimaSparkline values={metric.daily} />
        </td>
      ) : null}
      {metric.daily.map((value, index) => (
        <OptimaDayCell
          key={index}
          metric={metric}
          value={value}
          previousValue={index === openDayIndex ? null : dayOverDayBaseline(metric.daily, previousMetric?.daily, index)}
          showDelta={showDeltas}
          deltaMode={deltaMode}
          heatmapEnabled={heatmapEnabled}
          compactNumbers={compactNumbers}
        />
      ))}
    </tr>
  );
}

function metricUnit(metric: Metric) {
  if (metric.kind === "money") return "₽";
  if (metric.kind === "pct") return "%";
  if (metric.field === "turnover") return "дн.";
  return "шт.";
}

function OptimaDayCell({
  metric,
  value,
  previousValue,
  showDelta,
  deltaMode,
  heatmapEnabled,
  compactNumbers,
}: {
  metric: Metric;
  value: number | null | undefined;
  previousValue: number | null | undefined;
  showDelta: boolean;
  deltaMode: RnpDeltaMode;
  heatmapEnabled: boolean;
  compactNumbers: boolean;
}) {
  const delta = showDelta ? metricDelta(value, previousValue) : null;
  const semantic = delta ? anomalyDirection(metric.field, delta) : null;
  const background = heatmapEnabled
    ? semantic === "positive"
      ? "#eef9f2"
      : semantic === "negative"
        ? "#fff1f2"
        : "#ffffff"
    : "#ffffff";
  return (
    <td
      className="h-[48px] w-[78px] min-w-[78px] border-b border-r border-[#eceef4] px-2 text-center tabular-nums"
      style={{ backgroundColor: background }}
      title={value == null ? "Нет данных" : fmt(value, metric.kind)}
    >
      <span className={`block text-[11px] font-semibold ${toneClass(metric, value ?? null)}`}>{matrixFmt(value, metric.kind, compactNumbers)}</span>
      {delta ? <DeltaMark delta={delta} kind={metric.kind} mode={deltaMode} field={metric.field} /> : null}
    </td>
  );
}

function OptimaSparkline({ values }: { values: Array<number | null> }) {
  const known = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (known.length < 2) return <span className="text-[9px] text-slate-300">→ ровно</span>;
  const max = Math.max(...known.map((value) => Math.abs(value)), 1);
  const width = 90;
  const height = 27;
  const gap = 2;
  const barWidth = Math.max(2, (width - gap * (values.length - 1)) / values.length);
  const first = known[0];
  const last = known[known.length - 1];
  const change = first === 0 ? 0 : ((last - first) / Math.abs(first)) * 100;
  const changePerDay = known.length > 1 ? change / (known.length - 1) : change;
  return (
    <div className="flex flex-col items-center">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-6 w-[90px]" role="img" aria-label="Мини-график показателя">
        {values.map((value, index) => {
          const barHeight = value == null ? 1 : Math.max(2, Math.abs(value) / max * (height - 3));
          return (
            <rect
              key={index}
              x={index * (barWidth + gap)}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              rx={1}
              fill={value == null ? "#e8e7f4" : "#8478eb"}
            />
          );
        })}
      </svg>
      <span className={`mt-0.5 text-[8px] font-semibold ${changePerDay > 0 ? "text-emerald-600" : changePerDay < 0 ? "text-rose-600" : "text-slate-400"}`}>
        {changePerDay > 0 ? "↑" : changePerDay < 0 ? "↓" : "→"} {Math.abs(Math.round(changePerDay))}%/дн
      </span>
    </div>
  );
}

function OverviewMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "slate" | "violet" | "emerald" | "amber" | "rose" }) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-800",
    violet: "border-violet-200 bg-violet-50 text-violet-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
  };
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${tones[tone]}`}>
      <div className="text-[9px] font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-base font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 text-[9px] opacity-70">{detail}</div>
    </div>
  );
}

function FocusSignal({ signal }: { signal: RnpFocusSignal }) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-600",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
  };
  return (
    <div className={`rounded-lg border px-2.5 py-2 ${tones[signal.tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[9px] font-bold uppercase tracking-wide">{signal.label}</span>
        <span className="shrink-0 rounded-full bg-white/80 px-1.5 py-0.5 text-[9px] font-bold tabular-nums">{signal.count}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-[9px] leading-3 opacity-75" title={signal.detail}>{signal.detail}</p>
    </div>
  );
}

function RnpFreshnessNotice({ items }: { items: NonNullable<RnpTable["scope_freshness"]> }) {
  const asOfValues = new Set(items.map((item) => item.as_of).filter(Boolean));
  const hasDifferentCutoffs = asOfValues.size > 1;
  const tone = hasDifferentCutoffs
    ? "border-amber-200 bg-amber-50 text-amber-950"
    : "border-slate-200 bg-white text-slate-700";
  const icon = hasDifferentCutoffs
    ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
    : <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />;
  const sourceText = (label: string, value: string | null | undefined) => `${label}: ${value || "—"}`;

  return (
    <div className={`mb-2 rounded-lg border px-3 py-2 text-[11px] ${tone}`}>
      <div className="flex items-start gap-2">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="font-semibold">
            {hasDifferentCutoffs ? "Границы полного факта различаются" : "Свежесть источников РНП"}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {items.map((item) => (
              <span key={`${item.cabinet_id ?? item.label}-${item.as_of}`} className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-white/70 bg-white/70 px-2 py-1 text-[10px] leading-4 shadow-[0_1px_1px_rgba(15,23,42,0.04)]">
                <b className="text-slate-800">{item.label}</b>
                <span>{sourceText("общий факт", item.as_of)}</span>
                <span>{sourceText("заказы", item.orders_as_of)}</span>
                <span>{sourceText("выкупы", item.sales_as_of)}</span>
                <span>{sourceText("реклама", item.adverts_as_of)}</span>
                <span>{sourceText("воронка", item.funnel_as_of)}</span>
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] leading-4 opacity-75">
            В таблице <b>0</b> означает фактический ноль, а <b>—</b> — источник ещё не вернул данные или день не закрыт. Сводка складывает каждый кабинет только до его доступной даты.
          </p>
        </div>
      </div>
    </div>
  );
}

function BarChart3Icon({ bare = false }: { bare?: boolean }) {
  const bars = (
    <span className="flex h-4 items-end gap-[2px]">
      <span className="h-2 w-[3px] rounded-sm bg-current" />
      <span className="h-4 w-[3px] rounded-sm bg-current" />
      <span className="h-3 w-[3px] rounded-sm bg-current" />
    </span>
  );
  if (bare) return bars;
  return <span className="grid h-7 w-7 place-items-center rounded-lg bg-violet-50 text-violet-700">{bars}</span>;
}

function PlanHeader({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <th className={`sticky top-0 z-30 h-[38px] w-[78px] min-w-[78px] border-b border-r border-slate-200 bg-[#fafbfc] px-1.5 text-right font-semibold text-slate-500 ${strong ? "border-l-2 border-l-slate-300 text-slate-700" : ""}`}>
      {children}
    </th>
  );
}

function TrendHeader() {
  return (
    <th className="sticky top-0 z-30 h-[38px] w-[72px] min-w-[72px] border-b border-r border-slate-200 bg-[#fafbfc] px-1 text-center font-semibold text-slate-500">
      Тренд
      <span className="mt-0.5 block text-[8px] font-normal text-slate-400">по дням</span>
    </th>
  );
}

function SectionRow({ columns, label, icon }: { columns: number; label: string; icon: "chart" | "box" }) {
  return (
    <tr>
      <td colSpan={columns} className="h-[34px] border-b border-[#0b7f80] bg-[#0d9191] px-3 font-bold text-white">
        <span className="inline-flex items-center gap-1.5">
          {icon === "chart" ? <span aria-hidden>▥</span> : <span aria-hidden>◇</span>}
          {label}
        </span>
      </td>
    </tr>
  );
}

function SpacerRow({ columns, height }: { columns: number; height: number }) {
  return (
    <tr aria-hidden="true">
      <td colSpan={columns} style={{ height }} className="border-0 bg-white p-0" />
    </tr>
  );
}

function ProductCell({
  sku,
  rowSpan,
  tags,
  anomalies,
  selected,
  onSelectedChange,
  onOpenOperations,
}: {
  sku: Sku;
  rowSpan: number;
  tags: RnpTagOption[];
  anomalies: RnpAnomaly[];
  selected: boolean;
  onSelectedChange?: (selected: boolean) => void;
  onOpenOperations?: () => void;
}) {
  return (
    <td rowSpan={rowSpan} className="sticky left-0 z-20 w-28 min-w-28 border-b border-r border-slate-200 bg-white p-2 align-top">
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-1">
          <WbProductImage nm={sku.nm} src={sku.img_url} className="h-14 w-14 rounded-md bg-slate-100 object-cover" />
          <div className="flex flex-col gap-1">
            {onSelectedChange ? (
              <label className="grid h-6 w-6 cursor-pointer place-items-center rounded-md border border-slate-200 bg-white hover:border-violet-300" title="Выбрать для массового тега">
                <input type="checkbox" checked={selected} onChange={(event) => onSelectedChange(event.target.checked)} className="h-3 w-3 accent-violet-600" aria-label={`Выбрать ${sku.art}`} />
              </label>
            ) : null}
            {onOpenOperations ? (
              <button type="button" onClick={onOpenOperations} className="grid h-6 w-6 place-items-center rounded-md border border-slate-200 text-slate-400 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700" aria-label={`Открыть теги и журнал ${sku.art}`} title="Теги и журнал">
                <BookOpen className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="truncate text-[10px] font-semibold text-violet-700" title={sku.art}>{sku.art}</div>
        <div className="text-[9px] text-slate-400">{sku.nm}</div>
        <div className="line-clamp-2 text-[9px] leading-3 text-slate-500">{sku.name}</div>
        {tags.length ? (
          <div className="flex flex-wrap gap-0.5 pt-0.5">
            {tags.slice(0, 2).map((tag) => (
              <span key={tag.id} className="inline-flex max-w-[88px] items-center gap-1 rounded-full bg-slate-50 px-1.5 py-0.5 text-[8px] font-semibold text-slate-500" title={tag.name}>
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                <span className="truncate">{tag.name}</span>
              </span>
            ))}
            {tags.length > 2 ? <span className="text-[8px] text-slate-400">+{tags.length - 2}</span> : null}
          </div>
        ) : null}
        {anomalies.length ? (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {/* Конкретика вместо счётчика: сразу видно, что именно просело. */}
            {anomalies.slice(0, 3).map((anomaly) => (
              <span
                key={`${anomaly.field}-${anomaly.kind}`}
                title={`${anomaly.label} · ${anomaly.direction === "negative" ? "риск" : "рост"}`}
                className={`rounded px-1.5 py-0.5 text-[8px] font-bold ${
                  anomaly.direction === "negative" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
                }`}
              >
                {formatAnomalyBadge(anomaly)}
              </span>
            ))}
            {anomalies.length > 3 ? (
              <span
                className="rounded bg-slate-100 px-1.5 py-0.5 text-[8px] font-bold text-slate-600"
                title={anomalies.slice(3).map(formatAnomalyBadge).join(", ")}
              >
                +{anomalies.length - 3}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </td>
  );
}

function SummaryCell({ label, rowSpan }: { label: string; rowSpan: number }) {
  return (
    <td rowSpan={rowSpan} className="sticky left-0 z-20 w-28 min-w-28 border-b border-r border-slate-200 bg-white px-2 align-top">
      <span className="sr-only">{label}</span>
    </td>
  );
}

function MetricRow({
  metric,
  previousMetric,
  firstCell,
  planValue,
  planEditable,
  monthDays,
  draftValue = "",
  saving = false,
  showDeltas,
  deltaMode,
  heatmapEnabled,
  sparklinesEnabled,
  onDraftChange,
  onSave,
}: {
  metric: Metric;
  previousMetric?: Metric;
  firstCell: React.ReactNode;
  planValue: number | null;
  planEditable: boolean;
  monthDays: number;
  draftValue?: string;
  saving?: boolean;
  showDeltas: boolean;
  deltaMode: RnpDeltaMode;
  heatmapEnabled: boolean;
  sparklinesEnabled: boolean;
  onDraftChange?: (value: string) => void;
  onSave?: () => void;
}) {
  const planDay = planValue == null ? null : MONTHLY_FLOW_FIELDS.has(metric.field) ? planValue / monthDays : planValue;
  const progress = planValue != null && planValue !== 0 && metric.forecast != null ? (metric.forecast / planValue) * 100 : null;
  const groupBorder = metric.group_start ? "border-t-2 border-t-slate-300" : "";
  const qualityTone = metric.status === "ready" ? "bg-emerald-500" : metric.status === "partial" ? "bg-amber-500" : "bg-slate-300";
  const qualityReason = metric.qualityReason === "missing_cost" ? "Причина: нет себестоимости"
    : metric.qualityReason === "missing_rates" ? "Причина: нет фактических ставок WB"
      : metric.qualityReason === "stale_source" ? "Причина: источник загружен не полностью или устарел"
        : metric.qualityReason === "api_error" ? "Причина: ошибка источника"
          : metric.qualityReason === "unsupported_source" ? "Причина: источник не отдаёт этот факт для выбранного кабинета"
            : metric.qualityReason === "no_activity" ? "Причина: активности за период нет" : null;
  const metricHelp = [
    metric.source ? `Источник: ${metric.source}` : null,
    metric.coveragePct != null ? `Покрытие: ${metric.coveragePct}%` : null,
    metric.note,
    qualityReason,
    metric.forecastMethod,
  ].filter(Boolean).join(" · ");
  const rowHeight = showDeltas ? "h-[42px]" : "h-[34px]";

  return (
    <tr className="group hover:bg-violet-50/40">
      {firstCell}
      <td className={`sticky left-28 z-10 ${rowHeight} w-[168px] min-w-[168px] border-b border-r border-slate-200 bg-white px-2 font-medium group-hover:bg-violet-50 ${groupBorder}`} title={metricHelp || undefined}>
        <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${qualityTone}`} />{metric.label}</span>
      </td>
      <DataCell metric={metric} value={planDay} muted tall={showDeltas} heatmapEnabled={false} extraClass={groupBorder} />
      <td className={`relative ${rowHeight} w-[78px] min-w-[78px] border-b border-r border-slate-200 bg-[#fbfcfd] px-1 text-right tabular-nums ${groupBorder}`}>
        {planEditable ? (
          <div className="relative">
            <input
              inputMode="decimal"
              value={draftValue}
              onChange={(event) => onDraftChange?.(event.target.value)}
              onBlur={onSave}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              aria-label={`План на месяц: ${metric.label}`}
              className="h-5 w-full rounded border border-amber-200 bg-amber-50 px-1.5 text-right text-[10px] font-medium text-slate-700 outline-none focus:border-violet-400 focus:bg-white"
            />
            {saving && <Loader2 className="absolute left-1 top-1 h-3 w-3 animate-spin text-violet-500" />}
          </div>
        ) : (
          <span title={planValue == null ? undefined : fmt(planValue, metric.kind)} className={planValue == null ? "text-slate-400" : "text-slate-600"}>{denseFmt(planValue, metric.kind)}</span>
        )}
      </td>
      <ForecastCell metric={metric} tall={showDeltas} extraClass={groupBorder} />
      <DataCell metric={{ ...metric, kind: "pct" }} value={progress} muted tall={showDeltas} heatmapEnabled={false} extraClass={groupBorder} />
      <DataCell
        metric={metric}
        value={metric.total}
        previousValue={previousMetric?.total}
        showDelta={showDeltas}
        deltaMode={deltaMode}
        tall={showDeltas}
        heatmapEnabled={heatmapEnabled}
        strong
        extraClass={`border-l-2 border-l-slate-300 ${groupBorder}`}
      />
      {sparklinesEnabled ? <TrendCell metric={metric} extraClass={groupBorder} tall={showDeltas} /> : null}
      {metric.daily.map((value, index) => (
        <DataCell
          key={index}
          metric={metric}
          value={value}
          previousValue={dayOverDayBaseline(metric.daily, previousMetric?.daily, index)}
          showDelta={showDeltas}
          deltaMode={deltaMode}
          tall={showDeltas}
          heatmapEnabled={heatmapEnabled}
          extraClass={groupBorder}
        />
      ))}
    </tr>
  );
}

function ForecastCell({ metric, tall, extraClass = "" }: { metric: Metric; tall: boolean; extraClass?: string }) {
  const hasRange = metric.forecastLow != null && metric.forecastHigh != null && metric.forecast != null;
  const title = [
    metric.forecast != null ? `Прогноз: ${fmt(metric.forecast, metric.kind)}` : null,
    metric.forecastMethod,
    metric.forecastConfidencePct != null ? `Уверенность: ${metric.forecastConfidencePct}%` : null,
    metric.coveragePct != null ? `Покрытие: ${metric.coveragePct}%` : null,
  ].filter(Boolean).join(" · ");
  return (
    <td className={`${tall ? "h-[42px]" : "h-[34px]"} w-[78px] min-w-[78px] border-b border-r border-slate-200 bg-[#fbfcfd] px-1.5 text-right tabular-nums ${toneClass(metric, metric.forecast ?? null)} ${extraClass}`} title={title || undefined}>
      <span className="block whitespace-nowrap font-medium">{denseFmt(metric.forecast, metric.kind)}</span>
      {hasRange && <span className="mt-0.5 block text-[8px] text-slate-400">{compactFmt(metric.forecastLow, metric.kind)}–{compactFmt(metric.forecastHigh, metric.kind)}</span>}
    </td>
  );
}

function TrendCell({ metric, tall, extraClass = "" }: { metric: Metric; tall: boolean; extraClass?: string }) {
  return (
    <td className={`${tall ? "h-[42px]" : "h-[34px]"} w-[72px] min-w-[72px] border-b border-r border-slate-200 bg-white px-1 ${extraClass}`}>
      <Sparkline values={metric.daily} />
    </td>
  );
}

function Sparkline({ values }: { values: Array<number | null> }) {
  const known = values
    .map((value, index) => ({ value, index }))
    .filter((item): item is { value: number; index: number } => item.value != null && Number.isFinite(item.value));
  if (known.length < 2) return <span className="block text-center text-[9px] text-slate-300">—</span>;
  const min = Math.min(...known.map((item) => item.value));
  const max = Math.max(...known.map((item) => item.value));
  const range = max - min || 1;
  const width = 62;
  const height = 24;
  const points = known.map((item) => {
    const x = values.length <= 1 ? width / 2 : (item.index / (values.length - 1)) * width;
    const y = height - 3 - ((item.value - min) / range) * (height - 6);
    return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-6 w-[62px]" role="img" aria-label={`Тренд: минимум ${min}, максимум ${max}`}>
      <polyline points={points} fill="none" stroke="#7c3aed" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={points.split(" ").at(-1)?.split(",")[0]} cy={points.split(" ").at(-1)?.split(",")[1]} r="2" fill="#7c3aed" />
    </svg>
  );
}

function DataCell({
  metric,
  value,
  previousValue,
  showDelta = false,
  deltaMode = "percent",
  tall = false,
  heatmapEnabled,
  muted = false,
  strong = false,
  extraClass = "",
}: {
  metric: Metric;
  value: number | null | undefined;
  previousValue?: number | null;
  showDelta?: boolean;
  deltaMode?: RnpDeltaMode;
  tall?: boolean;
  heatmapEnabled: boolean;
  muted?: boolean;
  strong?: boolean;
  extraClass?: string;
}) {
  const delta = showDelta ? metricDelta(value, previousValue) : null;
  const semanticDirection = delta ? anomalyDirection(metric.field, delta) : null;
  const background = heatmapEnabled
    ? semanticDirection === "positive"
      ? "#ecfdf5"
      : semanticDirection === "negative"
        ? "#fff1f2"
        : cellBackground(metric, value ?? null)
    : undefined;
  const fullValue = value == null || !Number.isFinite(value) ? undefined : fmt(value, metric.kind);
  return (
    <td
      title={[fullValue, delta ? `Изменение: ${delta.absolute}` : null].filter(Boolean).join(" · ") || undefined}
      className={`${tall ? "h-[42px]" : "h-[34px]"} w-[78px] min-w-[78px] whitespace-nowrap border-b border-r border-slate-200 px-1.5 text-right tabular-nums ${
        strong ? "font-semibold" : "font-normal"
      } ${muted && value == null ? "bg-[#fbfcfd] text-slate-400" : toneClass(metric, value ?? null)} ${extraClass}`}
      style={background ? { backgroundColor: background } : undefined}
    >
      <span className="block">{denseFmt(value, metric.kind)}</span>
      {delta ? <DeltaMark delta={delta} kind={metric.kind} mode={deltaMode} field={metric.field} /> : null}
    </td>
  );
}

function DeltaMark({
  delta,
  kind,
  mode,
  field,
}: {
  delta: NonNullable<ReturnType<typeof metricDelta>>;
  kind: string;
  mode: RnpDeltaMode;
  field: string;
}) {
  const semantic = anomalyDirection(field, delta);
  const tone = semantic === "positive" ? "text-emerald-700" : semantic === "negative" ? "text-rose-700" : "text-slate-400";
  if (delta.direction === "flat") return <span className="mt-0.5 block text-[9px] font-medium text-slate-400">→ ровно</span>;
  const arrow = delta.direction === "up" ? "↑" : "↓";
  const sign = delta.absolute > 0 ? "+" : "";
  let label: string;
  if (mode === "percent") {
    label = delta.percent == null ? "новое" : `${delta.percent > 0 ? "+" : ""}${delta.percent}%`;
  } else if (kind === "pct") {
    label = `${sign}${delta.absolute} п.п.`;
  } else {
    label = `${sign}${denseFmt(delta.absolute, kind)}`;
  }
  return <span className={`mt-0.5 block text-[9px] font-bold ${tone}`}>{arrow} {label}</span>;
}
