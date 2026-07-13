"use client";

import { FlaskConical, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { useCategoryMap } from "@/lib/useCategoryMap";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

interface CtrItem {
  nm: number;
  art: string;
  views: number;
  spend: number;
  ctr: number | null;
  cpc: number | null;
  drr: number | null;
  stock: number;
}

interface CtrData {
  items: CtrItem[];
  count: number;
  days: number;
  error?: string;
}

const ROW_HEIGHT = 44;
const number = (value: number | null) => value == null ? "—" : Math.round(value).toLocaleString("ru-RU");
const percent = (value: number | null) => value == null ? "—" : `${Math.round(value * 100) / 100}%`;

function metricTone(value: number | null, good: number, medium: number) {
  if (value == null) return "text-slate-400";
  if (value >= good) return "text-emerald-700";
  if (value >= medium) return "text-amber-600";
  return "font-semibold text-rose-600";
}

export function WbCtrPage() {
  const { activeCabinet, cabinetId, cabinets, ready, loading: cabinetsLoading, error: cabinetsError } = useWbCabinet();
  const [days, setDays] = useState(7);
  const [data, setData] = useState<CtrData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [rowWindow, setRowWindow] = useState({ start: 0, end: 18 });
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
    setLoading(true);
    setError(null);
    fetch(`/api/ctrtest/adv-analysis?days=${days}&cabinet=${encodeURIComponent(cabinetId || "all")}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as CtrData;
        if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then((body) => {
        if (current !== requestId.current) return;
        if (body.error) throw new Error(body.error);
        setData(body);
      })
      .catch((cause: unknown) => {
        if (current === requestId.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить CTR-аналитику");
      })
      .finally(() => { if (current === requestId.current) setLoading(false); });
    return () => controller.abort();
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, days, ready, retryKey]);

  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return (data?.items ?? []).filter((item) => {
      if (category && (category === "__none" ? Boolean(byArticle[item.art]) : byArticle[item.art] !== category)) return false;
      return !needle || `${item.nm} ${item.art}`.toLocaleLowerCase("ru-RU").includes(needle);
    });
  }, [byArticle, category, data?.items, query]);

  useEffect(() => setRowWindow({ start: 0, end: Math.min(18, items.length) }), [items.length, query, category]);

  const updateWindow = (element: HTMLDivElement) => {
    const first = Math.floor(Math.max(0, element.scrollTop - 36) / ROW_HEIGHT);
    const visible = Math.ceil(element.clientHeight / ROW_HEIGHT);
    const start = Math.max(0, first - 5);
    const end = Math.min(items.length, first + visible + 6);
    setRowWindow((current) => current.start === start && current.end === end ? current : { start, end });
  };

  const candidates = items.filter((item) => item.views >= 1000 && (item.ctr ?? 0) < 3).length;

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
      <WbModuleHeader
        icon={FlaskConical}
        title="Тестирование CTR"
        description="A/B-тесты главного фото: вариант → период → замер → победитель"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex min-h-11 items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm sm:min-h-8">
              {[7, 14, 30].map((value) => <button key={value} type="button" onClick={() => setDays(value)} className={`min-h-10 rounded-md px-3 text-[11px] font-semibold transition-colors sm:min-h-7 ${days === value ? "bg-violet-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>{value} дней</button>)}
            </div>
            <button type="button" onClick={() => setRetryKey((value) => value + 1)} disabled={loading} aria-label="Обновить CTR" className="grid h-11 w-11 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 disabled:opacity-60 sm:h-8 sm:w-8">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-3.5 w-3.5" />}</button>
          </div>
        }
      />

      <div className="space-y-3 px-2 py-3 sm:px-6">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["1", "Генерим варианты", "2–4 разных главных фото без изменения остальной карточки."],
            ["2", "Ставим в карточку", "Каждый вариант получает фиксированный период показа."],
            ["3", "Замеряем CTR", "Сравниваем показы, клики и рекламную эффективность."],
            ["4", "Победитель", "Фиксируем лучший результат после минимума показов."],
          ].map(([step, title, text]) => <div key={step} className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"><span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-b from-sky-300 to-slate-600 text-xs font-bold text-white shadow-sm">{step}</span><h2 className="mt-2 text-[12px] font-bold text-slate-800">{title}</h2><p className="mt-1 text-[10px] leading-4 text-slate-500">{text}</p></div>)}
        </div>

        <div className="flex min-h-14 flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:flex-row sm:items-center">
          <div><div className="flex items-center gap-2 text-sm font-bold text-slate-800"><Plus className="h-4 w-4" /> Новый тест</div><div className="mt-0.5 text-[10px] text-slate-400">{candidates} SKU подходят по порогу: ≥1 000 показов и CTR ниже 3%</div></div>
          <button type="button" disabled title="Live photo swap включается отдельным write-гейтом" className="ml-auto inline-flex min-h-10 cursor-not-allowed items-center gap-1 rounded-lg border border-violet-200 px-3 text-[11px] font-semibold text-violet-400 opacity-70"><Plus className="h-3.5 w-3.5" /> создать тест</button>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex min-h-10 items-center rounded-lg bg-emerald-600 px-3 text-[11px] font-semibold text-white">Тест 1-го фото</span>
            <span aria-disabled="true" className="inline-flex min-h-10 items-center rounded-lg bg-pink-300 px-3 text-[11px] font-semibold text-white opacity-70">Тест фотоворонки · beta</span>
            <span aria-disabled="true" className="inline-flex min-h-10 items-center rounded-lg bg-blue-400 px-3 text-[11px] font-semibold text-white opacity-70">Тест видео</span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:ml-auto sm:max-w-xl sm:flex-row">
            {categories.length ? <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Категория" className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 outline-none focus:border-violet-400 sm:min-h-9"><option value="">Все категории</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}<option value="__none">Без категории</option></select> : null}
            <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 focus-within:border-violet-400 sm:min-h-9"><Search className="h-3.5 w-3.5 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SKU или nm" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label>
          </div>
        </div>

        {loading ? <div className="rounded-xl border border-slate-200 bg-white p-3"><LoadingBanner seconds={elapsed} hint={`CTR · ${activeCabinet?.name ?? "все кабинеты"}`} /><SkeletonTableRows rows={8} cols={8} /></div> : error ? <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} /> : items.length === 0 ? <WbEmptyState>Нет рекламных данных по выбранному периоду и фильтрам.</WbEmptyState> : (
          <div className="h-[calc(100vh-430px)] min-h-[360px] overflow-auto rounded-xl border border-slate-200 bg-white" onScroll={(event) => updateWindow(event.currentTarget)}>
            <table className="min-w-[860px] w-full border-collapse text-[10px]">
              <thead className="sticky top-0 z-20 bg-slate-50"><tr className="h-9 border-b border-slate-200 text-slate-500"><th className="sticky left-0 z-30 min-w-[220px] border-r border-slate-200 bg-slate-50 px-3 text-left">Товар</th><th className="px-3 text-left">Статус</th><th className="px-3 text-right">Показы</th><th className="px-3 text-right">CTR</th><th className="px-3 text-right">CPC</th><th className="px-3 text-right">ДРР</th><th className="px-3 text-right">Расход</th><th className="px-3 text-right">Остаток</th></tr></thead>
              <tbody>
                {rowWindow.start > 0 ? <tr aria-hidden="true"><td colSpan={8} style={{ height: rowWindow.start * ROW_HEIGHT }} /></tr> : null}
                {items.slice(rowWindow.start, rowWindow.end).map((item) => {
                  const candidate = item.views >= 1000 && (item.ctr ?? 0) < 3;
                  return <tr key={item.nm} className="h-11 border-b border-slate-100 hover:bg-violet-50/30"><td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-3 group-hover:bg-violet-50"><div className="font-semibold text-violet-700">{item.art}</div><div className="text-[9px] text-slate-400">nm {item.nm}</div></td><td className="px-3"><span className={`rounded-full px-2 py-1 text-[9px] font-semibold ${candidate ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{candidate ? "кандидат" : "наблюдение"}</span></td><td className="px-3 text-right tabular-nums">{number(item.views)}</td><td className={`px-3 text-right tabular-nums ${metricTone(item.ctr, 5, 3)}`}>{percent(item.ctr)}</td><td className="px-3 text-right tabular-nums">{number(item.cpc)} ₽</td><td className={`px-3 text-right tabular-nums ${(item.drr ?? 0) > 20 ? "font-semibold text-rose-600" : "text-slate-600"}`}>{percent(item.drr)}</td><td className="px-3 text-right tabular-nums">{number(item.spend)} ₽</td><td className={`px-3 text-right tabular-nums ${item.stock < 10 ? "font-semibold text-rose-600" : ""}`}>{number(item.stock)}</td></tr>;
                })}
                {rowWindow.end < items.length ? <tr aria-hidden="true"><td colSpan={8} style={{ height: (items.length - rowWindow.end) * ROW_HEIGHT }} /></tr> : null}
              </tbody>
            </table>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-3 text-[10px] leading-4 text-slate-500"><span className="font-semibold text-slate-700">Автоматический режим:</span> live-перестановка фото выключена по умолчанию. Экран использует реальные рекламные метрики для отбора кандидатов; запуск и возврат обложки будут доступны только после отдельного write-гейта и проверки сохранности видео.</div>
      </div>
    </div>
  );
}
