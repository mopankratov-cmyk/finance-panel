"use client";

import {
  ChevronRight,
  ExternalLink,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonCards, useElapsedSeconds } from "@/components/ui/LoadingState";
import { MARKETPLACE_METRICS, METRIC_TEXT_TONE, marketplaceMetricStatus, type MarketplaceMetricId } from "@/lib/analytics/marketplaceMetrics";
import { useDialogBehavior } from "@/hooks/useDialogBehavior";
import { useCategoryMap } from "@/lib/useCategoryMap";
import { useDashboardFilter } from "@/lib/useDashboardFilter";
import { WbProductImage } from "./WbProductImage";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

interface SeoSku {
  nm: number;
  art: string;
  name: string;
  img_url: string;
  shop?: string;
  shows_window: number;
  ctr_window: number | null;
  cart_window: number;
  cv_order_window: number | null;
  orders_count_window: number;
  orders_sum_window: number;
  drr_window: number | null;
  margin_before_drr_window: number | null;
  stock: number;
  rating: number | null;
  reviews: number | null;
}

interface SeoData {
  skus: SeoSku[];
  metrics_period: string;
  count: number;
  error?: string;
}

interface KeywordWord {
  keyword: string;
  shows: number;
  daily: { pos: number | null }[];
}

interface KeywordData {
  words: KeywordWord[];
  days: string[];
  note?: string;
  error?: string;
}

const ITEM_HEIGHT = 82;

const fmt = (value: number | null) => value == null ? "—" : Math.round(value).toLocaleString("ru-RU");
const pct = (value: number | null) => value == null ? "—" : `${Math.round(value * 10) / 10}%`;

function positionTone(position: number | null) {
  if (position == null) return "bg-slate-50 text-slate-300";
  if (position <= 10) return "bg-emerald-50 text-emerald-700";
  if (position <= 30) return "bg-amber-50 text-amber-700";
  return "bg-rose-50 text-rose-600";
}

