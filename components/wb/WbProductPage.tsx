"use client";
/* eslint-disable @next/next/no-img-element */

import { AlertTriangle, CheckCircle2, ExternalLink, FolderOpen, History, ImageOff, Loader2, MessageSquare, PackageSearch, RefreshCw, Save, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { formatTime } from "@/lib/analytics/format";
import { readApiResponse } from "@/lib/http/readApiResponse";
import { useCategoryMap } from "@/lib/useCategoryMap";
import type { PimRow } from "@/lib/wb/cards";
import { productReadiness, PRODUCT_READINESS_STATUSES, readinessStatusLabel, type ProductReadinessStatus } from "@/lib/wb/productReadiness";
import { WbProductImage } from "./WbProductImage";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

const ROW_HEIGHT = 50;

function completeness(row: PimRow) {
  return productReadiness(row).score;
}

function completeTone(value: number) {
  if (value === 100) return "bg-emerald-50 text-emerald-700";
  if (value >= 67) return "bg-amber-50 text-amber-700";
  return "bg-rose-50 text-rose-700";
}

function statusTone(status: ProductReadinessStatus) {
  if (status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "in_progress") return "border-violet-200 bg-violet-50 text-violet-700";
  if (status === "blocked") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

interface ProductNoteHistory {
  id: number | string;
  action: string;
  actor: string | null;
  after: { readinessStatus: ProductReadinessStatus; comment: string; driveUrl: string | null } | null;
  createdAt: string;
}

export function WbProductPage() {
  const { activeCabinet, cabinetId, cabinets, canWrite, ready, loading: cabinetsLoading, error: cabinetsError } = useWbCabinet();
  const [rows, setRows] = useState<PimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [notesReady, setNotesReady] = useState(true);
  const [selected, setSelected] = useState<PimRow | null>(null);
  const [draftStatus, setDraftStatus] = useState<ProductReadinessStatus>("pending");
  const [draftComment, setDraftComment] = useState("");
  const [draftDriveUrl, setDraftDriveUrl] = useState("");
  const [history, setHistory] = useState<ProductNoteHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [saving, setSaving] = useState<string | null>(null);
  const [noteMessage, setNoteMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [rowWindow, setRowWindow] = useState({ start: 0, end: 18 });
  const requestId = useRef(0);
  const drawerRef = useRef<HTMLElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const elapsed = useElapsedSeconds(loading);
  const { categories, byArticle } = useCategoryMap();
  const drawerOpen = selected !== null;
  const selectedCabinetId = selected?.cabinetId ?? null;
  const selectedNmId = selected?.nmId ?? null;

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
        const body = await readApiResponse<{ ok?: boolean; rows?: PimRow[]; notesReady?: boolean; error?: string }>(response, "Товары WB");
        if (!response.ok || !body.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        return { rows: body.rows ?? [], notesReady: body.notesReady !== false };
      })
      .then((body) => { if (current === requestId.current) { setRows(body.rows); setNotesReady(body.notesReady); } })
      .catch((cause: unknown) => { if (current === requestId.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить товары"); })
      .finally(() => { if (current === requestId.current) setLoading(false); });
    return () => controller.abort();
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, ready, retryKey]);

  useEffect(() => {
    if (!drawerOpen) return;
    previouslyFocused.current = document.activeElement as HTMLElement;
    const focusables = drawerRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])");
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
      previouslyFocused.current?.focus({ preventScroll: true });
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!noteMessage?.ok) return;
    const timeout = window.setTimeout(() => setNoteMessage(null), 5_000);
    return () => window.clearTimeout(timeout);
  }, [noteMessage]);

  useEffect(() => {
    if (!selectedNmId) { setHistory([]); setHistoryLoading(false); return; }
    if (!notesReady || !selectedCabinetId) { setHistory([]); setHistoryLoading(false); return; }
    const controller = new AbortController();
    setHistoryLoading(true);
    fetch(`/api/pim/${selectedNmId}/history?cabinet=${encodeURIComponent(selectedCabinetId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await readApiResponse<{ data?: { history?: ProductNoteHistory[] }; error?: string }>(response, "История товара WB");
        if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
        return body.data?.history ?? [];
      })
      .then(setHistory)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setNoteMessage({ ok: false, text: cause instanceof Error ? cause.message : "Не удалось загрузить историю" }); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [historyRefreshKey, notesReady, selectedCabinetId, selectedNmId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return rows.filter((row) => {
      if (onlyIncomplete && completeness(row) === 100) return false;
      if (statusFilter && (row.readinessStatus ?? "pending") !== statusFilter) return false;
      if (category && (category === "__none" ? Boolean(byArticle[row.article]) : byArticle[row.article] !== category)) return false;
      return !needle || `${row.nmId} ${row.article} ${row.name} ${row.brand} ${row.subject}`.toLocaleLowerCase("ru-RU").includes(needle);
    }).sort((a, b) => completeness(a) - completeness(b) || a.article.localeCompare(b.article, "ru"));
  }, [byArticle, category, onlyIncomplete, query, rows, statusFilter]);

  useEffect(() => setRowWindow({ start: 0, end: Math.min(18, filtered.length) }), [filtered.length, query, category, onlyIncomplete, statusFilter]);

  const updateWindow = (element: HTMLDivElement) => {
    const first = Math.floor(Math.max(0, element.scrollTop - 36) / ROW_HEIGHT);
    const visible = Math.ceil(element.clientHeight / ROW_HEIGHT);
    const start = Math.max(0, first - 5);
    const end = Math.min(filtered.length, first + visible + 6);
    setRowWindow((current) => current.start === start && current.end === end ? current : { start, end });
  };

  const completeCount = rows.filter((row) => completeness(row) === 100).length;
  const readyCount = rows.filter((row) => row.readinessStatus === "ready" && completeness(row) === 100).length;
  const incompleteCount = rows.length - completeCount;
  const commentCount = rows.filter((row) => Boolean(row.comment?.trim())).length;
  const selectedReadiness = selected ? productReadiness(selected) : null;
  const selectedEditable = Boolean(selected && notesReady && canWrite && selected.cabinetId === cabinetId);

  const openRow = (row: PimRow) => {
    setNoteMessage(null);
    setDraftStatus(row.readinessStatus ?? "pending");
    setDraftComment(row.comment ?? "");
    setDraftDriveUrl(row.driveUrl ?? "");
    setSelected(row);
  };

  const updateNote = async (row: PimRow, patch: { status?: ProductReadinessStatus; comment?: string; driveUrl?: string }) => {
    if (!notesReady || !canWrite || !row.cabinetId || row.cabinetId !== cabinetId) {
      setNoteMessage({ ok: false, text: "Для изменения выберите один кабинет в верхней панели" });
      return;
    }
    const key = `${row.cabinetId}:${row.nmId}`;
    setSaving(key); setNoteMessage(null);
    try {
      const response = await fetch("/api/pim", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        cabinetId: row.cabinetId,
        nmId: row.nmId,
        article: row.article,
        status: patch.status ?? row.readinessStatus ?? "pending",
        comment: patch.comment ?? row.comment ?? "",
        driveUrl: patch.driveUrl ?? row.driveUrl ?? "",
      }) });
      const body = await readApiResponse<{ ok?: boolean; note?: Partial<PimRow>; error?: string }>(response, "Сохранение товара WB");
      if (!response.ok || !body.ok || !body.note) throw new Error(body.error || `Ошибка ${response.status}`);
      const updated = { ...row, ...body.note };
      setRows((current) => current.map((item) => item.cabinetId === row.cabinetId && item.nmId === row.nmId ? { ...item, ...body.note } : item));
      setSelected((current) => current?.cabinetId === row.cabinetId && current.nmId === row.nmId ? { ...current, ...body.note } : current);
      setDraftStatus(updated.readinessStatus ?? "pending");
      setDraftComment(updated.comment ?? "");
      setDraftDriveUrl(updated.driveUrl ?? "");
      setNoteMessage({ ok: true, text: "Статус карточки сохранён с автором и временем" });
      if (selected?.cabinetId === row.cabinetId && selected.nmId === row.nmId) setHistoryRefreshKey((value) => value + 1);
    } catch (cause) {
      setNoteMessage({ ok: false, text: cause instanceof Error ? cause.message : "Не удалось сохранить карточку" });
    } finally { setSaving(null); }
  };

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
      <WbModuleHeader
        icon={PackageSearch}
        title="Товары / SKU"
        description={rows.length ? `${rows.length} карточек · мастер-данные Content API` : "Медиа, размеры, материалы и готовность карточек"}
        actions={<button type="button" onClick={() => setRetryKey((value) => value + 1)} disabled={loading} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-60 sm:min-h-8">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-3.5 w-3.5" />} Обновить</button>}
      />

      <div className="space-y-3 px-2 py-3 sm:px-6">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          {[["Всего SKU", rows.length, "text-slate-800"], ["Content 100%", completeCount, "text-emerald-700"], ["Готово вручную", readyCount, "text-violet-700"], ["Нужно заполнить", incompleteCount, incompleteCount ? "text-rose-600" : "text-slate-800"], ["С комментариями", commentCount, "text-blue-700"]].map(([label, value, tone]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"><div className="text-[9px] uppercase tracking-wide text-slate-400">{label}</div><div className={`mt-1 text-lg font-bold tabular-nums ${tone}`}>{value}</div></div>)}
        </div>

        {!notesReady ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Примените миграцию 20260713_wb_product_notes.sql. Content API доступен, но статусы и комментарии пока только для чтения.</div> : null}
        {!selected && noteMessage ? <div role="status" aria-live="polite" className={`rounded-xl border p-3 text-xs ${noteMessage.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{noteMessage.text}</div> : null}

        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
          {categories.length ? <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Категория" className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 outline-none focus:border-violet-400 sm:min-h-9"><option value="">Все категории</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}<option value="__none">Без категории</option></select> : null}
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Статус готовности" className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 outline-none focus:border-violet-400 sm:min-h-9"><option value="">Все статусы</option>{PRODUCT_READINESS_STATUSES.map((status) => <option key={status} value={status}>{readinessStatusLabel(status)}</option>)}</select>
          <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-violet-400 sm:min-h-9"><Search className="h-3.5 w-3.5 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="артикул, nm, название, бренд" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs text-slate-600 sm:min-h-9"><input type="checkbox" checked={onlyIncomplete} onChange={(event) => setOnlyIncomplete(event.target.checked)} className="accent-violet-600" /> Только незаполненные</label>
          <span className="px-1 text-xs tabular-nums text-slate-400">{filtered.length} SKU</span>
        </div>

        {loading ? <div className="rounded-xl border border-slate-200 bg-white p-3"><LoadingBanner seconds={elapsed} hint={`товары · ${activeCabinet?.name ?? "все кабинеты"}`} /><SkeletonTableRows rows={10} cols={11} /></div> : error ? <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} /> : filtered.length === 0 ? <WbEmptyState>По выбранным фильтрам карточек нет.</WbEmptyState> : (
          <div className="h-[calc(100vh-300px)] min-h-[420px] overflow-auto rounded-xl border border-slate-200 bg-white" onScroll={(event) => updateWindow(event.currentTarget)}>
            <table className="min-w-[1380px] w-full border-collapse text-[10px]">
              <thead className="sticky top-0 z-20 bg-slate-50"><tr className="h-9 border-b border-slate-200 text-slate-500"><th className="sticky left-0 z-30 min-w-[270px] border-r border-slate-200 bg-slate-50 px-3 text-left">Товар</th><th className="px-3 text-left">Статус</th><th className="px-3 text-left">Комментарий</th><th className="px-3 text-left">Кабинет</th><th className="px-3 text-left">Бренд</th><th className="px-3 text-left">Ниша</th><th className="px-3 text-right">Размеры, см</th><th className="px-3 text-right">Вес, кг</th><th className="px-3 text-left">Материалы</th><th className="px-3 text-right">Фото</th><th className="px-3 text-right">Content</th></tr></thead>
              <tbody>
                {rowWindow.start > 0 ? <tr aria-hidden="true"><td colSpan={11} style={{ height: rowWindow.start * ROW_HEIGHT }} /></tr> : null}
                {filtered.slice(rowWindow.start, rowWindow.end).map((row) => {
                  const score = completeness(row);
                  const status = row.readinessStatus ?? "pending";
                  const rowBusy = saving === `${row.cabinetId}:${row.nmId}`;
                  const editable = notesReady && canWrite && row.cabinetId === cabinetId;
                  return <tr key={`${row.cabinetId}-${row.nmId}`} onClick={() => openRow(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openRow(row); } }} className="h-[50px] cursor-pointer border-b border-slate-100 outline-none transition-colors hover:bg-violet-50/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"><td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-3"><div className="flex items-center gap-2">{row.photos[0] ? <WbProductImage nm={row.nmId} src={row.photos[0]} className="h-9 w-9 shrink-0 rounded-lg border border-slate-100 bg-slate-100 object-cover" /> : <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-300"><ImageOff className="h-4 w-4" /></span>}<div className="min-w-0"><div className="font-semibold text-violet-700">{row.article}</div><div className="max-w-[190px] truncate text-[9px] text-slate-400">{row.name || `nm ${row.nmId}`}</div></div></div></td><td className="px-3"><select aria-label={`Статус готовности ${row.article}`} value={status} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onChange={(event) => { event.stopPropagation(); void updateNote(row, { status: event.target.value as ProductReadinessStatus }); }} disabled={!editable || rowBusy} className={`min-h-11 rounded-lg border px-2 text-[10px] font-semibold outline-none focus:ring-2 focus:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-70 sm:min-h-9 ${statusTone(status)}`}>{PRODUCT_READINESS_STATUSES.map((item) => <option key={item} value={item}>{readinessStatusLabel(item)}</option>)}</select></td><td className="max-w-[220px] px-3"><div className="flex items-center gap-1.5"><MessageSquare className={`h-3.5 w-3.5 shrink-0 ${row.comment ? "text-blue-500" : "text-slate-300"}`} /><span className="truncate text-slate-500">{row.comment || "Добавить в карточке"}</span></div>{row.noteUpdatedAt ? <div className="mt-0.5 truncate text-[9px] text-slate-300">{row.noteUpdatedBy || "—"} · {formatTime(row.noteUpdatedAt)}</div> : null}</td><td className="px-3 text-slate-500">{row.shop || "WB"}</td><td className="max-w-32 truncate px-3">{row.brand || "—"}</td><td className="max-w-40 truncate px-3">{row.subject || "—"}</td><td className="px-3 text-right tabular-nums">{row.length && row.width && row.height ? `${row.length}×${row.width}×${row.height}` : "—"}</td><td className="px-3 text-right tabular-nums">{row.weightBrutto ?? "—"}</td><td className="max-w-48 truncate px-3">{row.materials || <span className="text-amber-600">не указано</span>}</td><td className={`px-3 text-right font-semibold tabular-nums ${row.photosCount === 0 ? "text-rose-600" : row.photosCount < 3 ? "text-amber-600" : "text-emerald-700"}`}>{row.photosCount}</td><td className="px-3 text-right"><span className={`rounded-full px-2 py-1 font-semibold tabular-nums ${completeTone(score)}`}>{score}%</span></td></tr>;
                })}
                {rowWindow.end < filtered.length ? <tr aria-hidden="true"><td colSpan={11} style={{ height: (filtered.length - rowWindow.end) * ROW_HEIGHT }} /></tr> : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && selectedReadiness ? <>
        <button type="button" aria-label="Закрыть карточку товара" onClick={() => setSelected(null)} className="fixed inset-0 z-[79] bg-slate-950/40" />
        <aside ref={drawerRef} role="dialog" aria-modal="true" aria-label={`Товар ${selected.article}`} className="fixed bottom-0 right-0 top-[54px] z-[80] flex w-full max-w-[620px] flex-col border-l border-slate-200 bg-[#f6f7f9] shadow-2xl">
          <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
            <div className="min-w-0"><div className="truncate text-sm font-bold text-slate-800">{selected.article}</div><div className="truncate text-[11px] text-slate-400">{selected.name || `nm ${selected.nmId}`}</div></div>
            <div className="ml-auto hidden items-center gap-2 sm:flex">{selected.driveUrl ? <a href={selected.driveUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-blue-200 px-3 text-[10px] font-semibold text-blue-700 hover:bg-blue-50"><FolderOpen className="h-3.5 w-3.5" /> Drive</a> : null}<a href={selected.wbUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-[10px] font-semibold text-violet-700 hover:bg-violet-50">WB <ExternalLink className="h-3.5 w-3.5" /></a></div>
            <button type="button" onClick={() => setSelected(null)} aria-label="Закрыть" className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3 sm:p-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{[["Content", `${selectedReadiness.score}%`], ["Статус", readinessStatusLabel(selected.readinessStatus ?? "pending")], ["Кабинет", selected.shop || "WB"], ["Бренд", selected.brand || "—"], ["Размеры", selected.length && selected.width && selected.height ? `${selected.length}×${selected.width}×${selected.height} см` : "—"], ["Вес брутто", selected.weightBrutto ? `${selected.weightBrutto} кг` : "—"]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[9px] uppercase text-slate-400">{label}</div><div className="mt-1 text-xs font-semibold text-slate-700">{value}</div></div>)}</div>

            {selectedReadiness.missing.length ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="flex items-center gap-1.5 text-xs font-bold text-amber-800"><AlertTriangle className="h-4 w-4" /> Что мешает готовности</div><div className="mt-2 flex flex-wrap gap-1.5">{selectedReadiness.missing.map((item) => <span key={item} className="rounded-full border border-amber-200 bg-white px-2 py-1 text-[10px] font-semibold text-amber-700">{item}</span>)}</div></div> : <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" />Мастер-данные Content API заполнены полностью.</div>}

            <section className="rounded-xl border border-slate-200 bg-white p-3" aria-labelledby="product-work-title">
              <div className="flex items-center justify-between gap-2"><div><h2 id="product-work-title" className="text-xs font-bold text-slate-800">Работа над карточкой</h2><p className="mt-0.5 text-[10px] text-slate-400">Статус, комментарий и папка — отдельно для кабинета.</p></div>{selected.noteUpdatedAt ? <span className="text-right text-[9px] text-slate-400">{selected.noteUpdatedBy || "—"}<br />{formatTime(selected.noteUpdatedAt)}</span> : null}</div>
              {!selectedEditable ? <div className="mt-3 rounded-lg bg-amber-50 p-2 text-[10px] text-amber-700">Выберите кабинет «{selected.shop || "WB"}» в верхней панели, чтобы редактировать.</div> : null}
              <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-[10px] font-semibold text-slate-500">Статус<select aria-label="Статус карточки" value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as ProductReadinessStatus)} disabled={!selectedEditable || Boolean(saving)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-violet-400 disabled:opacity-60">{PRODUCT_READINESS_STATUSES.map((status) => <option key={status} value={status}>{readinessStatusLabel(status)}</option>)}</select></label><label className="text-[10px] font-semibold text-slate-500">Папка Google Drive<input aria-label="Папка Google Drive" type="url" value={draftDriveUrl} onChange={(event) => setDraftDriveUrl(event.target.value)} placeholder="https://drive.google.com/drive/folders/…" disabled={!selectedEditable || Boolean(saving)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-violet-400 disabled:opacity-60" /></label></div>
              <label className="mt-3 block text-[10px] font-semibold text-slate-500">Комментарий<textarea aria-label="Комментарий по карточке" value={draftComment} onChange={(event) => setDraftComment(event.target.value.slice(0, 4000))} rows={4} placeholder="Что нужно исправить, кто делает, следующий шаг…" disabled={!selectedEditable || Boolean(saving)} className="mt-1 w-full resize-y rounded-lg border border-slate-200 p-3 text-xs leading-5 outline-none focus:border-violet-400 disabled:opacity-60" /></label>
              <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={() => void updateNote(selected, { status: draftStatus, comment: draftComment, driveUrl: draftDriveUrl })} disabled={!selectedEditable || Boolean(saving)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Save className="h-4 w-4" />} Сохранить</button>{selected.driveUrl ? <a href={selected.driveUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-blue-200 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50"><FolderOpen className="h-4 w-4" />Открыть папку</a> : null}</div>
              {noteMessage ? <div role="status" aria-live="polite" className={`mt-3 rounded-lg border p-2 text-[10px] ${noteMessage.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>{noteMessage.text}</div> : null}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-3" aria-labelledby="product-history-title"><div className="flex items-center gap-1.5"><History className="h-4 w-4 text-slate-400" /><h2 id="product-history-title" className="text-xs font-bold text-slate-800">История изменений</h2></div>{historyLoading ? <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />Загружаю…</div> : history.length ? <div className="mt-3 space-y-2">{history.map((entry) => <div key={entry.id} className="border-l-2 border-violet-200 pl-3"><div className="flex flex-wrap items-center gap-1.5 text-[10px]"><span className="font-semibold text-slate-700">{entry.after ? readinessStatusLabel(entry.after.readinessStatus) : entry.action}</span><span className="text-slate-400">{entry.actor || "система"} · {formatTime(entry.createdAt)}</span></div>{entry.after?.comment ? <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-500">{entry.after.comment}</p> : null}</div>)}</div> : <div className="mt-3 text-[10px] text-slate-400">Изменений пока нет.</div>}</section>

            <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[9px] uppercase text-slate-400">Материалы / состав</div><div className="mt-1 text-sm text-slate-700">{selected.materials || "Не заполнено"}</div></div>
            <div><div className="mb-2 flex items-center justify-between"><h2 className="text-xs font-bold text-slate-700">Медиа карточки</h2><span className="text-[10px] text-slate-400">{selected.photosCount} фото{selected.hasVideo ? " · есть видео" : ""}</span></div>{selected.photos.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{selected.photos.map((photo, index) => <img key={`${photo}-${index}`} src={photo} alt={`Фото ${index + 1}`} loading="lazy" className="aspect-[3/4] w-full rounded-xl border border-slate-200 bg-white object-cover" />)}</div> : <WbEmptyState>В карточке нет фотографий.</WbEmptyState>}</div>
          </div>
        </aside>
      </> : null}
    </div>
  );
}
