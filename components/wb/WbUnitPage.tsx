"use client";

import {
  Boxes,
  Calculator,
  Gem,
  Loader2,
  RefreshCw,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { useCategoryMap } from "@/lib/useCategoryMap";
import { useDashboardFilter } from "@/lib/useDashboardFilter";
import { useSort, sortGlyph } from "@/lib/useSort";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

interface UnitData {
  headers: string[];
  rows: (string | number)[][];
  img_urls: string[];
  names: string[];
  meta_text: string;
  error?: string;
}

interface PriceTarget {
  margin: number;
  neededRevenue: number | null;
  neededCatalogPrice: number | null;
  deltaPct: number | null;
  reachable: boolean;
}

interface PriceItem {
  nm: number;
  article: string;
  cogs: number | null;
  currentRevenue: number;
  currentMarginPct: number | null;
  targets: PriceTarget[];
}

interface PriceSolverData {
  margins: number[];
  items: PriceItem[];
  error?: string;
}

const FIRST_DATA_COL = 3;
const ROW_HEIGHT = 49;
const SOLVER_ROW_HEIGHT = 43;

const show = (value: string | number) => {
  if (value === "" || value == null) return "—";
  return typeof value === "number" ? value.toLocaleString("ru-RU") : value;
};

const rub = (value: number | null | undefined) => value == null ? "—" : `${Math.round(value).toLocaleString("ru-RU")} ₽`;

function valueTone(header: string, value: string | number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "text-slate-600";
  if (/маржа|вал %|дельта/i.test(header)) return numeric < 0 ? "font-semibold text-rose-600" : "text-emerald-700";
  if (/ддр|дрр/i.test(header)) return numeric > 25 ? "font-semibold text-rose-600" : numeric > 15 ? "text-amber-600" : "text-emerald-700";
  return "text-slate-600";
}

export function WbUnitPage() {
  const { activeCabinet, cabinetId, cabinets, ready, loading: cabinetsLoading, error: cabinetsError } = useWbCabinet();
  const [data, setData] = useState<UnitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [refreshing, setRefreshing] = useState<"prices" | "stocks" | "cogs" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [category, setCategory] = useDashboardFilter<string>("category", "");
  const [rowWindow, setRowWindow] = useState({ start: 0, end: 18 });
  const [solverOpen, setSolverOpen] = useState(false);
  const [solver, setSolver] = useState<PriceSolverData | null>(null);
  const [solverLoading, setSolverLoading] = useState(false);
  const [solverError, setSolverError] = useState<string | null>(null);
  const [solverWindow, setSolverWindow] = useState({ start: 0, end: 18 });
  const requestId = useRef(0);
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
    let timedOut = false;
    const deadline = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 65_000);

    setLoading(true);
    setError(null);
    fetch(`/api/unit/table?cabinet=${encodeURIComponent(cabinetId || "all")}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as UnitData;
        if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then((body) => {
        if (current !== requestId.current) return;
        if (body.error) throw new Error(body.error);
        setData(body);
      })
      .catch((cause: unknown) => {
        if (current !== requestId.current || (controller.signal.aborted && !timedOut)) return;
        setError(timedOut ? "Юнит-экономика не рассчиталась за 65 секунд. Повторите запрос." : cause instanceof Error ? cause.message : "Не удалось загрузить юнит-экономику");
      })
      .finally(() => {
        window.clearTimeout(deadline);
        if (current === requestId.current) setLoading(false);
      });

    return () => {
      window.clearTimeout(deadline);
      controller.abort();
    };
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, ready, retryKey]);

  const filteredIndices = useMemo(() => (data?.rows ?? []).map((_, index) => index).filter((index) => {
    if (!category) return true;
    const article = String(data!.rows[index][2]);
    return category === "__none" ? !byArticle[article] : byArticle[article] === category;
  }), [byArticle, category, data]);

  const { sorted: indices, sortField, sortDir, toggleSort } = useSort(filteredIndices, (rowIndex, field) => {
    const value = data?.rows[rowIndex]?.[Number(field)];
    if (value == null || value === "") return null;
    return typeof value === "number" ? value : Number.isFinite(Number(value)) ? Number(value) : String(value);
  });

  useEffect(() => setRowWindow({ start: 0, end: Math.min(18, indices.length) }), [indices.length, sortDir, sortField]);

  useEffect(() => {
    if (!solverOpen) return;
    const controller = new AbortController();
    setSolverLoading(true);
    setSolverError(null);
    fetch(`/api/unit/price-solver?cabinet=${encodeURIComponent(cabinetId || "all")}&margins=15,25,35`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as PriceSolverData;
        if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then((body) => {
        setSolver(body);
        setSolverWindow({ start: 0, end: Math.min(18, body.items?.length ?? 0) });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setSolverError(cause instanceof Error ? cause.message : "Не удалось рассчитать цены");
      })
      .finally(() => {
        if (!controller.signal.aborted) setSolverLoading(false);
      });
    return () => controller.abort();
  }, [cabinetId, solverOpen]);

  useEffect(() => {
    if (!solverOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSolverOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [solverOpen]);

  const refresh = async (kind: "prices" | "stocks" | "cogs") => {
    setRefreshing(kind);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/unit/refresh-${kind}?cabinet=${encodeURIComponent(cabinetId || "all")}`, { method: "POST" });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error || `Ошибка ${response.status}`);
      const label = kind === "prices" ? "Цены обновлены" : kind === "stocks" ? "Остатки обновлены" : "Себестоимость обновлена";
      setMessage(label);
      setRetryKey((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось обновить данные");
    } finally {
      setRefreshing(null);
    }
  };

  const updateRowWindow = (element: HTMLDivElement) => {
    const top = Math.max(0, element.scrollTop - 34);
    const first = Math.floor(top / ROW_HEIGHT);
    const visible = Math.ceil(element.clientHeight / ROW_HEIGHT);
    const start = Math.max(0, first - 4);
    const end = Math.min(indices.length, first + visible + 5);
    setRowWindow((current) => current.start === start && current.end === end ? current : { start, end });
  };

  const updateSolverWindow = (element: HTMLDivElement) => {
    const top = Math.max(0, element.scrollTop - 34);
    const first = Math.floor(top / SOLVER_ROW_HEIGHT);
    const visible = Math.ceil(element.clientHeight / SOLVER_ROW_HEIGHT);
    const start = Math.max(0, first - 4);
    const end = Math.min(solver?.items.length ?? 0, first + visible + 5);
    setSolverWindow((current) => current.start === start && current.end === end ? current : { start, end });
  };

  const actionButton = (kind: "prices" | "stocks" | "cogs", label: string, Icon: typeof WalletCards, tone: string) => (
    <button
      type="button"
      onClick={() => refresh(kind)}
      disabled={refreshing !== null}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold text-white shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 sm:min-h-8 ${tone}`}
    >
      {refreshing === kind ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Icon className="h-3.5 w-3.5" />}
      {label}
    </button>
  );

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
      <WbModuleHeader
        icon={Gem}
        title="Unit fact неделя"
        description={data?.meta_text || "Цена до СПП − себестоимость − комиссия − эквайринг − ДРР − налог"}
        actions={
          <>
            {categories.length ? (
              <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Категория" className="min-h-11 max-w-44 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-600 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 sm:min-h-8">
                <option value="">Все категории</option>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
                <option value="__none">Без категории</option>
              </select>
            ) : null}
            {actionButton("prices", "Обновить цены", WalletCards, "bg-violet-600 hover:bg-violet-700")}
            {actionButton("stocks", "Обновить остатки", RefreshCw, "bg-amber-500 hover:bg-amber-600")}
            {actionButton("cogs", "Обновить себест.", Boxes, "bg-indigo-500 hover:bg-indigo-600")}
            <button type="button" onClick={() => setSolverOpen(true)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-8">
              <Calculator className="h-3.5 w-3.5" /> Калькулятор цены
            </button>
          </>
        }
      />

      <div className="px-2 py-3 sm:px-6">
        {message ? <div role="status" className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{message}</div> : null}
        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <LoadingBanner seconds={elapsed} hint={`юнит-экономика · ${activeCabinet?.name ?? "все кабинеты"}`} />
            <SkeletonTableRows rows={10} cols={10} />
          </div>
        ) : error ? (
          <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} />
        ) : !data || indices.length === 0 ? (
          <WbEmptyState>Нет данных. Проверьте синхронизацию WB и себестоимость.</WbEmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              Юнит-экономика по {indices.length} SKU · {activeCabinet?.name ?? "все кабинеты"}
            </div>
            <div className="max-h-[calc(100vh-190px)] min-h-[360px] overflow-auto overscroll-contain" onScroll={(event) => updateRowWindow(event.currentTarget)}>
              <table className="hidden w-full min-w-[1500px] border-collapse text-[11px] md:table">
                <thead className="sticky top-0 z-30 bg-slate-800 text-white">
                  <tr className="h-[34px]">
                    <th onClick={() => toggleSort("2")} className="sticky left-0 z-40 w-[245px] min-w-[245px] cursor-pointer select-none border-r border-slate-600 bg-slate-800 px-3 text-left font-semibold hover:bg-slate-700">Артикул{sortGlyph(sortField === "2", sortDir)}</th>
                    {data.headers.slice(FIRST_DATA_COL).map((header, index) => {
                      const field = String(FIRST_DATA_COL + index);
                      return <th key={`${header}-${index}`} onClick={() => toggleSort(field)} className="min-w-[80px] cursor-pointer select-none border-r border-slate-600 px-2 text-right font-semibold last:border-r-0 hover:bg-slate-700">{header}{sortGlyph(sortField === field, sortDir)}</th>;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rowWindow.start > 0 ? <tr aria-hidden="true" style={{ height: rowWindow.start * ROW_HEIGHT }}><td colSpan={data.headers.length} /></tr> : null}
                  {indices.slice(rowWindow.start, rowWindow.end).map((rowIndex) => {
                    const row = data.rows[rowIndex];
                    return (
                      <tr key={`${row[2]}-${rowIndex}`} className="group h-[49px] border-b border-slate-200 hover:bg-violet-50/30">
                        <td className="sticky left-0 z-20 border-r border-slate-200 bg-white px-2 group-hover:bg-[#fbfaff]">
                          <div className="flex min-w-0 items-center gap-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={data.img_urls[rowIndex]} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded border border-slate-100 bg-slate-50 object-cover" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
                            <div className="min-w-0"><div className="truncate font-semibold text-slate-700">{show(row[2])}</div><div className="max-w-[185px] truncate text-[9px] text-slate-400">{data.names[rowIndex]}</div></div>
                          </div>
                        </td>
                        {row.slice(FIRST_DATA_COL).map((value, columnIndex) => <td key={columnIndex} className={`border-r border-slate-200 px-2 text-right tabular-nums whitespace-nowrap last:border-r-0 ${valueTone(data.headers[FIRST_DATA_COL + columnIndex] || "", value)}`}>{show(value)}</td>)}
                      </tr>
                    );
                  })}
                  {rowWindow.end < indices.length ? <tr aria-hidden="true" style={{ height: (indices.length - rowWindow.end) * ROW_HEIGHT }}><td colSpan={data.headers.length} /></tr> : null}
                </tbody>
              </table>

              <div className="space-y-2 p-2 md:hidden">
                {rowWindow.start > 0 ? <div aria-hidden="true" style={{ height: rowWindow.start * ROW_HEIGHT }} /> : null}
                {indices.slice(rowWindow.start, rowWindow.end).map((rowIndex) => {
                  const row = data.rows[rowIndex];
                  return (
                    <article key={`${row[2]}-${rowIndex}`} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={data.img_urls[rowIndex]} alt="" loading="lazy" className="h-10 w-10 rounded bg-slate-50 object-cover" />
                        <div className="min-w-0"><div className="truncate text-xs font-semibold text-slate-800">{show(row[2])}</div><div className="truncate text-[10px] text-slate-400">{data.names[rowIndex]}</div></div>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                        {data.headers.slice(FIRST_DATA_COL, FIRST_DATA_COL + 6).map((header, index) => <div key={header} className="flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5"><dt className="text-[9px] text-slate-400">{header}</dt><dd className={`text-[10px] font-medium tabular-nums ${valueTone(header, row[FIRST_DATA_COL + index])}`}>{show(row[FIRST_DATA_COL + index])}</dd></div>)}
                      </dl>
                    </article>
                  );
                })}
                {rowWindow.end < indices.length ? <div aria-hidden="true" style={{ height: (indices.length - rowWindow.end) * ROW_HEIGHT }} /> : null}
              </div>
            </div>
          </div>
        )}
      </div>

      {solverOpen ? (
        <>
          <button type="button" aria-label="Закрыть калькулятор цены" onClick={() => setSolverOpen(false)} className="fixed inset-0 z-[79] bg-slate-950/25" />
          <aside role="dialog" aria-modal="true" aria-label="Калькулятор цены" className="fixed bottom-0 right-0 top-[54px] z-[80] flex w-full max-w-[920px] flex-col border-l border-slate-200 bg-[#f6f7f9] shadow-2xl">
            <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-violet-100 text-violet-700"><Calculator className="h-4 w-4" /></span>
              <div className="min-w-0"><h2 className="text-sm font-bold text-slate-800">Калькулятор цены</h2><p className="truncate text-[10px] text-slate-400">Цена под целевую маржу · {activeCabinet?.name ?? "все кабинеты"}</p></div>
              <button type="button" onClick={() => setSolverOpen(false)} aria-label="Закрыть" className="ml-auto grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:h-10 sm:w-10"><X className="h-4 w-4" /></button>
            </div>
            <div className="border-b border-slate-200 px-4 py-2 text-[11px] leading-4 text-slate-500">Обратный расчёт: какая цена нужна под 15 / 25 / 35% маржи и насколько она отличается от текущей.</div>
            <div className="min-h-0 flex-1 p-3">
              {solverLoading ? <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> Считаем цены по SKU…</div> : null}
              {solverError ? <WbErrorState message={solverError} /> : null}
              {!solverLoading && !solverError && solver && solver.items.length === 0 ? <WbEmptyState>Нужны себестоимость и заказы по SKU.</WbEmptyState> : null}
              {!solverLoading && !solverError && solver && solver.items.length ? (
                <div className="h-full max-h-[calc(100vh-155px)] overflow-auto rounded-xl border border-slate-200 bg-white" onScroll={(event) => updateSolverWindow(event.currentTarget)}>
                  <table className="w-full min-w-[760px] border-collapse text-[11px]">
                    <thead className="sticky top-0 z-20 bg-slate-50 text-slate-500"><tr className="h-[34px]"><th className="sticky left-0 z-30 min-w-[180px] border-b border-r border-slate-200 bg-slate-50 px-3 text-left">Артикул</th><th className="border-b border-r border-slate-200 px-2 text-right">Себест.</th><th className="border-b border-r border-slate-200 px-2 text-right">Выручка/ед</th><th className="border-b border-r border-slate-200 px-2 text-right">Тек. маржа</th>{solver.margins.map((margin) => <th key={margin} className="border-b border-r border-slate-200 px-2 text-right last:border-r-0">под {margin}%</th>)}</tr></thead>
                    <tbody>
                      {solverWindow.start > 0 ? <tr aria-hidden="true" style={{ height: solverWindow.start * SOLVER_ROW_HEIGHT }}><td colSpan={4 + solver.margins.length} /></tr> : null}
                      {solver.items.slice(solverWindow.start, solverWindow.end).map((item) => <tr key={item.nm} className="h-[43px] border-b border-slate-100 hover:bg-violet-50/25"><td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-3 font-semibold text-slate-700">{item.article || item.nm}</td><td className="border-r border-slate-100 px-2 text-right tabular-nums text-slate-600">{rub(item.cogs)}</td><td className="border-r border-slate-100 px-2 text-right tabular-nums text-slate-600">{rub(item.currentRevenue)}</td><td className={`border-r border-slate-100 px-2 text-right tabular-nums font-semibold ${item.currentMarginPct != null && item.currentMarginPct < 15 ? "text-rose-600" : "text-emerald-700"}`}>{item.currentMarginPct == null ? "—" : `${item.currentMarginPct}%`}</td>{solver.margins.map((margin) => { const target = item.targets.find((candidate) => candidate.margin === margin); if (!target?.reachable) return <td key={margin} className="border-r border-slate-100 px-2 text-right text-slate-300">—</td>; const price = target.neededCatalogPrice ?? target.neededRevenue; return <td key={margin} className="border-r border-slate-100 px-2 text-right tabular-nums last:border-r-0"><span className="font-semibold text-slate-700">{rub(price)}</span>{target.deltaPct != null ? <span className={`ml-1 text-[9px] ${target.deltaPct > 0 ? "text-emerald-600" : target.deltaPct < 0 ? "text-rose-600" : "text-slate-400"}`}>({target.deltaPct > 0 ? "+" : ""}{target.deltaPct}%)</span> : null}</td>; })}</tr>)}
                      {solverWindow.end < solver.items.length ? <tr aria-hidden="true" style={{ height: (solver.items.length - solverWindow.end) * SOLVER_ROW_HEIGHT }}><td colSpan={4 + solver.margins.length} /></tr> : null}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
