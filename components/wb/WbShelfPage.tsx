"use client";

import { ChevronDown, ChevronUp, Loader2, Plus, RefreshCw, Rows3, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import type { ShelfMarkedRow, ShelfSliceResult } from "@/lib/shelf/slices";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { useWbCabinet } from "./WbCabinetContext";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";

interface WatchView {
  id: string;
  cabinetId: string;
  nmId: number;
  supplierArticle: string | null;
  ourBrand: string | null;
  ourLink: string | null;
  ourImg: string | null;
  extraExcludedBrands: string[];
  active: boolean;
}

interface LatestView {
  snapshotId: string;
  collectedAt: string;
  ourPrice: number | null;
  competitorCount: number;
  rows: (ShelfMarkedRow & { isNew: boolean })[];
  slices: ShelfSliceResult[];
}

interface HistoryPoint {
  snapshotId: string;
  collectedAt: string;
  ourPrice: number | null;
  slices: ShelfSliceResult[];
}

interface ShelfItem {
  watch: WatchView;
  latest: LatestView | null;
  history: HistoryPoint[];
}

interface SettingsRow { cabinet_id: string; global_excluded_brands: string[] }

const price = (value: number | null) => value == null ? "—" : `${Math.round(value).toLocaleString("ru-RU")} ₽`;
const pct = (value: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

function collectedAge(iso: string): { label: string; stale: boolean } {
  const hours = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (!Number.isFinite(hours)) return { label: "—", stale: true };
  const label = hours < 1 ? "меньше часа назад"
    : hours < 24 ? `${Math.round(hours)} ч назад`
      : `${Math.round(hours / 24)} дн назад`;
  // Слоты 10:00/18:00/22:00 МСК: штатная пауза между 22:00 и утренним сбором —
  // 12 часов. Тревожимся только когда пропущен целый слот, а не каждое утро.
  return { label, stale: hours > 13 };
}

function diffTone(value: number | null): string {
  if (value == null) return "bg-slate-100 text-slate-500";
  // «+» = конкуренты дороже нас (наша цена конкурентна), «−» = мы дороже рынка.
  return value >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700";
}

function SliceChips({ slices }: { slices: ShelfSliceResult[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {slices.map((slice) => (
        <span key={slice.n} title={slice.note ?? "средняя цена неисключённых конкурентов среза"} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-semibold ${slice.onlyOwn ? "bg-amber-50 text-amber-700" : diffTone(slice.diffPct)}`}>
          {slice.label}
          {slice.avgPrice == null ? ` · ${slice.note ?? "нет данных"}` : ` · ${price(slice.avgPrice)}${slice.diffPct == null ? "" : ` · ${pct(slice.diffPct)}`}`}
        </span>
      ))}
    </div>
  );
}

function HistoryChart({ history }: { history: HistoryPoint[] }) {
  const points = history
    .map((point) => ({
      at: Date.parse(point.collectedAt),
      our: point.ourPrice,
      top6: point.slices.find((slice) => slice.n === 6)?.avgPrice ?? null,
    }))
    .filter((point) => Number.isFinite(point.at));
  if (points.length < 2) {
    return <div className="text-[10px] text-slate-400">История появится после двух и более сборов.</div>;
  }
  const values = points.flatMap((point) => [point.our, point.top6]).filter((value): value is number => value != null);
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1);
  const x = (index: number) => 8 + (index / (points.length - 1)) * 284;
  const y = (value: number) => 60 - ((value - min) / spread) * 50;
  const line = (key: "our" | "top6") => points
    .map((point, index) => point[key] == null ? null : `${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`)
    .filter(Boolean)
    .join(" ");
  return (
    <div>
      <svg viewBox="0 0 300 70" className="h-[70px] w-full max-w-[300px]" role="img" aria-label="Динамика нашей цены и средней Топ-6">
        <polyline points={line("top6")} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3" />
        <polyline points={line("our")} fill="none" stroke="#7c3aed" strokeWidth="2" />
      </svg>
      <div className="flex gap-3 text-[9px] text-slate-400">
        <span><span className="mr-1 inline-block h-[2px] w-4 bg-violet-600 align-middle" />наша цена</span>
        <span><span className="mr-1 inline-block h-[2px] w-4 bg-slate-400 align-middle" />средняя Топ-6</span>
        <span className="ml-auto tabular-nums">{price(min)} – {price(max)}</span>
      </div>
    </div>
  );
}

export function WbShelfPage() {
  const { activeCabinet, cabinetId, cabinets, ready, loading: cabinetsLoading, error: cabinetsError, hasExactCabinet, canWrite } = useWbCabinet();
  const [items, setItems] = useState<ShelfItem[]>([]);
  const [settings, setSettings] = useState<SettingsRow[]>([]);
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newNm, setNewNm] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [brandsDraft, setBrandsDraft] = useState<Record<string, string>>({});
  const [globalDraft, setGlobalDraft] = useState<string | null>(null);
  const requestId = useRef(0);
  const elapsed = useElapsedSeconds(loading);

  // Черновики привязаны к кабинету: пережившая переключение строка исключений
  // молча сохранилась бы в чужой кабинет.
  useEffect(() => {
    setGlobalDraft(null);
    setBrandsDraft({});
    setExpandedId(null);
  }, [cabinetId]);

  // Зелёное сообщение об успехе — временное: навсегда повисшее рядом с более
  // поздней ошибкой оно читается как противоречие.
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 6000);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!ready || cabinetsLoading) return;
    if (cabinets.length === 0) {
      setLoading(false);
      setError(cabinetsError || "Подключите хотя бы один активный WB-кабинет");
      return;
    }
    const controller = new AbortController();
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    const query = `cabinet=${encodeURIComponent(cabinetId || "all")}`;
    Promise.all([
      fetch(`/api/shelf/table?${query}&days=${days}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const body = await response.json() as { items?: ShelfItem[]; error?: string };
        if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
        return body.items ?? [];
      }),
      fetch(`/api/shelf/watch?${query}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
        const body = await response.json() as { settings?: SettingsRow[]; error?: string };
        if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
        return body.settings ?? [];
      }),
    ])
      .then(([tableItems, settingsRows]) => {
        if (current !== requestId.current) return;
        setItems(tableItems);
        setSettings(settingsRows);
      })
      .catch((cause: unknown) => {
        if (current === requestId.current && !controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Не удалось загрузить «Полки»");
        }
      })
      .finally(() => { if (current === requestId.current) setLoading(false); });
    return () => controller.abort();
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, days, ready, retryKey]);

  const reload = (notice?: string) => {
    if (notice) setMessage(notice);
    setRetryKey((value) => value + 1);
  };

  const mutate = async (input: RequestInfo, init: RequestInit, notice: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(input, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      reload(notice);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Действие не выполнено");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addWatch = async () => {
    const nm = Number(newNm.trim());
    if (!Number.isInteger(nm) || nm <= 0) {
      setError("Артикул WB — положительное целое число");
      return;
    }
    const saved = await mutate("/api/shelf/watch", {
      method: "POST",
      body: JSON.stringify({ cabinetId, nmId: nm, supplierArticle: newSupplier.trim() || null }),
    }, `Артикул ${nm} добавлен — попадёт в следующий сбор`);
    // Инпуты чистим только после успеха: при ошибке набранное не пропадает.
    if (saved) {
      setNewNm("");
      setNewSupplier("");
    }
  };

  const globalBrands = settings.find((row) => row.cabinet_id === cabinetId)?.global_excluded_brands ?? [];
  const totalActive = items.filter((item) => item.watch.active).length;

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
      <WbModuleHeader
        icon={Rows3}
        title="Полки — цены конкурентов"
        description="Блок «Смотрите также» на карточках WB: гость, Москва, снимки 10:00 / 18:00 / 22:00 МСК"
        actions={<div className="flex items-center gap-2">
          <div className="flex min-h-11 items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm sm:min-h-8">
            {[7, 14, 30].map((value) => (
              <button key={value} type="button" onClick={() => setDays(value)} className={`min-h-10 rounded-md px-3 text-[11px] font-semibold transition-colors sm:min-h-7 ${days === value ? "bg-violet-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>{value} дней</button>
            ))}
          </div>
          <button type="button" onClick={() => reload()} disabled={loading} aria-label="Обновить" className="grid h-11 w-11 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 disabled:opacity-60 sm:h-8 sm:w-8">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </div>}
      />

      <div className="space-y-3 px-2 py-3 sm:px-6">
        {message ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{message}</div> : null}
        {error && !loading ? <WbErrorState message={error} onRetry={() => reload()} /> : null}

        {hasExactCabinet && canWrite ? (
          <section className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:flex-row sm:items-end">
            <label className="flex flex-col gap-1 text-[10px] font-semibold text-slate-500">
              Артикул WB
              <input value={newNm} onChange={(event) => setNewNm(event.target.value)} inputMode="numeric" placeholder="786649863" className="min-h-11 w-40 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-violet-400 sm:min-h-9" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-semibold text-slate-500">
              Артикул поставщика (не обязательно)
              <input value={newSupplier} onChange={(event) => setNewSupplier(event.target.value)} placeholder="NV-836…" className="min-h-11 w-44 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-violet-400 sm:min-h-9" />
            </label>
            <button type="button" disabled={busy || !newNm.trim()} onClick={() => void addWatch()} className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-violet-600 px-3 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-40 sm:min-h-9">
              <Plus className="h-3.5 w-3.5" />отслеживать
            </button>
            <div className="text-[10px] leading-4 text-slate-400 sm:ml-auto sm:max-w-[260px]">
              Свой бренд артикула исключается из конкурентов автоматически при первом сборе.
            </div>
          </section>
        ) : null}

        {hasExactCabinet ? (
          <section className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Глобальные бренды-исключения кабинета</span>
              {canWrite ? (
                <>
                  <input
                    value={globalDraft ?? globalBrands.join(", ")}
                    onChange={(event) => setGlobalDraft(event.target.value)}
                    placeholder="Бренды через запятую"
                    className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-violet-400 sm:min-h-8"
                  />
                  <button
                    type="button"
                    disabled={busy || globalDraft == null}
                    onClick={() => {
                      const brands = (globalDraft ?? "").split(",").map((brand) => brand.trim()).filter(Boolean);
                      setGlobalDraft(null);
                      void mutate("/api/shelf/watch", { method: "PUT", body: JSON.stringify({ cabinetId, globalExcludedBrands: brands }) }, "Глобальные исключения сохранены");
                    }}
                    className="min-h-10 rounded-lg bg-slate-800 px-3 text-[11px] font-semibold text-white disabled:opacity-40 sm:min-h-8"
                  >сохранить</button>
                </>
              ) : <span className="text-slate-500">{globalBrands.length ? globalBrands.join(", ") : "не заданы"}</span>}
            </div>
            <p className="mt-1 text-[10px] text-slate-400">Применяются ко всем артикулам кабинета поверх авто-исключения своего бренда; правка честно пересчитывает и историю срезов.</p>
          </section>
        ) : <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">В режиме «Все кабинеты» показывается сводка. Добавлять артикулы и править исключения можно, выбрав конкретный кабинет.</div>}

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <LoadingBanner seconds={elapsed} hint={`полки · ${activeCabinet?.name ?? "все кабинеты"}`} />
            <SkeletonTableRows rows={4} cols={6} />
          </div>
        ) : items.length === 0 ? (
          <WbEmptyState>
            {hasExactCabinet && canWrite
              ? "Реестр пуст. Добавьте артикулы формой выше — сборщик (tools/shelf-collector, Mac с реальным Chrome) заберёт их в ближайший слот 10:00 / 18:00 / 22:00 МСК и пришлёт цены блока «Смотрите также»."
              : "В этом срезе пока нет отслеживаемых артикулов. Добавить их может менеджер, выбрав конкретный кабинет."}
          </WbEmptyState>
        ) : (
          <div className="space-y-2">
            <div className="text-[10px] text-slate-400">{items.length} артикулов в реестре · {totalActive} активных для сбора</div>
            {items.map((item) => {
              const { watch, latest, history } = item;
              const expanded = expandedId === watch.id;
              const age = latest ? collectedAge(latest.collectedAt) : null;
              const visibleRows = latest ? latest.rows.filter((row) => showExcluded || !row.excluded) : [];
              const excludedCount = latest ? latest.rows.filter((row) => row.excluded).length : 0;
              return (
                <section key={watch.id} className={`rounded-xl border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${watch.active ? "border-slate-200" : "border-slate-200 opacity-60"}`}>
                  <button type="button" onClick={() => setExpandedId(expanded ? null : watch.id)} className="flex w-full flex-wrap items-center gap-3 p-3 text-left">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={watch.ourImg || wbCardImageUrl(watch.nmId)} alt="" loading="lazy" className="h-12 w-9 shrink-0 rounded-md bg-slate-100 object-cover" />
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-800">{watch.supplierArticle || watch.nmId}</div>
                      <div className="text-[10px] text-slate-400">nm {watch.nmId} · {watch.ourBrand ?? "бренд появится после первого сбора"}{watch.active ? "" : " · сбор выключен"}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
                      {latest ? (
                        <>
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-semibold text-slate-600">наша {price(latest.ourPrice)}</span>
                          <SliceChips slices={latest.slices.filter((slice) => slice.n === 6 || slice.n === 12)} />
                          <span className={`rounded-full px-2 py-1 text-[9px] font-semibold ${age?.stale ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{age?.label}</span>
                        </>
                      ) : <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-semibold text-slate-500">сборов ещё не было</span>}
                      {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                    </div>
                  </button>

                  {expanded ? (
                    <div className="space-y-3 border-t border-slate-100 p-3">
                      {latest ? (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <SliceChips slices={latest.slices} />
                            <span className="text-[10px] text-slate-400">сбор {new Date(latest.collectedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · конкурентов в блоке: {latest.competitorCount}</span>
                          </div>
                          <HistoryChart history={history} />
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Конкуренты последнего сбора</span>
                            {excludedCount > 0 ? (
                              <button type="button" onClick={() => setShowExcluded((value) => !value)} className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-semibold text-slate-500 hover:bg-slate-200">
                                {showExcluded ? "скрыть исключённых" : `показать исключённых (${excludedCount})`}
                              </button>
                            ) : null}
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[560px] border-collapse text-[10px]">
                              <thead className="bg-slate-50 text-slate-500">
                                <tr><th className="px-2 py-2 text-left">#</th><th className="px-2 py-2 text-left">Товар</th><th className="px-2 py-2 text-left">Бренд</th><th className="px-2 py-2 text-right">Цена</th><th className="px-2 py-2 text-right" title="Плюс — конкурент дороже нас">К нашей цене</th><th className="px-2 py-2 text-left" /></tr>
                              </thead>
                              <tbody>
                                {visibleRows.map((row) => (
                                  <tr key={`${row.position}`} className={`border-t border-slate-100 ${row.excluded ? "opacity-45" : ""}`}>
                                    <td className="px-2 py-2 tabular-nums text-slate-400">{row.position}</td>
                                    <td className="px-2 py-2">
                                      <div className="flex items-center gap-2">
                                        {row.img || row.nmId ? (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img src={row.img || wbCardImageUrl(row.nmId as number)} alt="" loading="lazy" className="h-10 w-8 rounded bg-slate-100 object-cover" />
                                        ) : <span className="h-10 w-8 rounded bg-slate-100" />}
                                        <span className="tabular-nums text-slate-600">{row.nmId ?? "—"}</span>
                                      </div>
                                    </td>
                                    <td className="px-2 py-2 text-slate-600">{row.brand ?? "(бренд не указан)"}</td>
                                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-slate-700">{price(row.price)}</td>
                                    <td className={`px-2 py-2 text-right tabular-nums font-semibold ${row.price != null && latest.ourPrice != null ? (row.price >= latest.ourPrice ? "text-emerald-700" : "text-rose-600") : "text-slate-400"}`}>
                                      {row.price != null && latest.ourPrice != null && latest.ourPrice > 0 ? pct(((row.price - latest.ourPrice) / latest.ourPrice) * 100) : "—"}
                                    </td>
                                    <td className="px-2 py-2">
                                      {row.excluded ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] text-slate-500">исключён</span>
                                        : row.isNew ? <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-semibold text-violet-700">новый</span> : null}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      ) : <WbEmptyState>Сборов по артикулу ещё не было — он попадёт в ближайший слот сборщика.</WbEmptyState>}

                      {canWrite ? (
                        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                          <label className="flex min-w-0 flex-1 items-center gap-2 text-[10px] font-semibold text-slate-500">
                            Доп. исключения артикула:
                            <input
                              value={brandsDraft[watch.id] ?? watch.extraExcludedBrands.join(", ")}
                              onChange={(event) => setBrandsDraft((draft) => ({ ...draft, [watch.id]: event.target.value }))}
                              placeholder="Бренды через запятую"
                              className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-xs font-normal outline-none focus:border-violet-400 sm:min-h-8"
                            />
                          </label>
                          <button
                            type="button"
                            disabled={busy || brandsDraft[watch.id] == null}
                            onClick={() => {
                              const brands = (brandsDraft[watch.id] ?? "").split(",").map((brand) => brand.trim()).filter(Boolean);
                              setBrandsDraft((draft) => { const next = { ...draft }; delete next[watch.id]; return next; });
                              void mutate("/api/shelf/watch", { method: "PATCH", body: JSON.stringify({ id: watch.id, extraExcludedBrands: brands }) }, "Исключения артикула сохранены");
                            }}
                            className="min-h-10 rounded-lg bg-slate-800 px-3 text-[11px] font-semibold text-white disabled:opacity-40 sm:min-h-8"
                          >сохранить</button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void mutate("/api/shelf/watch", { method: "PATCH", body: JSON.stringify({ id: watch.id, active: !watch.active }) }, watch.active ? "Сбор по артикулу выключен" : "Сбор по артикулу включён")}
                            className="min-h-10 rounded-lg border border-slate-200 px-3 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 sm:min-h-8"
                          >{watch.active ? "выключить сбор" : "включить сбор"}</button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(`Удалить артикул ${watch.nmId} ВМЕСТЕ со всей историей снимков? Отключить сбор без потери истории можно кнопкой «выключить сбор».`)) return;
                              void mutate("/api/shelf/watch", { method: "DELETE", body: JSON.stringify({ id: watch.id, confirm: "DELETE_WATCH_WITH_HISTORY" }) }, "Артикул и история удалены");
                            }}
                            className="grid h-10 w-10 place-items-center rounded-lg text-slate-300 hover:bg-rose-50 hover:text-rose-600 sm:h-8 sm:w-8"
                            aria-label="Удалить артикул с историей"
                          ><Trash2 className="h-4 w-4" /></button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-3 text-[10px] leading-5 text-slate-500">
          <b className="text-slate-700">Как это устроено:</b> цены снимает внешний сборщик (Playwright + реальный Chrome на Mac — антибот WB не пропускает серверный скрейпинг), панель только принимает снимки и считает срезы. Средние Топ-3/6/12/30 — по порядку показа среди неисключённых конкурентов с ценой; нехватка подписывается «доступно X из N», а срез из одних своих карточек — «только свои товары». «+» в разнице = конкурент дороже нас. Цена — та, что WB показывает крупно («с WB Кошельком»).
        </div>
      </div>
    </div>
  );
}
