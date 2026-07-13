"use client";
/* eslint-disable @next/next/no-img-element */

import { CheckCircle2, Loader2, MessageSquareText, RefreshCw, Search, Star, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonCards, useElapsedSeconds } from "@/components/ui/LoadingState";
import { useCategoryMap } from "@/lib/useCategoryMap";
import { formatTime } from "@/lib/analytics/format";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import type { ReviewRow } from "@/app/api/reviews/route";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

interface ReviewsKpi {
  avgRating30d: number | null;
  count30d: number;
  unansweredTotal: number;
  critical7d: number;
}

interface ReviewsData {
  ok: boolean;
  rows: ReviewRow[];
  kpi: ReviewsKpi;
  hasMore: boolean;
  lastSyncError?: string | null;
  error?: string;
}

type Answered = "" | "answered" | "unanswered";
const ROW_HEIGHT = 92;

function ratingTone(value: number) {
  if (value >= 4) return "text-emerald-700";
  if (value === 3) return "text-amber-600";
  return "text-rose-600";
}

export function WbReviewsPage() {
  const { activeCabinet, cabinetId, cabinets, ready, loading: cabinetsLoading, error: cabinetsError } = useWbCabinet();
  const [days, setDays] = useState(30);
  const [rating, setRating] = useState<number | null>(null);
  const [answered, setAnswered] = useState<Answered>("");
  const [data, setData] = useState<ReviewsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rowWindow, setRowWindow] = useState({ start: 0, end: 12 });
  const requestId = useRef(0);
  const elapsed = useElapsedSeconds(loading);
  const { categories, byArticle } = useCategoryMap();

  const load = useCallback(() => {
    if (!ready || cabinetsLoading) return undefined;
    if (cabinets.length === 0) {
      setLoading(false);
      setError(cabinetsError || "Подключите хотя бы один активный WB-кабинет в настройках");
      return undefined;
    }
    const controller = new AbortController();
    const current = ++requestId.current;
    const params = new URLSearchParams({ cabinet: cabinetId || "all", days: String(days), limit: "100", offset: "0" });
    if (rating) params.set("rating", String(rating));
    if (answered) params.set("answered", answered);
    setLoading(true);
    setError(null);
    fetch(`/api/reviews?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as ReviewsData;
        if (!response.ok || !body.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then((body) => { if (current === requestId.current) setData(body); })
      .catch((cause: unknown) => { if (current === requestId.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить отзывы"); })
      .finally(() => { if (current === requestId.current) setLoading(false); });
    return controller;
  }, [answered, cabinetId, cabinets.length, cabinetsError, cabinetsLoading, days, rating, ready]);

  useEffect(() => {
    const controller = load();
    return () => controller?.abort();
  }, [load, retryKey]);

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return (data?.rows ?? []).filter((row) => {
      if (category && (category === "__none" ? Boolean(byArticle[row.article]) : byArticle[row.article] !== category)) return false;
      return !needle || `${row.nmId} ${row.article} ${row.productName ?? ""} ${row.brandName ?? ""} ${row.text ?? ""}`.toLocaleLowerCase("ru-RU").includes(needle);
    });
  }, [byArticle, category, data?.rows, query]);

  useEffect(() => {
    if (!rows.some((row) => row.id === selectedId)) setSelectedId(rows[0]?.id ?? null);
    setRowWindow({ start: 0, end: Math.min(12, rows.length) });
  }, [rows, selectedId]);

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const updateWindow = (element: HTMLElement) => {
    const first = Math.floor(element.scrollTop / ROW_HEIGHT);
    const visible = Math.ceil(element.clientHeight / ROW_HEIGHT);
    const start = Math.max(0, first - 4);
    const end = Math.min(rows.length, first + visible + 5);
    setRowWindow((current) => current.start === start && current.end === end ? current : { start, end });
  };

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
      <WbModuleHeader
        icon={MessageSquareText}
        title="Отзывы"
        description={data ? `${data.kpi.count30d} за 30 дней · ${data.kpi.unansweredTotal} без ответа` : "Отзывы покупателей Wildberries"}
        actions={<button type="button" onClick={() => setRetryKey((value) => value + 1)} disabled={loading} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-60 sm:min-h-8">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-3.5 w-3.5" />} Обновить</button>}
      />

      <div className="space-y-3 px-2 py-3 sm:px-6">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[["Средний рейтинг", data?.kpi.avgRating30d == null ? "—" : `${data.kpi.avgRating30d} / 5`, "text-emerald-700"], ["Без ответа", data?.kpi.unansweredTotal ?? 0, "text-amber-600"], ["Критично 1–2★", data?.kpi.critical7d ?? 0, (data?.kpi.critical7d ?? 0) ? "text-rose-600" : "text-slate-800"], ["Отзывов за 30 дней", data?.kpi.count30d ?? 0, "text-slate-800"]].map(([label, value, tone]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"><div className="text-[9px] uppercase tracking-wide text-slate-400">{label}</div><div className={`mt-1 text-lg font-bold tabular-nums ${tone}`}>{value}</div></div>)}
        </div>

        {data?.lastSyncError ? <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">Последняя синхронизация отзывов завершилась с ошибкой: {data.lastSyncError}</div> : null}

        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 xl:flex-row xl:items-center">
          <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-0.5">{([null, 5, 4, 3, 2, 1] as const).map((value) => <button key={value ?? "all"} type="button" onClick={() => setRating(value)} className={`min-h-10 rounded-md px-2.5 text-[10px] font-semibold sm:min-h-8 ${rating === value ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{value == null ? "Все" : `${value}★`}</button>)}</div>
          <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-0.5">{([['', 'Все'], ['unanswered', 'Без ответа'], ['answered', 'Отвечено']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setAnswered(value)} className={`min-h-10 rounded-md px-2.5 text-[10px] font-semibold sm:min-h-8 ${answered === value ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{label}</button>)}</div>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">{[7, 30, 90].map((value) => <button key={value} type="button" onClick={() => setDays(value)} className={`min-h-10 rounded-md px-2.5 text-[10px] font-semibold sm:min-h-8 ${days === value ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{value}д</button>)}</div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
            {categories.length ? <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Категория" className="min-h-11 rounded-lg border border-slate-200 px-3 text-xs text-slate-600 outline-none focus:border-violet-400 sm:min-h-9"><option value="">Все категории</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}<option value="__none">Без категории</option></select> : null}
            <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-violet-400 sm:min-h-9"><Search className="h-3.5 w-3.5 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="товар или текст отзыва" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label>
          </div>
        </div>

        {loading ? <div className="rounded-xl border border-slate-200 bg-white p-3"><LoadingBanner seconds={elapsed} hint={`отзывы · ${activeCabinet?.name ?? "все кабинеты"}`} /><SkeletonCards count={6} /></div> : error ? <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} /> : rows.length === 0 ? <WbEmptyState>Нет отзывов по выбранному периоду и фильтрам.</WbEmptyState> : (
          <div className="grid min-h-[500px] gap-3 lg:grid-cols-[390px_minmax(0,1fr)]">
            <section className="h-[calc(100vh-350px)] min-h-[500px] overflow-auto rounded-xl border border-slate-200 bg-white" onScroll={(event) => updateWindow(event.currentTarget)}>
              {rowWindow.start > 0 ? <div aria-hidden="true" style={{ height: rowWindow.start * ROW_HEIGHT }} /> : null}
              {rows.slice(rowWindow.start, rowWindow.end).map((row) => <button type="button" key={row.id} onClick={() => setSelectedId(row.id)} className={`flex h-[92px] w-full items-start gap-2 border-b border-slate-100 px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ${selectedId === row.id ? "bg-violet-50" : "hover:bg-slate-50"}`}><img src={wbCardImageUrl(row.nmId)} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-lg border border-slate-100 bg-slate-50 object-cover" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-[11px] font-semibold text-violet-700">{row.article || row.nmId}</span><span className={`ml-auto flex items-center gap-0.5 text-[10px] font-bold ${ratingTone(row.rating)}`}>{row.rating}<Star className="h-3 w-3 fill-current" /></span></div><div className="mt-0.5 truncate text-[9px] text-slate-400">{row.productName || row.brandName || `nm ${row.nmId}`}</div><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-600">{row.text || row.pros || row.cons || "Отзыв без текста"}</p></div></button>)}
              {rowWindow.end < rows.length ? <div aria-hidden="true" style={{ height: (rows.length - rowWindow.end) * ROW_HEIGHT }} /> : null}
            </section>

            <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
              {selected ? <><div className="flex items-start gap-3 border-b border-slate-100 pb-3"><img src={wbCardImageUrl(selected.nmId)} alt="" className="h-14 w-14 rounded-xl border border-slate-100 object-cover" /><div className="min-w-0"><div className="font-bold text-slate-800">{selected.article || selected.nmId}</div><div className="mt-0.5 text-[11px] text-slate-400">{selected.productName || selected.brandName || `nm ${selected.nmId}`}</div><div className={`mt-1 flex items-center gap-1 text-xs font-semibold ${ratingTone(selected.rating)}`}>{selected.rating}<Star className="h-3.5 w-3.5 fill-current" /></div></div><div className="ml-auto text-right"><div className="text-[10px] text-slate-400">{formatTime(selected.createdAt)}</div>{selected.isAnswered ? <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-semibold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Отвечено</span> : <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[9px] font-semibold ${selected.rating <= 2 ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>Без ответа</span>}</div></div><div className="space-y-3 py-4">{selected.text ? <p className="text-sm leading-6 text-slate-700">{selected.text}</p> : <p className="text-sm italic text-slate-400">Отзыв без текста</p>}{selected.pros ? <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800"><span className="font-semibold">Достоинства:</span> {selected.pros}</div> : null}{selected.cons ? <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800"><span className="font-semibold">Недостатки:</span> {selected.cons}</div> : null}{selected.hasVideo ? <div className="flex items-center gap-1 text-[10px] text-slate-500"><Video className="h-3.5 w-3.5" /> Покупатель приложил видео</div> : null}{selected.photos.length ? <div className="flex flex-wrap gap-2">{selected.photos.map((photo, index) => photo.mini ? <a key={`${photo.mini}-${index}`} href={photo.full || photo.mini} target="_blank" rel="noreferrer"><img src={photo.mini} alt={`Фото отзыва ${index + 1}`} loading="lazy" className="h-20 w-20 rounded-lg border border-slate-200 object-cover transition-opacity hover:opacity-80" /></a> : null)}</div> : null}</div>{selected.isAnswered && selected.answerText ? <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-3"><div className="text-[10px] font-semibold uppercase tracking-wide text-violet-600">Ответ продавца</div><p className="mt-1 text-xs leading-5 text-slate-700">{selected.answerText}</p></div> : <div className="rounded-xl border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-400">Ответа продавца ещё нет.</div>}</> : <div className="grid min-h-[400px] place-items-center text-sm text-slate-400">Выберите отзыв слева.</div>}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
