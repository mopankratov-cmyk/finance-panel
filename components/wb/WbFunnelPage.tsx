"use client";

import { Filter, Package, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { MARKETPLACE_METRICS, METRIC_CELL_TONE, marketplaceMetricStatus, type MarketplaceMetricId } from "@/lib/analytics/marketplaceMetrics";
import { useDashboardFilter } from "@/lib/useDashboardFilter";
import { closedMoscowDates } from "@/lib/wb/sklejki";
import { WbProductImage } from "./WbProductImage";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

interface FunnelSku {
  nm: number;
  art: string;
  name: string;
  img_url: string;
  shows_window: number;
  clicks_window: number;
  ctr_window: number | null;
  open_card_window: number;
  cart_window: number;
  cv_cart_window: number | null;
  cv_order_window: number | null;
  orders_count_window: number;
  orders_sum_window: number;
  drr_window: number | null;
  stock: number;
}

interface SkusData { skus: FunnelSku[]; metrics_period: string; error?: string }
type DayCell = Record<string, number | null>;
interface DayMetricsData { metrics: Record<string, Record<string, DayCell>>; error?: string }
type MetricKey = "views" | "ctr" | "open_card" | "carts" | "cart_cr" | "cr" | "orders_sum" | "advert_sum" | "drr";

const METRICS: Array<{ key: MetricKey; label: string; kind: "int" | "money" | "pct"; definition: string; metricId?: MarketplaceMetricId }> = [
  { key: "views", label: MARKETPLACE_METRICS.views.label, kind: "int", definition: MARKETPLACE_METRICS.views.definition, metricId: "views" },
  { key: "ctr", label: MARKETPLACE_METRICS.ctr.label, kind: "pct", definition: MARKETPLACE_METRICS.ctr.definition, metricId: "ctr" },
  { key: "open_card", label: "Переходы в карточку", kind: "int", definition: "Товарные переходы в карточку из воронки WB, отдельно от рекламных показов." },
  { key: "carts", label: "Корзины", kind: "int", definition: "Добавления товара в корзину за выбранный период." },
  { key: "cart_cr", label: MARKETPLACE_METRICS.cardToCartCr.label, kind: "pct", definition: MARKETPLACE_METRICS.cardToCartCr.definition, metricId: "cardToCartCr" },
  { key: "cr", label: MARKETPLACE_METRICS.cartToOrderCr.label, kind: "pct", definition: MARKETPLACE_METRICS.cartToOrderCr.definition, metricId: "cartToOrderCr" },
  { key: "orders_sum", label: MARKETPLACE_METRICS.ordersRevenue.label, kind: "money", definition: MARKETPLACE_METRICS.ordersRevenue.definition, metricId: "ordersRevenue" },
  { key: "advert_sum", label: MARKETPLACE_METRICS.adSpend.label, kind: "money", definition: MARKETPLACE_METRICS.adSpend.definition, metricId: "adSpend" },
  { key: "drr", label: MARKETPLACE_METRICS.drrOrders.label, kind: "pct", definition: MARKETPLACE_METRICS.drrOrders.definition, metricId: "drrOrders" },
];

const ROW_HEIGHT = 49;
const fmt = (value: number | null | undefined) => value == null ? "—" : Math.round(value).toLocaleString("ru-RU");
const pct = (value: number | null | undefined) => value == null ? "—" : `${Math.round(value * 10) / 10}%`;
const dayLabel = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

function cellTone(metric: MetricKey, value: number | null | undefined) {
  const metricId = METRICS.find((item) => item.key === metric)?.metricId;
  return METRIC_CELL_TONE[metricId ? marketplaceMetricStatus(metricId, value) : value == null ? "unknown" : "neutral"];
}

export function WbFunnelPage({ embedded = false }: { embedded?: boolean }) {
  const { cabinetId, activeCabinet, cabinets, ready, loading: cabinetsLoading, error: cabinetsError } = useWbCabinet();
  const [windowParam, setWindowParam] = useDashboardFilter("days", "7", ["1", "7", "30"] as const);
  const windowDays = Number(windowParam);
  const setWindowDays = (days: number) => setWindowParam(String(days) as typeof windowParam);
  const [metric, setMetric] = useDashboardFilter<MetricKey>("metric", "views", METRICS.map((item) => item.key));
  const [skus, setSkus] = useState<SkusData | null>(null);
  const [daily, setDaily] = useState<DayMetricsData | null>(null);
  const [query, setQuery] = useDashboardFilter<string>("q", "", undefined, 300);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [rowWindow, setRowWindow] = useState({ start: 0, end: 18 });
  const requestId = useRef(0);
  const elapsed = useElapsedSeconds(loading);

  useEffect(() => {
    if (!ready || cabinetsLoading) return;
    if (!cabinets.length) {
      setLoading(false);
      setError(cabinetsError || "Подключите хотя бы один активный WB-кабинет в настройках");
      return;
    }
    const controller = new AbortController();
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    const cabinet = encodeURIComponent(cabinetId || "all");
    Promise.all([
      fetch(`/api/seo/skus?window=${windowDays}&cabinet=${cabinet}`, { cache: "no-store", signal: controller.signal }),
      fetch(`/api/design/day-metrics?cabinet=${cabinet}`, { cache: "no-store", signal: controller.signal }),
    ]).then(async ([skuResponse, dailyResponse]) => {
      const skuBody = (await skuResponse.json()) as SkusData;
      const dailyBody = (await dailyResponse.json()) as DayMetricsData;
      if (!skuResponse.ok) throw new Error(skuBody.error || `Ошибка ${skuResponse.status}`);
      if (!dailyResponse.ok) throw new Error(dailyBody.error || `Ошибка ${dailyResponse.status}`);
      return [skuBody, dailyBody] as const;
    }).then(([skuBody, dailyBody]) => {
      if (current !== requestId.current) return;
      setSkus(skuBody);
      setDaily(dailyBody);
    }).catch((cause: unknown) => {
      if (current === requestId.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить воронку");
    }).finally(() => {
      if (current === requestId.current) setLoading(false);
    });
    return () => controller.abort();
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, ready, retryKey, windowDays]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return (skus?.skus ?? []).filter((sku) => !needle || `${sku.nm} ${sku.art} ${sku.name}`.toLocaleLowerCase("ru-RU").includes(needle));
  }, [query, skus?.skus]);

  const dates = useMemo(() => {
    return closedMoscowDates(windowDays);
  }, [windowDays]);

  useEffect(() => setRowWindow({ start: 0, end: Math.min(18, filtered.length) }), [filtered.length, query]);

  const updateWindow = (element: HTMLDivElement) => {
    const first = Math.floor(element.scrollTop / ROW_HEIGHT);
    const visible = Math.ceil(element.clientHeight / ROW_HEIGHT);
    const start = Math.max(0, first - 6);
    const end = Math.min(filtered.length, first + visible + 7);
    setRowWindow((current) => current.start === start && current.end === end ? current : { start, end });
  };

  const currentMetric = METRICS.find((item) => item.key === metric)!;
  const formatCell = (value: number | null | undefined) => currentMetric.kind === "pct" ? pct(value) : currentMetric.kind === "money" ? (value == null ? "—" : `${fmt(value)} ₽`) : fmt(value);

  return (
    <div className={embedded ? "" : "min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-16 md:pb-5"}>
      {!embedded ? <WbModuleHeader icon={Filter} title="Воронка" description={skus ? `${skus.metrics_period} · ${filtered.length} SKU · ${activeCabinet?.name ?? "все кабинеты"}` : "SKU × метрики × дни"} actions={<div className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm sm:min-h-8 sm:gap-0">{[1, 7, 30].map((days) => <button key={days} type="button" onClick={() => setWindowDays(days)} className={`min-h-11 rounded-md px-3 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-7 ${windowDays === days ? "bg-violet-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>{days === 1 ? "Вчера" : `${days} дней`}</button>)}</div>} /> : null}

      <div className="px-2 py-3 sm:px-6">
        <div className="mb-2 flex min-w-0 flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:flex-row lg:items-center">
          {embedded ? <div className="flex min-h-11 shrink-0 items-center rounded-lg bg-slate-100 p-0.5 sm:min-h-8">{[1, 7, 30].map((days) => <button key={days} type="button" onClick={() => setWindowDays(days)} className={`min-h-10 rounded-md px-3 text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-7 ${windowDays === days ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{days === 1 ? "Вчера" : `${days} дней`}</button>)}</div> : null}
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 sm:gap-1 lg:pb-0" role="tablist" aria-label="Метрика воронки">{METRICS.map((item) => <button key={item.key} type="button" role="tab" aria-selected={metric === item.key} title={item.definition} onClick={() => setMetric(item.key)} className={`min-h-11 shrink-0 rounded-lg px-3 text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-8 ${metric === item.key ? "bg-violet-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>{item.label}</button>)}</div>
          <label className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-violet-400 lg:w-72 lg:min-h-8"><Search className="h-3.5 w-3.5 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="nm, артикул, название" className="min-w-0 flex-1 bg-transparent text-xs outline-none" />{query ? <button type="button" aria-label="Очистить поиск" onClick={() => setQuery("")} className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-white"><X className="h-3.5 w-3.5" /></button> : null}</label>
        </div>

        {loading ? <><LoadingBanner seconds={elapsed} hint="Собираем посуточную воронку" /><div className="rounded-xl border border-slate-200 bg-white"><SkeletonTableRows rows={12} cols={8} /></div></> : error ? <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} /> : filtered.length === 0 ? <WbEmptyState>Нет SKU с данными за выбранный период.</WbEmptyState> : (
          <div className="h-[calc(100vh-190px)] min-h-[470px] overflow-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]" onScroll={(event) => updateWindow(event.currentTarget)}>
            <table className="min-w-max border-separate border-spacing-0 text-[10px]">
              <thead className="sticky top-0 z-30 bg-slate-50 text-slate-500">
                <tr className="h-6 text-[9px] uppercase tracking-wide text-slate-400">
                  <th rowSpan={2} className="sticky left-0 z-40 min-w-[245px] border-b border-r border-slate-200 bg-slate-50 px-3 text-left font-semibold">Товар</th>
                  <th colSpan={2} className="border-b border-r border-slate-200 text-center">Реклама</th>
                  <th colSpan={5} className="border-b border-r border-slate-200 text-center">Товарная воронка</th>
                  <th rowSpan={2} title={MARKETPLACE_METRICS.drrOrders.definition} className="min-w-[86px] border-b border-r border-slate-200 px-2 text-right">ДРР к заказам</th>
                  {dates.map((date) => <th rowSpan={2} key={date} className="min-w-[76px] border-b border-slate-200 px-1 text-center font-semibold">{dayLabel(date)}</th>)}
                </tr>
                <tr className="h-8">
                  <th title={MARKETPLACE_METRICS.views.definition} className="min-w-[88px] border-b border-slate-200 px-2 text-right">Рекл. показы</th>
                  <th title={MARKETPLACE_METRICS.ctr.definition} className="min-w-[72px] border-b border-r border-slate-200 px-2 text-right">Рекл. CTR</th>
                  <th className="min-w-[92px] border-b border-slate-200 px-2 text-right">Переходы</th>
                  <th className="min-w-[72px] border-b border-slate-200 px-2 text-right">Корзины</th>
                  <th title={MARKETPLACE_METRICS.cardToCartCr.definition} className="min-w-[82px] border-b border-slate-200 px-2 text-right">% в корзину</th>
                  <th className="min-w-[68px] border-b border-slate-200 px-2 text-right">Заказы, шт</th>
                  <th title={MARKETPLACE_METRICS.ordersRevenue.definition} className="min-w-[92px] border-b border-r border-slate-200 px-2 text-right">Заказы, ₽</th>
                </tr>
              </thead>
              <tbody>
                {rowWindow.start > 0 ? <tr aria-hidden="true" style={{ height: rowWindow.start * ROW_HEIGHT }}><td colSpan={9 + dates.length} /></tr> : null}
                {filtered.slice(rowWindow.start, rowWindow.end).map((sku) => <tr key={sku.nm} className="h-12 hover:bg-violet-50/20"><td className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-3"><div className="flex items-center gap-2"><div className="relative grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-100 bg-slate-50 text-slate-300"><Package className="h-4 w-4" /><WbProductImage nm={sku.nm} src={sku.img_url} className="absolute inset-0 h-full w-full rounded-md object-cover" /></div><div className="min-w-0"><div className="max-w-[185px] truncate font-semibold text-slate-700">{sku.art}</div><div className="max-w-[185px] truncate text-[9px] text-slate-400">{sku.name || `nm ${sku.nm}`}</div></div></div></td><td className="border-b border-slate-100 px-2 text-right tabular-nums">{fmt(sku.shows_window)}</td><td className="border-b border-r border-slate-100 px-2 text-right tabular-nums">{pct(sku.ctr_window)}</td><td className="border-b border-slate-100 px-2 text-right tabular-nums">{fmt(sku.open_card_window)}</td><td className="border-b border-slate-100 px-2 text-right tabular-nums">{fmt(sku.cart_window)}</td><td className="border-b border-slate-100 px-2 text-right tabular-nums">{pct(sku.cv_cart_window)}</td><td className="border-b border-slate-100 px-2 text-right tabular-nums">{fmt(sku.orders_count_window)}</td><td className="border-b border-r border-slate-100 px-2 text-right font-semibold tabular-nums">{fmt(sku.orders_sum_window)} ₽</td><td className="border-b border-r border-slate-100 px-2 text-right tabular-nums">{pct(sku.drr_window)}</td>{dates.map((date) => { const value = daily?.metrics[String(sku.nm)]?.[date]?.[metric]; return <td key={date} className="border-b border-slate-100 px-1 text-center"><span className={`inline-flex min-h-7 min-w-[66px] items-center justify-center rounded-md px-1 font-semibold tabular-nums ${cellTone(metric, value)}`}>{formatCell(value)}</span></td>; })}</tr>)}
                {rowWindow.end < filtered.length ? <tr aria-hidden="true" style={{ height: (filtered.length - rowWindow.end) * ROW_HEIGHT }}><td colSpan={9 + dates.length} /></tr> : null}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
