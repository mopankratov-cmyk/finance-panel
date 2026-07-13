"use client";
/* eslint-disable @next/next/no-img-element */

import { ExternalLink, ImageOff, Loader2, PackageSearch, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { useCategoryMap } from "@/lib/useCategoryMap";
import type { PimRow } from "@/lib/wb/cards";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

const ROW_HEIGHT = 50;

function completeness(row: PimRow) {
  const checks = [row.length, row.width, row.height, row.weightBrutto, row.materials, row.photosCount > 0];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function completeTone(value: number) {
  if (value === 100) return "bg-emerald-50 text-emerald-700";
  if (value >= 67) return "bg-amber-50 text-amber-700";
  return "bg-rose-50 text-rose-700";
}

export function WbProductPage() {
  const { activeCabinet, cabinetId, cabinets, ready, loading: cabinetsLoading, error: cabinetsError } = useWbCabinet();
  const [rows, setRows] = useState<PimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [selected, setSelected] = useState<PimRow | null>(null);
  const [rowWindow, setRowWindow] = useState({ start: 0, end: 18 });
  const requestId = useRef(0);
  const drawerRef = useRef<HTMLElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
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
    fetch(`/api/pim?cabinet=${encodeURIComponent(cabinetId || "all")}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { ok?: boolean; rows?: PimRow[]; error?: string };
        if (!response.ok || !body.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        return body.rows ?? [];
      })
      .then((body) => { if (current === requestId.current) setRows(body); })
      .catch((cause: unknown) => { if (current === requestId.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить товары"); })
      .finally(() => { if (current === requestId.current) setLoading(false); });
    return () => controller.abort();
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, ready, retryKey]);

  useEffect(() => {
    if (!selected) return;
    previouslyFocused.current = document.activeElement as HTMLElement;
    const focusables = drawerRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
    focusables?.[0]?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setSelected(null); return; }
      if (event.key !== "Tab" || !focusables?.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
      previouslyFocused.current?.focus();
    };
  }, [selected]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return rows.filter((row) => {
      if (onlyIncomplete && completeness(row) === 100) return false;
      if (category && (category === "__none" ? Boolean(byArticle[row.article]) : byArticle[row.article] !== category)) return false;
      return !needle || `${row.nmId} ${row.article} ${row.name} ${row.brand} ${row.subject}`.toLocaleLowerCase("ru-RU").includes(needle);
    }).sort((a, b) => completeness(a) - completeness(b) || a.article.localeCompare(b.article, "ru"));
  }, [byArticle, category, onlyIncomplete, query, rows]);

  useEffect(() => setRowWindow({ start: 0, end: Math.min(18, filtered.length) }), [filtered.length, query, category, onlyIncomplete]);

  const updateWindow = (element: HTMLDivElement) => {
    const first = Math.floor(Math.max(0, element.scrollTop - 36) / ROW_HEIGHT);
    const visible = Math.ceil(element.clientHeight / ROW_HEIGHT);
    const start = Math.max(0, first - 5);
    const end = Math.min(filtered.length, first + visible + 6);
    setRowWindow((current) => current.start === start && current.end === end ? current : { start, end });
  };

  const completeCount = rows.filter((row) => completeness(row) === 100).length;
  const withoutPhotos = rows.filter((row) => row.photosCount === 0).length;
  const withVideo = rows.filter((row) => row.hasVideo).length;

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
      <WbModuleHeader
        icon={PackageSearch}
        title="Товары / SKU"
        description={rows.length ? `${rows.length} карточек · мастер-данные Content API` : "Медиа, размеры, материалы и готовность карточек"}
        actions={<button type="button" onClick={() => setRetryKey((value) => value + 1)} disabled={loading} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-60 sm:min-h-8">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-3.5 w-3.5" />} Обновить</button>}
      />

      <div className="space-y-3 px-2 py-3 sm:px-6">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[["Всего SKU", rows.length, "text-slate-800"], ["Заполнено 100%", completeCount, "text-emerald-700"], ["Без фото", withoutPhotos, withoutPhotos ? "text-rose-600" : "text-slate-800"], ["С видео", withVideo, "text-violet-700"]].map(([label, value, tone]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"><div className="text-[9px] uppercase tracking-wide text-slate-400">{label}</div><div className={`mt-1 text-lg font-bold tabular-nums ${tone}`}>{value}</div></div>)}
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
          {categories.length ? <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Категория" className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 outline-none focus:border-violet-400 sm:min-h-9"><option value="">Все категории</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}<option value="__none">Без категории</option></select> : null}
          <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-violet-400 sm:min-h-9"><Search className="h-3.5 w-3.5 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="артикул, nm, название, бренд" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs text-slate-600 sm:min-h-9"><input type="checkbox" checked={onlyIncomplete} onChange={(event) => setOnlyIncomplete(event.target.checked)} className="accent-violet-600" /> Только незаполненные</label>
          <span className="px-1 text-xs tabular-nums text-slate-400">{filtered.length} SKU</span>
        </div>

        {loading ? <div className="rounded-xl border border-slate-200 bg-white p-3"><LoadingBanner seconds={elapsed} hint={`товары · ${activeCabinet?.name ?? "все кабинеты"}`} /><SkeletonTableRows rows={10} cols={9} /></div> : error ? <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} /> : filtered.length === 0 ? <WbEmptyState>По выбранным фильтрам карточек нет.</WbEmptyState> : (
          <div className="h-[calc(100vh-300px)] min-h-[420px] overflow-auto rounded-xl border border-slate-200 bg-white" onScroll={(event) => updateWindow(event.currentTarget)}>
            <table className="min-w-[1080px] w-full border-collapse text-[10px]">
              <thead className="sticky top-0 z-20 bg-slate-50"><tr className="h-9 border-b border-slate-200 text-slate-500"><th className="sticky left-0 z-30 min-w-[270px] border-r border-slate-200 bg-slate-50 px-3 text-left">Товар</th><th className="px-3 text-left">Кабинет</th><th className="px-3 text-left">Бренд</th><th className="px-3 text-left">Ниша</th><th className="px-3 text-right">Размеры, см</th><th className="px-3 text-right">Вес, кг</th><th className="px-3 text-left">Материалы</th><th className="px-3 text-right">Фото</th><th className="px-3 text-right">Готовность</th></tr></thead>
              <tbody>
                {rowWindow.start > 0 ? <tr aria-hidden="true"><td colSpan={9} style={{ height: rowWindow.start * ROW_HEIGHT }} /></tr> : null}
                {filtered.slice(rowWindow.start, rowWindow.end).map((row) => {
                  const score = completeness(row);
                  return <tr key={`${row.cabinetId}-${row.nmId}`} onClick={() => setSelected(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(row); } }} className="h-[50px] cursor-pointer border-b border-slate-100 outline-none transition-colors hover:bg-violet-50/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"><td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-3"><div className="flex items-center gap-2">{row.photos[0] ? <img src={row.photos[0]} alt="" loading="lazy" className="h-9 w-9 rounded-lg border border-slate-100 object-cover" /> : <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-300"><ImageOff className="h-4 w-4" /></span>}<div className="min-w-0"><div className="font-semibold text-violet-700">{row.article}</div><div className="max-w-[190px] truncate text-[9px] text-slate-400">{row.name || `nm ${row.nmId}`}</div></div></div></td><td className="px-3 text-slate-500">{row.shop || "WB"}</td><td className="max-w-32 truncate px-3">{row.brand || "—"}</td><td className="max-w-40 truncate px-3">{row.subject || "—"}</td><td className="px-3 text-right tabular-nums">{row.length && row.width && row.height ? `${row.length}×${row.width}×${row.height}` : "—"}</td><td className="px-3 text-right tabular-nums">{row.weightBrutto ?? "—"}</td><td className="max-w-48 truncate px-3">{row.materials || <span className="text-amber-600">не указано</span>}</td><td className={`px-3 text-right font-semibold tabular-nums ${row.photosCount === 0 ? "text-rose-600" : row.photosCount < 3 ? "text-amber-600" : "text-emerald-700"}`}>{row.photosCount}</td><td className="px-3 text-right"><span className={`rounded-full px-2 py-1 font-semibold tabular-nums ${completeTone(score)}`}>{score}%</span></td></tr>;
                })}
                {rowWindow.end < filtered.length ? <tr aria-hidden="true"><td colSpan={9} style={{ height: (filtered.length - rowWindow.end) * ROW_HEIGHT }} /></tr> : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected ? <><button type="button" aria-label="Закрыть карточку товара" onClick={() => setSelected(null)} className="fixed inset-0 z-[79] bg-slate-950/40" /><aside ref={drawerRef} role="dialog" aria-modal="true" aria-label={`Товар ${selected.article}`} className="fixed bottom-0 right-0 top-[54px] z-[80] flex w-full max-w-[620px] flex-col border-l border-slate-200 bg-[#f6f7f9] shadow-2xl"><div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3"><div className="min-w-0"><div className="truncate text-sm font-bold text-slate-800">{selected.article}</div><div className="truncate text-[11px] text-slate-400">{selected.name || `nm ${selected.nmId}`}</div></div><a href={selected.wbUrl} target="_blank" rel="noreferrer" className="ml-auto hidden min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-[10px] font-semibold text-violet-700 hover:bg-violet-50 sm:inline-flex">Открыть на WB <ExternalLink className="h-3.5 w-3.5" /></a><button type="button" onClick={() => setSelected(null)} aria-label="Закрыть" className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button></div><div className="min-h-0 flex-1 overflow-auto p-4"><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[["Готовность", `${completeness(selected)}%`], ["Кабинет", selected.shop || "WB"], ["Бренд", selected.brand || "—"], ["Ниша", selected.subject || "—"], ["Размеры", selected.length && selected.width && selected.height ? `${selected.length}×${selected.width}×${selected.height} см` : "—"], ["Вес брутто", selected.weightBrutto ? `${selected.weightBrutto} кг` : "—"]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[9px] uppercase text-slate-400">{label}</div><div className="mt-1 text-xs font-semibold text-slate-700">{value}</div></div>)}</div><div className="mt-3 rounded-xl border border-slate-200 bg-white p-3"><div className="text-[9px] uppercase text-slate-400">Материалы / состав</div><div className="mt-1 text-sm text-slate-700">{selected.materials || "Не заполнено"}</div></div><div className="mt-3"><div className="mb-2 flex items-center justify-between"><h2 className="text-xs font-bold text-slate-700">Медиа карточки</h2><span className="text-[10px] text-slate-400">{selected.photosCount} фото{selected.hasVideo ? " · есть видео" : ""}</span></div>{selected.photos.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{selected.photos.map((photo, index) => <img key={`${photo}-${index}`} src={photo} alt={`Фото ${index + 1}`} loading="lazy" className="aspect-[3/4] w-full rounded-xl border border-slate-200 bg-white object-cover" />)}</div> : <WbEmptyState>В карточке нет фотографий.</WbEmptyState>}</div></div></aside></> : null}
    </div>
  );
}
