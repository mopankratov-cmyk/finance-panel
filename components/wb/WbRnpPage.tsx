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
import { CategoryFilter, filterByCategory } from "@/components/ui/CategoryFilter";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { heat } from "@/lib/analytics/heat";
import { useCategoryMap } from "@/lib/useCategoryMap";
import { useWbCabinet } from "./WbCabinetContext";

interface Metric {
  field: string;
  label: string;
  kind: string;
  daily: (number | null)[];
  total: number;
  forecast: number | null;
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

const METRIC_ORDER = [
  "views",
  "clicks",
  "ctr",
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
  views: { label: "Показы", kind: "int" },
  clicks: { label: "Клики", kind: "int" },
  ctr: { label: "CTR, %", kind: "pct" },
  cart: { label: "Корзины", kind: "int" },
  orders_sum: { label: "Заказы, ₽", kind: "money" },
  orders_count: { label: "Заказы, шт", kind: "int" },
  buyouts_sum: { label: "Продажи, ₽", kind: "money" },
  buyouts_count: { label: "Продажи, шт", kind: "int" },
  buyout_pct: { label: "Выкуп, %", kind: "pct" },
  gross: { label: "Маржа до ДРР, ₽", kind: "money" },
  margin_pct: { label: "Маржа до ДРР, %", kind: "pct" },
  ad_spent: { label: "Рекл. расход, ₽", kind: "money" },
  drr: { label: "ДРР, %", kind: "pct" },
  stock: { label: "Остаток, шт", kind: "int" },
  turnover: { label: "Оборачиваемость, дней", kind: "int" },
  money: { label: "Деньги в остатках, ₽", kind: "money" },
  gmroi: { label: "GMROI, %", kind: "pct" },
};

const METRIC_ROW_HEIGHT = 27;
const SKU_BLOCK_HEIGHT = METRIC_ORDER.length * METRIC_ROW_HEIGHT;
const TABLE_PREFIX_HEIGHT = 38 + 34 + METRIC_ORDER.length * METRIC_ROW_HEIGHT + 34;

const SORTS = [
  { field: "stock", label: "Остаток" },
  { field: "orders_sum", label: "Заказы" },
  { field: "turnover", label: "Оборач" },
  { field: "gmroi", label: "GMROI" },
  { field: "drr", label: "ДРР" },
  { field: "money", label: "Деньги в остатках" },
] as const;

const PRESETS = [
  { value: "today", label: "Сегодня" },
  { value: "yesterday", label: "Вчера" },
  { value: "week", label: "Неделя" },
  { value: "month", label: "Этот месяц" },
  { value: "previous", label: "Прошлый месяц" },
] as const;

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

function fmt(value: number | null | undefined, kind: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (kind === "pct") return `${Math.round(value * 10) / 10}%`;
  if (kind === "money") return `${Math.round(value).toLocaleString("ru-RU")} ₽`;
  return Math.round(value).toLocaleString("ru-RU");
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
    } satisfies Metric;
  });
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
  const { cabinets, cabinetId, activeCabinet, ready, loading: cabinetsLoading, error: cabinetsError, canWrite } = useWbCabinet();
  const [range, setRange] = useState<DateRange>(() => rangeFor("month"));
  const [data, setData] = useState<RnpTable | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [sortField, setSortField] = useState("orders_sum");
  const [sortDirection, setSortDirection] = useState<1 | -1>(-1);
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<Record<string, Record<string, number>>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [planMessage, setPlanMessage] = useState<string | null>(null);
  const [skuWindow, setSkuWindow] = useState({ start: 0, end: 4 });
  const tableViewportRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const elapsed = useElapsedSeconds(loading);
  const { categories, byArticle } = useCategoryMap();
  const [category, setCategory] = useState("");
  const month = range.from.slice(0, 7);

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
      setError(cabinetsError || "Подключите хотя бы один активный WB-кабинет в настройках");
      return;
    }
    if (!activeCabinet && cabinetId !== "all") {
      setLoading(false);
      setData(null);
      setError(cabinetsError || "Нет доступного WB-кабинета");
      return;
    }

    const controller = new AbortController();
    const currentRequest = ++requestId.current;
    let timedOut = false;
    const deadline = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 65_000);

    setLoading(true);
    setData(null);
    setError(null);

    const params = new URLSearchParams({ date_from: range.from, date_to: range.to });
    fetch(`/api/rnp/${encodeURIComponent(cabinetId || "all")}/table?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as RnpTable;
        if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then((body) => {
        if (currentRequest !== requestId.current) return;
        if (body.error) throw new Error(body.error);
        setData(body);
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
    if (!planning || !canWrite) return;
    const controller = new AbortController();
    setPlanMessage(null);
    fetch(`/api/rnp/${encodeURIComponent(cabinetId)}/plan?month=${encodeURIComponent(month)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as { plan?: Record<string, Record<string, number>>; error?: string };
        if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        setPlan(body.plan ?? {});
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setPlanMessage(cause instanceof Error ? cause.message : "Не удалось загрузить план");
      });
    return () => controller.abort();
  }, [cabinetId, canWrite, month, planning]);

  const filteredSkus = useMemo(
    () => filterByCategory(data?.skus ?? [], (sku) => sku.art, byArticle, category),
    [byArticle, category, data?.skus],
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

  useEffect(() => {
    setSkuWindow({ start: 0, end: Math.min(4, sortedSkus.length) });
    if (tableViewportRef.current) tableViewportRef.current.scrollTop = 0;
  }, [sortedSkus]);

  const visibleSkus = sortedSkus.slice(skuWindow.start, skuWindow.end);

  const updateSkuWindow = (element: HTMLDivElement) => {
    const offset = Math.max(0, element.scrollTop - TABLE_PREFIX_HEIGHT);
    const firstVisible = Math.floor(offset / SKU_BLOCK_HEIGHT);
    const visibleBlocks = Math.ceil(element.clientHeight / SKU_BLOCK_HEIGHT);
    const start = Math.max(0, firstVisible - 1);
    const end = Math.min(sortedSkus.length, firstVisible + visibleBlocks + 2);
    setSkuWindow((current) => (current.start === start && current.end === end ? current : { start, end }));
  };

  const applyPreset = (preset: DateRange["preset"]) => setRange(rangeFor(preset));

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
    const response = await fetch(`/api/rnp/${encodeURIComponent(cabinetId)}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, nm: String(sku.nm), field: metric.field, value }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
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

  const totalColumns = 7 + (data?.period.length ?? 0);

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
          {data?.shop_label || activeCabinet?.name || "Все кабинеты"}
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
          {data && (
            <span className="text-[10px] text-slate-400">
              {sortedSkus.length} из {data.sku_count} SKU · {data.period.length} дн.
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

      {planMessage && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {planMessage}
        </div>
      )}

      {loading ? (
        <>
          <LoadingBanner seconds={elapsed} hint="РНП по SKU" />
          <SkeletonTableRows rows={12} cols={11} />
        </>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-white p-6 text-center shadow-sm">
          <AlertTriangle className="mx-auto h-7 w-7 text-rose-500" />
          <h2 className="mt-2 text-sm font-semibold text-slate-800">Не удалось загрузить РНП</h2>
          <p className="mx-auto mt-1 max-w-xl text-xs leading-5 text-slate-500">{error}</p>
          <button
            type="button"
            onClick={() => setRetryKey((key) => key + 1)}
            className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-700"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Повторить
          </button>
        </div>
      ) : data && data.skus.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <CalendarDays className="mx-auto h-7 w-7 text-slate-300" />
          <h2 className="mt-2 text-sm font-semibold text-slate-700">Нет данных за выбранный период</h2>
          <p className="mt-1 text-xs text-slate-400">Измените даты или проверьте синхронизацию кабинета.</p>
        </div>
      ) : data ? (
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
                  <PlanHeader>Прогноз мес.</PlanHeader>
                  <PlanHeader>% плана</PlanHeader>
                  <PlanHeader strong>Факт мес.</PlanHeader>
                  {data.period.map((day, index) => (
                    <th key={`${day.label}-${index}`} className="sticky top-0 z-30 h-[38px] w-[82px] min-w-[82px] border-b border-r border-slate-200 bg-[#fafbfc] px-2 text-center font-medium text-slate-500">
                      <span className="block">{day.label}</span>
                      <span className="mt-0.5 block text-[9px] font-normal text-slate-400">{day.period_type}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <SectionRow columns={totalColumns} icon="chart" label="СВОДКА ПО МАГАЗИНУ" />
                {completeMetrics(data.summary, data.period.length).map((metric, index, metrics) => (
                  <MetricRow
                    key={`summary-${metric.field}`}
                    metric={metric}
                    planValue={null}
                    planEditable={false}
                    monthDays={daysInMonth(month)}
                    firstCell={index === 0 ? <SummaryCell label={data.shop_label} rowSpan={metrics.length} /> : null}
                  />
                ))}
                <SectionRow columns={totalColumns} icon="box" label={`ТОВАРЫ (${sortedSkus.length})`} />
                {skuWindow.start > 0 && <SpacerRow columns={totalColumns} height={skuWindow.start * SKU_BLOCK_HEIGHT} />}
                {visibleSkus.map((sku) => {
                  const metrics = completeMetrics(sku.metrics, data.period.length);
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
                        monthDays={daysInMonth(month)}
                        firstCell={index === 0 ? <ProductCell sku={sku} rowSpan={metrics.length} /> : null}
                        draftValue={displayedDraft}
                        saving={saving === key}
                        onDraftChange={(value) => setDrafts((current) => ({ ...current, [key]: value }))}
                        onSave={() => savePlan(sku, metric)}
                      />
                    );
                  });
                })}
                {skuWindow.end < sortedSkus.length && <SpacerRow columns={totalColumns} height={(sortedSkus.length - skuWindow.end) * SKU_BLOCK_HEIGHT} />}
              </tbody>
            </table>
          </div>

          <div className="space-y-2.5 md:hidden">
            {sortedSkus.map((sku) => {
              const selected = SORTS.map((sort) => findMetric(sku.metrics, sort.field)).filter((metric): metric is Metric => Boolean(metric));
              return (
                <article key={sku.nm} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-center gap-2.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={sku.img_url} alt="" className="h-12 w-12 rounded-lg bg-slate-100 object-cover" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-xs font-semibold text-violet-700">{sku.art}</h2>
                      <p className="mt-0.5 truncate text-[10px] text-slate-400">{sku.name}</p>
                      <p className="mt-1 text-[9px] text-slate-400">WB {sku.nm}</p>
                    </div>
                  </div>
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
          </div>
        </>
      ) : null}
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
    <th className={`sticky top-0 z-30 h-[38px] w-[82px] min-w-[82px] border-b border-r border-slate-200 bg-[#fafbfc] px-2 text-right font-semibold text-slate-500 ${strong ? "border-l-2 border-l-slate-300 text-slate-700" : ""}`}>
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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={sku.img_url} alt="" loading="lazy" className="h-[74px] w-[74px] rounded-md bg-slate-100 object-cover" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
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
  const planDay = planValue == null ? null : planValue / monthDays;
  const progress = planValue && metric.forecast != null ? (metric.forecast / planValue) * 100 : null;
  const groupBorder = metric.group_start ? "border-t-2 border-t-slate-300" : "";

  return (
    <tr className="group hover:bg-violet-50/40">
      {firstCell}
      <td className={`sticky left-28 z-10 h-[27px] w-[168px] min-w-[168px] border-b border-r border-slate-200 bg-white px-2 font-medium group-hover:bg-violet-50 ${groupBorder}`}>
        {metric.label}
      </td>
      <DataCell metric={metric} value={planDay} muted extraClass={groupBorder} />
      <td className={`relative h-[27px] w-[82px] min-w-[82px] border-b border-r border-slate-200 bg-[#fbfcfd] px-1 text-right tabular-nums ${groupBorder}`}>
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
          <span className={planValue == null ? "text-slate-400" : "text-slate-600"}>{fmt(planValue, metric.kind)}</span>
        )}
      </td>
      <DataCell metric={metric} value={metric.forecast} muted extraClass={groupBorder} />
      <DataCell metric={{ ...metric, kind: "pct" }} value={progress} muted extraClass={groupBorder} />
      <DataCell metric={metric} value={metric.total} strong extraClass={`border-l-2 border-l-slate-300 ${groupBorder}`} />
      {metric.daily.map((value, index) => (
        <DataCell key={index} metric={metric} value={value} extraClass={groupBorder} />
      ))}
    </tr>
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
  return (
    <td
      className={`h-[27px] w-[82px] min-w-[82px] border-b border-r border-slate-200 px-2 text-right tabular-nums ${
        strong ? "font-semibold" : "font-normal"
      } ${muted && value == null ? "bg-[#fbfcfd] text-slate-400" : toneClass(metric, value ?? null)} ${extraClass}`}
      style={background ? { backgroundColor: background } : undefined}
    >
      {fmt(value, metric.kind)}
    </td>
  );
}
