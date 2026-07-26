"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  Loader2,
  Pencil,
  RefreshCw,
  Store,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CategoryFilter, filterByCategory } from "@/components/ui/CategoryFilter";
import { ActionableError } from "@/components/ui/ActionableError";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { MARKETPLACE_METRICS } from "@/lib/analytics/marketplaceMetrics";
import { heat } from "@/lib/analytics/heat";
import { deploymentPinnedFetch } from "@/lib/http/deploymentPinnedFetch";
import { readApiResponse, readOkApiResponse } from "@/lib/http/readApiResponse";
import { buildRnpArticleCompare } from "@/lib/rnp/articleCompare";
import { buildRnpFocusSummary, type RnpFocusSignal } from "@/lib/rnp/focusSummary";
import { useCategoryMap } from "@/lib/useCategoryMap";
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
  qualityReason?: "no_activity" | "missing_cost" | "missing_rates" | "stale_source" | "api_error";
  group_start?: boolean;
}

interface Sku {
  nm: number;
  art: string;
  name: string;
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
  preset: "today" | "yesterday" | "week" | "month" | "previous" | "custom";
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

const METRIC_ORDER = [
  "views",
  "clicks",
  "ctr",
  "open_card",
  "cart",
  "orders_sum",
  "orders_count",
  "buyouts_sum",
  "buyouts_count",
  "buyout_pct",
  "gross",
  "margin_pct",
  "ad_spent",
  "drr",
  "stock",
  "turnover",
  "money",
  "gmroi",
];

const METRIC_FALLBACKS: Record<string, { label: string; kind: string }> = {
  views: { label: "Рекламные показы", kind: "int" },
  clicks: { label: "Рекламные клики", kind: "int" },
  ctr: { label: `Рекламный ${MARKETPLACE_METRICS.ctr.label}, %`, kind: "pct" },
  open_card: { label: "Переходы в карточку", kind: "int" },
  cart: { label: "Корзины", kind: "int" },
  orders_sum: { label: "Заказы, ₽", kind: "money" },
  orders_count: { label: "Заказы, шт", kind: "int" },
  buyouts_sum: { label: "Продажи, ₽", kind: "money" },
  buyouts_count: { label: "Продажи, шт", kind: "int" },
  buyout_pct: { label: "Выкуп потока, %", kind: "pct" },
  gross: { label: "Прибыль после расходов МП, ₽", kind: "money" },
  margin_pct: { label: `${MARKETPLACE_METRICS.marginAfterMarketplace.label}, %`, kind: "pct" },
  ad_spent: { label: "Рекл. расход, ₽", kind: "money" },
  drr: { label: `${MARKETPLACE_METRICS.drrOrders.label}, %`, kind: "pct" },
  stock: { label: "Остаток, шт", kind: "int" },
  turnover: { label: "Оборачиваемость, дней", kind: "int" },
  money: { label: "Деньги в остатках, ₽", kind: "money" },
  gmroi: { label: "GMROI, %", kind: "pct" },
};

const METRIC_ROW_HEIGHT = 34;
const SKU_BLOCK_HEIGHT = METRIC_ORDER.length * METRIC_ROW_HEIGHT;
const TABLE_PREFIX_HEIGHT = 38 + 34 + METRIC_ORDER.length * METRIC_ROW_HEIGHT + 34;
const MOBILE_PAGE_SIZE = 20;
const MONTHLY_FLOW_FIELDS = new Set([
  "views",
  "clicks",
  "open_card",
  "cart",
  "orders_sum",
  "orders_count",
  "buyouts_sum",
  "buyouts_count",
  "gross",
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
  { value: "today", label: "Сегодня" },
  { value: "yesterday", label: "Вчера" },
  { value: "week", label: "Неделя" },
  { value: "month", label: "Этот месяц" },
  { value: "previous", label: "Прошлый месяц" },
] as const;

const RNP_FILTER_PRESETS_STORAGE_KEY = "finance-panel:wb-rnp-filter-presets:v1";
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
  } else if (preset === "month") {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 0);
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
    rangePreset: ["today", "yesterday", "week", "month", "previous", "custom"].includes(String(value.rangePreset))
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

function formatChartValue(value: number | null | undefined, kind: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (kind === "money") return `${compactFmt(value, kind)} ₽`;
  return compactFmt(value, kind);
}

function findMetric(metrics: Metric[], field: string) {
  return metrics.find((metric) => metric.field === field);
}

function completeMetrics(metrics: Metric[], periodLength: number) {
  return METRIC_ORDER.map((field) => {
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
      qualityReason: ["gross", "margin_pct", "money", "gmroi"].includes(field) ? "missing_cost" : "no_activity",
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
  const { cabinets, cabinetId, activeCabinet, ready, loading: cabinetsLoading, error: cabinetsError, canWrite, setCabinetId } = useWbCabinet();
  const [range, setRange] = useState<DateRange>(() => rangeFor("month"));
  const [data, setData] = useState<RnpTable | null>(null);
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
  const tableViewportRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const dataKeyRef = useRef<string | null>(null);
  const elapsed = useElapsedSeconds(loading);
  const { categories, byArticle } = useCategoryMap();
  const [category, setCategory] = useState("");
  const month = range.from.slice(0, 7);
  const currentDataKey = `${cabinetId || "all"}:${range.from}:${range.to}`;
  const activeData = dataKey === currentDataKey ? data : null;

  useEffect(() => {
    setUserFilterPresets(readUserFilterPresets());
  }, []);

  useEffect(() => {
    setPlanning(false);
    setPlan({});
    setDrafts({});
    setPlanMessage(null);
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

    const requestKey = `${cabinetId || "all"}:${range.from}:${range.to}`;
    if (dataKeyRef.current !== requestKey) {
      dataKeyRef.current = null;
      setDataKey(null);
      setData(null);
    }
    const controller = new AbortController();
    const currentRequest = ++requestId.current;
    let timedOut = false;
    const deadline = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 65_000);

    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ date_from: range.from, date_to: range.to });
    deploymentPinnedFetch(`/api/rnp/${encodeURIComponent(cabinetId || "all")}/table?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        return readOkApiResponse<RnpTable>(response, "РНП");
      })
      .then((body) => {
        if (currentRequest !== requestId.current) return;
        if (body.error) throw new Error(body.error);
        setData(body);
        dataKeyRef.current = requestKey;
        setDataKey(requestKey);
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
      controller.abort();
    };
  }, [activeCabinet, cabinetId, cabinets.length, cabinetsError, cabinetsLoading, range.from, range.to, ready, retryKey]);

  useEffect(() => {
    if (!canWrite) {
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
  }, [cabinetId, canWrite, month]);

  const filteredSkus = useMemo(
    () => filterByCategory(activeData?.skus ?? [], (sku) => sku.art, byArticle, category),
    [activeData?.skus, byArticle, category],
  );

  const sortedSkus = useMemo(() => {
    return [...filteredSkus].sort((left, right) => {
      const leftValue = findMetric(left.metrics, sortField)?.total;
      const rightValue = findMetric(right.metrics, sortField)?.total;
      if (leftValue == null && rightValue == null) return 0;
      if (leftValue == null) return 1;
      if (rightValue == null) return -1;
      return sortDirection * (leftValue - rightValue);
    });
  }, [filteredSkus, sortDirection, sortField]);

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
  }, [tableSkus]);

  const visibleSkus = tableSkus.slice(skuWindow.start, skuWindow.end);
  const mobileSkus = tableSkus.slice(0, mobileLimit);
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
    () => SYSTEM_FILTER_PRESETS.filter((preset) => !preset.categoryKeywords?.length || Boolean(matchingPresetCategory(preset, categories))),
    [categories],
  );
  const allFilterPresets = useMemo(
    () => [...visibleSystemPresets, ...userFilterPresets],
    [userFilterPresets, visibleSystemPresets],
  );

  const updateSkuWindow = (element: HTMLDivElement) => {
    const offset = Math.max(0, element.scrollTop - TABLE_PREFIX_HEIGHT);
    const firstVisible = Math.floor(offset / SKU_BLOCK_HEIGHT);
    const visibleBlocks = Math.ceil(element.clientHeight / SKU_BLOCK_HEIGHT);
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
    setCategory(matchingPresetCategory(preset, categories));
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

  const totalColumns = 7 + (activeData?.period.length ?? 0);

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] px-3 pb-20 pt-3 md:px-6 md:pb-6 md:pt-4">
      <section className="mb-2.5 flex flex-wrap items-center gap-2" aria-label="Период РНП">
        <div className="mr-1 flex h-8 items-center gap-1.5 text-sm font-semibold text-slate-700">
          <BarChart3Icon />
          РНП
        </div>

        <label className="relative">
          <span className="sr-only">Дата начала</span>
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(event) => setRange((current) => ({ ...current, from: event.target.value, preset: "custom" }))}
            className="h-8 w-[142px] rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          />
        </label>
        <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
        <label className="relative">
          <span className="sr-only">Дата окончания</span>
          <input
            type="date"
            value={range.to}
            min={range.from}
            onChange={(event) => setRange((current) => ({ ...current, to: event.target.value, preset: "custom" }))}
            className="h-8 w-[142px] rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] text-slate-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          />
        </label>

        <div className="flex flex-wrap items-center gap-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => applyPreset(preset.value)}
              className={`h-8 rounded-lg border px-2.5 text-[11px] font-medium transition ${
                range.preset === preset.value
                  ? "border-violet-200 bg-violet-50 text-violet-700"
                  : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-600">
          <Store className="h-3.5 w-3.5 text-violet-600" />
          {activeData?.shop_label || activeCabinet?.name || "Все кабинеты"}
        </span>

        <button
          type="button"
          disabled={!canWrite}
          onClick={() => setPlanning((value) => !value)}
          title={!canWrite ? "Для планирования выберите один кабинет" : "Редактировать месячный план"}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
            planning ? "border-violet-600 bg-violet-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:border-violet-200 hover:text-violet-700"
          }`}
        >
          <Pencil className="h-3.5 w-3.5" /> Режим планирования
        </button>
      </section>

      <section className="mb-2.5 flex flex-wrap items-center justify-between gap-2" aria-label="Сортировка и фильтры РНП">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CategoryFilter categories={categories} value={category} onChange={setCategory} />
          {activeData && (
            <span className="text-[10px] text-slate-400">
              {sortedSkus.length} из {activeData.sku_count} SKU · {activeData.period.length} дн.
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setSortDirection((direction) => (direction === -1 ? 1 : -1))}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[10px] text-slate-500 hover:text-violet-700"
          >
            Сорт {sortDirection === -1 ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
          </button>
          {SORTS.map((sort) => (
            <button
              key={sort.field}
              type="button"
              onClick={() => setSortField(sort.field)}
              className={`h-7 rounded-md border px-2.5 text-[10px] font-medium transition ${
                sortField === sort.field
                  ? "border-violet-200 bg-violet-50 text-violet-700"
                  : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
              }`}
            >
              {sort.label}
            </button>
          ))}
        </div>
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

      {activeData && planOverview && (
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

      {activeData && articleCompare && articleCompareCatalog && (
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
          <div
            ref={tableViewportRef}
            onScroll={(event) => updateSkuWindow(event.currentTarget)}
            className="hidden max-h-[calc(100vh-188px)] overflow-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] md:block"
          >
            <table className="min-w-max border-separate border-spacing-0 text-[10px] leading-[1.15] text-slate-600">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-40 h-[38px] w-28 min-w-28 border-b border-r border-slate-200 bg-[#fafbfc] px-2 text-left font-semibold text-slate-500">Товар</th>
                  <th className="sticky left-28 top-0 z-40 h-[38px] w-[168px] min-w-[168px] border-b border-r border-slate-200 bg-[#fafbfc] px-2 text-left font-semibold text-slate-500">Метрика \\ Дата</th>
                  <PlanHeader>План день</PlanHeader>
                  <PlanHeader>План мес.</PlanHeader>
                  <PlanHeader>Прогноз мес.<span className="mt-0.5 block text-[8px] font-normal text-slate-400">диапазон</span></PlanHeader>
                  <PlanHeader>% плана</PlanHeader>
                  <PlanHeader strong>Факт мес.</PlanHeader>
                  {activeData.period.map((day, index) => (
                    <th key={`${day.label}-${index}`} className="sticky top-0 z-30 h-[38px] w-[78px] min-w-[78px] border-b border-r border-slate-200 bg-[#fafbfc] px-1.5 text-center font-medium text-slate-500">
                      <span className="block">{day.label}</span>
                      <span className="mt-0.5 block text-[9px] font-normal text-slate-400">{day.period_type}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <SectionRow columns={totalColumns} icon="chart" label="СВОДКА ПО МАГАЗИНУ" />
                {completeMetrics(activeData.summary, activeData.period.length).map((metric, index, metrics) => (
                  <MetricRow
                    key={`summary-${metric.field}`}
                    metric={metric}
                    planValue={aggregatePlanValue(plan, activeData.skus, metric.field, monthDayCount)}
                    planEditable={false}
                    monthDays={monthDayCount}
                    firstCell={index === 0 ? <SummaryCell label={activeData.shop_label} rowSpan={metrics.length} /> : null}
                  />
                ))}
                <SectionRow columns={totalColumns} icon="box" label={focusedNm == null ? `ТОВАРЫ (${sortedSkus.length})` : `ТОВАРЫ (1 из ${sortedSkus.length})`} />
                {skuWindow.start > 0 && <SpacerRow columns={totalColumns} height={skuWindow.start * SKU_BLOCK_HEIGHT} />}
                {visibleSkus.map((sku) => {
                  const metrics = completeMetrics(sku.metrics, activeData.period.length);
                  return metrics.map((metric, index) => {
                    const key = `${sku.nm}:${metric.field}`;
                    const savedPlan = plan[String(sku.nm)]?.[metric.field] ?? null;
                    const displayedDraft = drafts[key] ?? (savedPlan == null ? "" : String(savedPlan));
                    return (
                      <MetricRow
                        key={`${sku.nm}-${metric.field}`}
                        metric={metric}
                        planValue={savedPlan}
                        planEditable={planning && canWrite}
                        monthDays={monthDayCount}
                        firstCell={index === 0 ? <ProductCell sku={sku} rowSpan={metrics.length} /> : null}
                        draftValue={displayedDraft}
                        saving={saving === key}
                        onDraftChange={(value) => setDrafts((current) => ({ ...current, [key]: value }))}
                        onSave={() => savePlan(sku, metric)}
                      />
                    );
                  });
                })}
                {skuWindow.end < tableSkus.length && <SpacerRow columns={totalColumns} height={(tableSkus.length - skuWindow.end) * SKU_BLOCK_HEIGHT} />}
              </tbody>
            </table>
          </div>

          <div className="space-y-2.5 md:hidden">
            <p className="rounded-lg bg-violet-50 px-3 py-2 text-[10px] text-violet-700">
              Сначала показаны {Math.min(mobileLimit, tableSkus.length)} SKU по сортировке «{SORTS.find((sort) => sort.field === sortField)?.label}».
            </p>
            {mobileSkus.map((sku) => {
              const selected = SORTS.map((sort) => findMetric(sku.metrics, sort.field)).filter((metric): metric is Metric => Boolean(metric));
              const orders = findMetric(sku.metrics, "orders_sum");
              const skuPlan = plan[String(sku.nm)]?.orders_sum ?? null;
              return (
                <article key={sku.nm} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <WbProductImage nm={sku.nm} src={sku.img_url} className="h-12 w-12 rounded-lg bg-slate-100 object-cover" />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-xs font-semibold text-violet-700">{sku.art}</h2>
                      <p className="mt-0.5 truncate text-[10px] text-slate-400">{sku.name}</p>
                      <p className="mt-1 text-[9px] text-slate-400">WB {sku.nm}</p>
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-50 p-1.5">
                    <div className="rounded-md bg-white px-2 py-1.5"><dt className="text-[8px] text-slate-400">План</dt><dd className="mt-0.5 truncate text-[10px] font-semibold text-slate-700">{compactFmt(skuPlan, "money")}</dd></div>
                    <div className="rounded-md bg-white px-2 py-1.5"><dt className="text-[8px] text-slate-400">Факт</dt><dd className="mt-0.5 truncate text-[10px] font-semibold text-slate-700">{compactFmt(orders?.total, "money")}</dd></div>
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

function BarChart3Icon() {
  return (
    <span className="grid h-7 w-7 place-items-center rounded-lg bg-violet-50 text-violet-700">
      <span className="flex h-4 items-end gap-[2px]">
        <span className="h-2 w-[3px] rounded-sm bg-current" />
        <span className="h-4 w-[3px] rounded-sm bg-current" />
        <span className="h-3 w-[3px] rounded-sm bg-current" />
      </span>
    </span>
  );
}

function PlanHeader({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <th className={`sticky top-0 z-30 h-[38px] w-[78px] min-w-[78px] border-b border-r border-slate-200 bg-[#fafbfc] px-1.5 text-right font-semibold text-slate-500 ${strong ? "border-l-2 border-l-slate-300 text-slate-700" : ""}`}>
      {children}
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

function ProductCell({ sku, rowSpan }: { sku: Sku; rowSpan: number }) {
  return (
    <td rowSpan={rowSpan} className="sticky left-0 z-20 w-28 min-w-28 border-b border-r border-slate-200 bg-white p-2 align-top">
      <div className="space-y-1">
        <WbProductImage nm={sku.nm} src={sku.img_url} className="h-[74px] w-[74px] rounded-md bg-slate-100 object-cover" />
        <div className="truncate text-[10px] font-semibold text-violet-700" title={sku.art}>{sku.art}</div>
        <div className="text-[9px] text-slate-400">{sku.nm}</div>
        <div className="line-clamp-2 text-[9px] leading-3 text-slate-500">{sku.name}</div>
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
  firstCell,
  planValue,
  planEditable,
  monthDays,
  draftValue = "",
  saving = false,
  onDraftChange,
  onSave,
}: {
  metric: Metric;
  firstCell: React.ReactNode;
  planValue: number | null;
  planEditable: boolean;
  monthDays: number;
  draftValue?: string;
  saving?: boolean;
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
          : metric.qualityReason === "no_activity" ? "Причина: активности за период нет" : null;
  const metricHelp = [
    metric.source ? `Источник: ${metric.source}` : null,
    metric.coveragePct != null ? `Покрытие: ${metric.coveragePct}%` : null,
    metric.note,
    qualityReason,
    metric.forecastMethod,
  ].filter(Boolean).join(" · ");

  return (
    <tr className="group hover:bg-violet-50/40">
      {firstCell}
      <td className={`sticky left-28 z-10 h-[34px] w-[168px] min-w-[168px] border-b border-r border-slate-200 bg-white px-2 font-medium group-hover:bg-violet-50 ${groupBorder}`} title={metricHelp || undefined}>
        <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${qualityTone}`} />{metric.label}</span>
      </td>
      <DataCell metric={metric} value={planDay} muted extraClass={groupBorder} />
      <td className={`relative h-[34px] w-[78px] min-w-[78px] border-b border-r border-slate-200 bg-[#fbfcfd] px-1 text-right tabular-nums ${groupBorder}`}>
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
      <ForecastCell metric={metric} extraClass={groupBorder} />
      <DataCell metric={{ ...metric, kind: "pct" }} value={progress} muted extraClass={groupBorder} />
      <DataCell metric={metric} value={metric.total} strong extraClass={`border-l-2 border-l-slate-300 ${groupBorder}`} />
      {metric.daily.map((value, index) => (
        <DataCell key={index} metric={metric} value={value} extraClass={groupBorder} />
      ))}
    </tr>
  );
}

function ForecastCell({ metric, extraClass = "" }: { metric: Metric; extraClass?: string }) {
  const hasRange = metric.forecastLow != null && metric.forecastHigh != null && metric.forecast != null;
  const title = [
    metric.forecast != null ? `Прогноз: ${fmt(metric.forecast, metric.kind)}` : null,
    metric.forecastMethod,
    metric.forecastConfidencePct != null ? `Уверенность: ${metric.forecastConfidencePct}%` : null,
    metric.coveragePct != null ? `Покрытие: ${metric.coveragePct}%` : null,
  ].filter(Boolean).join(" · ");
  return (
    <td className={`h-[34px] w-[78px] min-w-[78px] border-b border-r border-slate-200 bg-[#fbfcfd] px-1.5 text-right tabular-nums ${toneClass(metric, metric.forecast ?? null)} ${extraClass}`} title={title || undefined}>
      <span className="block whitespace-nowrap font-medium">{denseFmt(metric.forecast, metric.kind)}</span>
      {hasRange && <span className="mt-0.5 block text-[8px] text-slate-400">{compactFmt(metric.forecastLow, metric.kind)}–{compactFmt(metric.forecastHigh, metric.kind)}</span>}
    </td>
  );
}

function DataCell({
  metric,
  value,
  muted = false,
  strong = false,
  extraClass = "",
}: {
  metric: Metric;
  value: number | null | undefined;
  muted?: boolean;
  strong?: boolean;
  extraClass?: string;
}) {
  const background = cellBackground(metric, value ?? null);
  const fullValue = value == null || !Number.isFinite(value) ? undefined : fmt(value, metric.kind);
  return (
    <td
      title={fullValue}
      className={`h-[34px] w-[78px] min-w-[78px] whitespace-nowrap border-b border-r border-slate-200 px-1.5 text-right tabular-nums ${
        strong ? "font-semibold" : "font-normal"
      } ${muted && value == null ? "bg-[#fbfcfd] text-slate-400" : toneClass(metric, value ?? null)} ${extraClass}`}
      style={background ? { backgroundColor: background } : undefined}
    >
      {denseFmt(value, metric.kind)}
    </td>
  );
}