export function WbSeoPage() {
  const { activeCabinet, cabinetId, cabinets, ready, loading: cabinetsLoading, error: cabinetsError } = useWbCabinet();
  const [windowParam, setWindowParam] = useDashboardFilter("days", "7", ["1", "7", "30"] as const);
  const windowDays = Number(windowParam);
  const setWindowDays = (days: number) => setWindowParam(String(days) as typeof windowParam);
  const [data, setData] = useState<SeoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [query, setQuery] = useDashboardFilter<string>("q", "", undefined, 300);
  const [category, setCategory] = useDashboardFilter<string>("category", "");
  const [itemWindow, setItemWindow] = useState({ start: 0, end: 14 });
  const [selected, setSelected] = useState<SeoSku | null>(null);
  const [keywords, setKeywords] = useState<KeywordData | null>(null);
  const [keywordsLoading, setKeywordsLoading] = useState(false);
  const [keywordsError, setKeywordsError] = useState<string | null>(null);
  const requestId = useRef(0);
  const drawerRef = useRef<HTMLElement | null>(null);
  const elapsed = useElapsedSeconds(loading);
  const { categories, byArticle } = useCategoryMap();

  useEffect(() => {
    if (!ready || cabinetsLoading) return;
    if (cabinets.length === 0) {
      setLoading(false);
      setError(cabinetsError || "Подключите хотя бы один активный WB-кабинет в настройках");
      return;
    }

    const controller = new AbortController();
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    setSelected(null);
    fetch(`/api/seo/skus?window=${windowDays}&cabinet=${encodeURIComponent(cabinetId || "all")}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as SeoData;
        if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then((body) => {
        if (current !== requestId.current) return;
        if (body.error) throw new Error(body.error);
        setData(body);
      })
      .catch((cause: unknown) => {
        if (current === requestId.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить SEO-аналитику");
      })
      .finally(() => {
        if (current === requestId.current) setLoading(false);
      });
    return () => controller.abort();
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, ready, retryKey, windowDays]);

  useEffect(() => {
    if (!selected) {
      setKeywords(null);
      setKeywordsError(null);
      return;
    }
    const controller = new AbortController();
    setKeywordsLoading(true);
    setKeywords(null);
    setKeywordsError(null);
    fetch(`/api/seo/keywords/${selected.nm}?cabinet=${encodeURIComponent(cabinetId || "all")}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as KeywordData;
        if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then((body) => {
        setKeywords(body);
        if (body.error) setKeywordsError(body.error);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setKeywordsError(cause instanceof Error ? cause.message : "Не удалось загрузить позиции");
      })
      .finally(() => {
        if (!controller.signal.aborted) setKeywordsLoading(false);
      });
    return () => controller.abort();
  }, [cabinetId, selected]);

  // Escape тут был и раньше, а вот фон под шторкой продолжал прокручиваться и
  // фокус с внешней клавиатуры уходил в скрытый под ней список. Общий хук
  // закрывает всё три вещи разом.
  const closeSelected = useCallback(() => setSelected(null), []);
  useDialogBehavior(Boolean(selected), closeSelected, drawerRef);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return (data?.skus ?? []).filter((sku) => {
      if (category && (category === "__none" ? Boolean(byArticle[sku.art]) : byArticle[sku.art] !== category)) return false;
      if (!needle) return true;
      return `${sku.nm} ${sku.art} ${sku.name}`.toLocaleLowerCase("ru-RU").includes(needle);
    });
  }, [byArticle, category, data?.skus, query]);

  useEffect(() => setItemWindow({ start: 0, end: Math.min(14, filtered.length) }), [filtered.length, query, category]);

  const updateItemWindow = (element: HTMLDivElement) => {
    const first = Math.floor(element.scrollTop / ITEM_HEIGHT);
    const visible = Math.ceil(element.clientHeight / ITEM_HEIGHT);
    const start = Math.max(0, first - 5);
    const end = Math.min(filtered.length, first + visible + 6);
    setItemWindow((current) => current.start === start && current.end === end ? current : { start, end });
  };

  return (
    <div className="min-h-[calc(100dvh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
      <WbModuleHeader
        icon={Search}
        title="SEO и позиции"
        description={data ? `${data.metrics_period} · показы → CTR → корзина → заказ` : "Поисковые позиции и воронка SKU"}
        actions={
          <div className="flex min-h-11 items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm lg:min-h-8">
            {[1, 7, 30].map((days) => (
              <button key={days} type="button" onClick={() => setWindowDays(days)} className={`min-h-10 rounded-md px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 lg:min-h-7 ${windowDays === days ? "bg-violet-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>{days === 1 ? "Вчера" : `${days} дней`}</button>
            ))}
          </div>
        }
      />

      <div className="px-2 py-3 sm:px-6">
        <div className="mb-3 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:flex-row sm:items-center">
          {categories.length ? (
            <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Категория" className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 lg:min-h-8 sm:w-44">
              <option value="">Все категории</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              <option value="__none">Без категории</option>
            </select>
          ) : null}
          <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100 lg:min-h-8">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по nm / артикулу / названию" className="min-w-0 flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400" />
            {query ? <button type="button" onClick={() => setQuery("")} aria-label="Очистить поиск" className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-white"><X className="h-3.5 w-3.5" /></button> : null}
          </label>
          <span className="whitespace-nowrap px-1 text-xs tabular-nums text-slate-500">{filtered.length} SKU</span>
        </div>

        {loading ? (
          <>
            <LoadingBanner seconds={elapsed} hint={`SEO · ${activeCabinet?.name ?? "все кабинеты"}`} />
            <SkeletonCards count={9} />
          </>
        ) : error ? (
          <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} />
        ) : filtered.length === 0 ? (
          <WbEmptyState>{query || category ? "По выбранным фильтрам ничего не найдено." : "Нет данных SEO за выбранный период."}</WbEmptyState>
        ) : (
          <div className="h-[68svh] min-h-[320px] overflow-auto overscroll-contain pr-0.5 md:h-[calc(100dvh-205px)] md:min-h-[440px]" onScroll={(event) => updateItemWindow(event.currentTarget)}>
            {itemWindow.start > 0 ? <div aria-hidden="true" style={{ height: itemWindow.start * ITEM_HEIGHT }} /> : null}
            <div className="space-y-2">
              {filtered.slice(itemWindow.start, itemWindow.end).map((sku) => (
                <button
                  type="button"
                  key={sku.nm}
                  onClick={() => setSelected(sku)}
                  className="group flex h-[74px] w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-violet-200 hover:bg-violet-50/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                >
                  <WbProductImage nm={sku.nm} src={sku.img_url} className="h-12 w-12 shrink-0 rounded-lg border border-slate-100 bg-slate-50 object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold text-slate-800">{sku.art}</div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-500">{sku.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] text-slate-400 sm:hidden"><span>{fmt(sku.orders_count_window)} заказов</span><span>ДРР {pct(sku.drr_window)}</span><span>{fmt(sku.shows_window)} показов</span><span className={sku.stock < 10 ? "font-semibold text-rose-600" : undefined}>остаток {fmt(sku.stock)}</span><span>{fmt(sku.reviews)} отз. <span className="text-amber-500">★ {sku.rating ?? "—"}</span></span></div>
                  </div>
                  <div className="hidden items-center gap-4 sm:flex">
                    <div className="text-right"><div className="text-[9px] uppercase tracking-wide text-slate-400">показы</div><div className="text-[11px] font-medium tabular-nums text-slate-700">{fmt(sku.shows_window)}</div></div>
                    <div className="text-right"><div className="text-[9px] uppercase tracking-wide text-slate-400">остаток</div><div className={`text-[11px] font-medium tabular-nums ${sku.stock < 10 ? "text-rose-600" : "text-slate-700"}`}>{fmt(sku.stock)}</div></div>
                    <div className="text-right"><div className="text-[9px] uppercase tracking-wide text-slate-400">отзывы</div><div className="text-[11px] font-medium tabular-nums text-slate-700">{fmt(sku.reviews)} <span className="text-amber-500">★ {sku.rating ?? "—"}</span></div></div>
                    <div className="rounded-lg bg-violet-50 px-2.5 py-1 text-[10px] font-medium text-violet-600">{sku.shop || activeCabinet?.name || "WB"}</div>
                    <span className="text-[10px] tabular-nums text-slate-400">nm {sku.nm}</span>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-violet-500 transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>
            {itemWindow.end < filtered.length ? <div aria-hidden="true" style={{ height: (filtered.length - itemWindow.end) * ITEM_HEIGHT }} /> : null}
          </div>
        )}
      </div>

      {selected ? (
        <>
          <button type="button" aria-label="Закрыть карточку SEO" onClick={() => setSelected(null)} className="fixed inset-0 z-[79] bg-slate-950/25" />
          <aside ref={drawerRef} role="dialog" aria-modal="true" aria-label={`SEO ${selected.art}`} className="fixed bottom-0 right-0 top-[calc(54px+var(--safe-t))] z-[80] flex w-full max-w-[760px] flex-col border-l border-slate-200 bg-[#f6f7f9] pb-safe shadow-2xl">
            <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
              <WbProductImage nm={selected.nm} src={selected.img_url} loading="eager" className="h-11 w-11 shrink-0 rounded-lg bg-slate-50 object-cover" />
              <div className="min-w-0"><div className="truncate text-sm font-bold text-slate-800">{selected.art}</div><div className="truncate text-[11px] text-slate-400">{selected.name}</div></div>
              <a href={`https://www.wildberries.ru/catalog/${selected.nm}/detail.aspx`} target="_blank" rel="noreferrer" aria-label="Открыть карточку на Wildberries" className="ml-auto inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-[10px] font-semibold text-slate-500 hover:bg-slate-50 lg:min-h-8 sm:min-w-0 sm:px-2.5"><span className="hidden sm:inline">Карточка WB</span> <ExternalLink className="h-3.5 w-3.5" /></a>
              <button type="button" onClick={() => setSelected(null)} aria-label="Закрыть" className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 lg:h-10 lg:w-10"><X className="h-4 w-4" /></button>
            </div>

            <div className="grid grid-cols-3 gap-2 border-b border-slate-200 p-3 sm:grid-cols-6">
              {([
                [MARKETPLACE_METRICS.views.label, fmt(selected.shows_window), "views", selected.shows_window],
                [MARKETPLACE_METRICS.ctr.label, pct(selected.ctr_window), "ctr", selected.ctr_window],
                ["Корзины", fmt(selected.cart_window), null, selected.cart_window],
                ["Заказы, шт", fmt(selected.orders_count_window), null, selected.orders_count_window],
                [MARKETPLACE_METRICS.drrOrders.label, pct(selected.drr_window), "drrOrders", selected.drr_window],
                [MARKETPLACE_METRICS.marginBeforeAds.label, pct(selected.margin_before_drr_window), "marginBeforeAds", selected.margin_before_drr_window],
              ] as Array<[string, string, MarketplaceMetricId | null, number | null]>).map(([label, value, metricId, numeric]) => <div key={label} title={metricId ? MARKETPLACE_METRICS[metricId].definition : undefined} className="rounded-lg border border-slate-200 bg-white p-2"><div className="text-[9px] uppercase tracking-wide text-slate-400">{label}</div><div className={`mt-0.5 text-xs font-semibold tabular-nums ${metricId ? METRIC_TEXT_TONE[marketplaceMetricStatus(metricId, numeric)] : "text-slate-700"}`}>{value}</div></div>)}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
              <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-bold text-slate-800">Поисковые запросы и позиции</h2><span className="text-[10px] text-slate-400">история до 30 дней</span></div>
              {keywordsLoading ? <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> Загружаем поисковые позиции…</div> : null}
              {keywordsError ? <WbErrorState message={keywordsError} /> : null}
              {!keywordsLoading && keywords && keywords.words.length ? (
                <div className="scroll-x rounded-xl border border-slate-200 bg-white">
                  <table className="min-w-full border-collapse text-[10px]">
                    <thead><tr className="h-8 bg-slate-50 text-slate-500"><th className="sticky left-0 z-10 min-w-[210px] border-b border-r border-slate-200 bg-slate-50 px-3 text-left">Запрос</th><th className="min-w-[70px] border-b border-r border-slate-200 px-2 text-right">Частота</th>{keywords.days.map((day) => <th key={day} className="min-w-[48px] border-b border-r border-slate-200 px-1 text-center">{day.slice(8, 10)}.{day.slice(5, 7)}</th>)}</tr></thead>
                    <tbody>{keywords.words.map((word) => <tr key={word.keyword} className="h-9 border-b border-slate-100 last:border-b-0"><td className="sticky left-0 z-10 max-w-[240px] truncate border-r border-slate-100 bg-white px-3 font-medium text-slate-700">{word.keyword}</td><td className="border-r border-slate-100 px-2 text-right tabular-nums text-slate-500">{fmt(word.shows)}</td>{word.daily.map((day, index) => <td key={`${word.keyword}-${keywords.days[index]}`} className="border-r border-slate-100 p-1 text-center"><span className={`inline-grid h-6 min-w-7 place-items-center rounded-md px-1 tabular-nums ${positionTone(day.pos)}`}>{day.pos ?? "—"}</span></td>)}</tr>)}</tbody>
                  </table>
                </div>
              ) : null}
              {!keywordsLoading && keywords && keywords.words.length === 0 && !keywordsError ? <WbEmptyState>Позиции ещё не накоплены. Для живых запросов нужна подписка WB «Джем».</WbEmptyState> : null}
              {keywords?.note ? <p className="mt-2 text-[10px] leading-4 text-amber-700">{keywords.note}</p> : null}
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
