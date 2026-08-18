"use client";

import { BarChart3, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { METRIC_TEXT_TONE, marketplaceMetricStatus } from "@/lib/analytics/marketplaceMetrics";
import { useCategoryMap } from "@/lib/useCategoryMap";
import { useDashboardFilter } from "@/lib/useDashboardFilter";
import { WbProductImage } from "./WbProductImage";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

type AbcClass = "A" | "B" | "C" | "D";
interface AbcRow { nm: number; art: string; name: string; img_url: string | null; revenue: number; profit: number; margin: number | null; cumPct: number | null; share: number | null; cls: AbcClass }
interface AbcData { rows: AbcRow[]; totalProfit: number; skuTotal: number; aShareOfSku: number; counts: Record<AbcClass, number>; error?: string }
type SortKey = "profit" | "share" | "cumPct" | "margin" | "revenue" | "art";

const CLASS_META: Record<AbcClass, { label: string; badge: string }> = {
  A: { label: "Ядро прибыли", badge: "bg-emerald-50 text-emerald-700" },
  B: { label: "Поддержка", badge: "bg-sky-50 text-sky-700" },
  C: { label: "Хвост", badge: "bg-amber-50 text-amber-700" },
  D: { label: "Убыточные", badge: "bg-rose-50 text-rose-700" },
};
const ROW_HEIGHT = 49;
const fmt = (value: number | null | undefined) => value == null ? "—" : Math.round(value).toLocaleString("ru-RU");

export function WbAbcPage() {
  const { cabinetId, activeCabinet, cabinets, ready, loading: cabinetsLoading, error: cabinetsError } = useWbCabinet();
  const { categories, byArticle } = useCategoryMap();
  const [data, setData] = useState<AbcData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [query, setQuery] = useDashboardFilter<string>("q", "", undefined, 300);
  const [category, setCategory] = useDashboardFilter<string>("category", "");
  const [abcClass, setAbcClass] = useDashboardFilter<AbcClass | "">("class", "", ["", "A", "B", "C", "D"]);
  const [sortKey, setSortKey] = useDashboardFilter<SortKey>("sort", "profit", ["profit", "share", "cumPct", "margin", "revenue", "art"]);
  const [sortDirection, setSortDirection] = useDashboardFilter("dir", "desc", ["asc", "desc"] as const);
  const sortAsc = sortDirection === "asc";
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
    fetch(`/api/abc?cabinet=${encodeURIComponent(cabinetId || "all")}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const body = (await response.json()) as AbcData; if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`); return body; })
      .then((body) => { if (current === requestId.current) setData(body); })
      .catch((cause: unknown) => { if (current === requestId.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить ABC-анализ"); })
      .finally(() => { if (current === requestId.current) setLoading(false); });
    return () => controller.abort();
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, ready, retryKey]);

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return (data?.rows ?? []).filter((row) => {
      if (abcClass && row.cls !== abcClass) return false;
      if (category && (category === "__none" ? Boolean(byArticle[row.art]) : byArticle[row.art] !== category)) return false;
      return !needle || `${row.nm} ${row.art} ${row.name}`.toLocaleLowerCase("ru-RU").includes(needle);
    }).sort((a, b) => {
      const av = sortKey === "art" ? a.art : a[sortKey] ?? -Infinity;
      const bv = sortKey === "art" ? b.art : b[sortKey] ?? -Infinity;
      const result = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, "ru") : Number(av) - Number(bv);
      return sortAsc ? result : -result;
    });
  }, [abcClass, byArticle, category, data?.rows, query, sortAsc, sortKey]);

  useEffect(() => setRowWindow({ start: 0, end: Math.min(18, rows.length) }), [rows.length, query, category, abcClass]);
  const changeSort = (key: SortKey) => { if (sortKey === key) setSortDirection(sortAsc ? "desc" : "asc"); else { setSortKey(key); setSortDirection("desc"); } };
  const updateWindow = (element: HTMLDivElement) => { const first = Math.floor(element.scrollTop / ROW_HEIGHT); const visible = Math.ceil(element.clientHeight / ROW_HEIGHT); const start = Math.max(0, first - 6); const end = Math.min(rows.length, first + visible + 7); setRowWindow((current) => current.start === start && current.end === end ? current : { start, end }); };

  return <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
    <WbModuleHeader icon={BarChart3} title="ABC-анализ" description={`Чистая прибыль за 30 дней · ${activeCabinet?.name ?? "все кабинеты"}`} />
    <div className="px-2 py-3 sm:px-6">
      {data && !loading ? <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-5"><div className="col-span-2 rounded-xl border border-slate-200 bg-white p-3 lg:col-span-1"><div className="text-[9px] uppercase tracking-wide text-slate-400">80% прибыли</div><div className="mt-1 text-lg font-bold text-slate-800">{data.counts.A} SKU</div><div className="text-[10px] text-slate-500">{data.aShareOfSku}% ассортимента</div></div>{(["A", "B", "C", "D"] as AbcClass[]).map((value) => <button type="button" key={value} onClick={() => setAbcClass((current) => current === value ? "" : value)} className={`rounded-xl border bg-white p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${abcClass === value ? "border-violet-300 ring-1 ring-violet-200" : "border-slate-200 hover:border-violet-200"}`}><div className="flex items-center gap-2"><span className={`grid h-6 w-6 place-items-center rounded-lg text-[10px] font-bold ${CLASS_META[value].badge}`}>{value}</span><span className="truncate text-[10px] text-slate-500">{CLASS_META[value].label}</span></div><div className="mt-1 text-lg font-bold tabular-nums text-slate-800">{data.counts[value]}</div></button>)}</div> : null}

      <div className="mb-2 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2 lg:flex-row lg:items-center"><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Категория" className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 outline-none focus:border-violet-400 lg:min-h-8 lg:w-48"><option value="">Все категории</option>{categories.map((item) => <option key={item}>{item}</option>)}<option value="__none">Без категории</option></select><label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-violet-400 lg:min-h-8"><Search className="h-3.5 w-3.5 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="nm, артикул, название" className="min-w-0 flex-1 bg-transparent text-xs outline-none" />{query ? <button type="button" onClick={() => setQuery("")} aria-label="Очистить поиск" className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-white"><X className="h-3.5 w-3.5" /></button> : null}</label><span className="px-1 text-xs tabular-nums text-slate-400">{rows.length} SKU</span></div>

      {loading ? <><LoadingBanner seconds={elapsed} hint="Считаем вклад SKU в прибыль" /><div className="rounded-xl border border-slate-200 bg-white"><SkeletonTableRows rows={12} cols={7} /></div></> : error ? <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} /> : rows.length === 0 ? <WbEmptyState>Нет SKU по выбранным фильтрам.</WbEmptyState> : <div className="h-[calc(100vh-268px)] min-h-[430px] overflow-auto rounded-xl border border-slate-200 bg-white" onScroll={(event) => updateWindow(event.currentTarget)}><table className="min-w-full text-[10px]"><thead className="sticky top-0 z-20 bg-slate-50 text-slate-500"><tr className="h-9 border-b border-slate-200"><th className="sticky left-0 z-30 w-14 border-r border-slate-200 bg-slate-50 px-3 text-left">Класс</th><SortHead label="Товар" field="art" active={sortKey} asc={sortAsc} onClick={changeSort} align="left" /><SortHead label="Прибыль, ₽" field="profit" active={sortKey} asc={sortAsc} onClick={changeSort} /><SortHead label="Доля" field="share" active={sortKey} asc={sortAsc} onClick={changeSort} /><SortHead label="Накоп." field="cumPct" active={sortKey} asc={sortAsc} onClick={changeSort} /><SortHead label="Маржа после МП" field="margin" active={sortKey} asc={sortAsc} onClick={changeSort} /><SortHead label="Заказы, ₽" field="revenue" active={sortKey} asc={sortAsc} onClick={changeSort} /></tr></thead><tbody>{rowWindow.start > 0 ? <tr aria-hidden="true" style={{ height: rowWindow.start * ROW_HEIGHT }}><td colSpan={7} /></tr> : null}{rows.slice(rowWindow.start, rowWindow.end).map((row) => <tr key={row.nm} className={`h-12 border-b border-slate-100 hover:bg-violet-50/20 ${row.cls === "D" ? "bg-rose-50/20" : ""}`}><td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-3"><span className={`grid h-6 w-6 place-items-center rounded-lg font-bold ${CLASS_META[row.cls].badge}`}>{row.cls}</span></td><td className="min-w-[260px] px-3"><div className="flex items-center gap-2"><WbProductImage nm={row.nm} src={row.img_url} className="h-8 w-8 shrink-0 rounded-md border border-slate-100 bg-slate-100 object-cover" /><div className="min-w-0"><div className="max-w-[200px] truncate font-semibold text-slate-700">{row.art}</div><div className="max-w-[200px] truncate text-[9px] text-slate-400">{row.name || `nm ${row.nm}`}</div></div></div></td><td className={`px-3 text-right font-semibold tabular-nums ${row.profit < 0 ? "text-rose-600" : "text-emerald-700"}`}>{fmt(row.profit)}</td><td className="px-3 text-right tabular-nums text-slate-500">{row.share == null ? "—" : `${row.share}%`}</td><td className="px-3 text-right tabular-nums text-slate-500">{row.cumPct == null ? "—" : `${row.cumPct}%`}</td><td className={`px-3 text-right font-semibold tabular-nums ${METRIC_TEXT_TONE[marketplaceMetricStatus("marginAfterMarketplace", row.margin)]}`}>{row.margin == null ? "—" : `${row.margin}%`}</td><td className="px-3 text-right tabular-nums text-slate-500">{fmt(row.revenue)}</td></tr>)}{rowWindow.end < rows.length ? <tr aria-hidden="true" style={{ height: (rows.length - rowWindow.end) * ROW_HEIGHT }}><td colSpan={7} /></tr> : null}</tbody></table></div>}
      <p className="mt-2 text-[10px] leading-4 text-slate-400">Прибыль = выкупы − себестоимость − комиссия − эквайринг − налог 7% − реклама. A ≤ 80%, B ≤ 95%, C — остаток, D — убыток.</p>
    </div>
  </div>;
}

function SortHead({ label, field, active, asc, onClick, align = "right" }: { label: string; field: SortKey; active: SortKey; asc: boolean; onClick: (field: SortKey) => void; align?: "left" | "right" }) {
  return <th className={`px-3 ${align === "left" ? "text-left" : "text-right"}`}><button type="button" onClick={() => onClick(field)} className="min-h-11 whitespace-nowrap font-semibold hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-8">{label}{active === field ? asc ? " ↑" : " ↓" : ""}</button></th>;
}
