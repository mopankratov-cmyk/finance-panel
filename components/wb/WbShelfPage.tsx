"use client";

import { Ban, ChevronDown, Info, Loader2, Plus, RefreshCw, Rows3, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import type { ShelfMarkedRow, ShelfSliceResult } from "@/lib/shelf/slices";
import { wbCardImageUrl } from "@/lib/wb/cardImage";
import { sortByCustomSkuOrder } from "@/lib/wb/skuOrder";
import { nmMatchesTags, useRnpTags, WbTagFilterChips } from "./useRnpTags";
import { displaySkuArticle, displaySkuName, useWbSkuNames } from "./useWbSkuNames";
import { WbProductImage } from "./WbProductImage";
import { useCabinetSkuOrder } from "@/lib/wb/useCabinetSkuOrder";
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

// Ближайший плановый слот сборщика (10:00/18:00/22:00 МСК) — для сводки.
function nextSlotLabel(): string {
  const hour = Number(new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "numeric", hour12: false }).format(new Date()));
  const slot = [10, 18, 22].find((value) => hour < value);
  return slot ? `${slot}:00` : "10:00 завтра";
}

// Мини-график нашей цены в свёрнутой карточке: движение видно без раскрытия.
function PriceSparkline({ history }: { history: HistoryPoint[] }) {
  const values = history
    .map((point) => point.ourPrice)
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1);
  const x = (index: number) => 2 + (index / (values.length - 1)) * 84;
  const y = (value: number) => 22 - ((value - min) / spread) * 18;
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  return (
    <svg viewBox="0 0 88 26" className="hidden h-[26px] w-[88px] sm:block" aria-hidden="true">
      <polyline points={points} fill="none" stroke="#7c3aed" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
      <circle cx={x(values.length - 1)} cy={y(last)} r="2.2" fill="#7c3aed" />
    </svg>
  );
}

function diffTone(value: number | null): string {
  if (value == null) return "bg-slate-100 text-slate-500";
  // «+» = конкуренты дороже нас (наша цена конкурентна), «−» = мы дороже рынка.
  return value >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700";
}

function diffTextTone(value: number | null): string {
  if (value == null) return "text-slate-400";
  return value >= 0 ? "text-emerald-700" : "text-rose-600";
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

const OUR_COLOR = "#7c3aed";
const SLICE_COLORS: Record<number, string> = { 3: "#ef4444", 6: "#f97316", 12: "#3b82f6", 30: "#22c55e" };
const SLICE_ORDER = [3, 6, 12, 30] as const;
// Вертикальные линии между колонками — те же отступы обязаны быть и в шапке,
// иначе подписи съедут относительно чисел (в шапке граница прозрачная).
const SLICE_DIVIDER_CLASS = "sm:border-l sm:border-slate-200 sm:pl-5";
const SLICE_HEAD_DIVIDER_CLASS = "sm:border-l sm:border-transparent sm:pl-5";
// Одна сетка на шапку списка и на строки — иначе колонки разъезжаются.
const SLICE_GRID_CLASS = "grid flex-1 grid-cols-2 items-baseline gap-x-4 gap-y-1.5 sm:flex-none sm:grid-cols-[minmax(104px,auto)_repeat(4,minmax(132px,auto))] sm:gap-x-7";
const rub = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₽`;

// Колонка среза в свёрнутой строке: средняя цена среза и наша дельта к ней.
// Пустые срезы показывают причину («только свои товары»), а не прочерк.
function SliceCell({ slice }: { slice: ShelfSliceResult | undefined }) {
  if (!slice) return <div className={`text-right text-[11px] text-slate-300 ${SLICE_DIVIDER_CLASS}`}>—</div>;
  if (slice.avgPrice == null) {
    return (
      <div className={`truncate text-right text-[10px] font-semibold text-amber-600 ${SLICE_DIVIDER_CLASS}`} title={slice.note ?? undefined}>
        {slice.note ?? "нет данных"}
      </div>
    );
  }
  return (
    <div className={`flex items-baseline justify-end gap-2 whitespace-nowrap ${SLICE_DIVIDER_CLASS}`}>
      <span className="text-[15px] font-semibold tabular-nums text-slate-700">{price(slice.avgPrice)}</span>
      <span className={`text-[13px] font-bold tabular-nums ${diffTextTone(slice.diffPct)}`}>{slice.diffPct == null ? "—" : pct(slice.diffPct)}</span>
    </div>
  );
}
const signedRub = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.round(Math.abs(value)).toLocaleString("ru-RU")} ₽`;

// Таблица срезов по образцу макета: цена среза, отличие в % и в ₽.
// «+» = конкуренты дороже нас (зелёное: наша цена конкурентна) — семантика
// раздела, сознательно развёрнутая относительно макета-референса.
function SliceTable({ latest, watch }: { latest: LatestView; watch: WatchView }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[420px] border-collapse text-[11px]">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left">Срез</th>
            <th className="whitespace-nowrap px-3 py-2 text-right">Цена, ₽</th>
            <th className="whitespace-nowrap px-3 py-2 text-right" title="Плюс — конкуренты дороже нас">Отличие, %</th>
            <th className="whitespace-nowrap px-3 py-2 text-right" title="Плюс — конкуренты дороже нас">Отличие, ₽</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-slate-100 bg-violet-50/40">
            <td className="px-3 py-2 font-bold text-slate-800">{watch.supplierArticle || watch.nmId}<span className="ml-1 font-normal text-slate-400">(вы)</span></td>
            <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums text-violet-700">{price(latest.ourPrice)}</td>
            <td className="px-3 py-2 text-right text-slate-300">—</td>
            <td className="px-3 py-2 text-right text-slate-300">—</td>
          </tr>
          {latest.slices.map((slice) => {
            const diffRub = slice.avgPrice != null && latest.ourPrice != null ? slice.avgPrice - latest.ourPrice : null;
            return (
              <tr key={slice.n} className="border-t border-slate-100">
                <td className="px-3 py-2 text-slate-600">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: SLICE_COLORS[slice.n] }} />
                  {slice.label} <span className="text-slate-400">(ср. цена)</span>
                </td>
                {slice.avgPrice == null
                  ? <td colSpan={3} className="px-3 py-2 text-right text-[10px] text-amber-700">{slice.note ?? "нет данных"}</td>
                  : (
                    <>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-slate-700">{price(slice.avgPrice)}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${diffTextTone(slice.diffPct)}`}>{pct(slice.diffPct)}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${diffTextTone(diffRub)}`}>{diffRub == null ? "—" : signedRub(diffRub)}</td>
                    </>
                  )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Динамика цен по образцу макета: наша цена + средние всех четырёх срезов.
// Точки = сборы (до трёх в день); разрывы линий = сбор без данных, их не тянем.
function PriceHistoryChart({ history, watch }: { history: HistoryPoint[]; watch: WatchView }) {
  const points = history
    .map((point) => ({
      at: Date.parse(point.collectedAt),
      day: new Date(point.collectedAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
      our: point.ourPrice,
      byN: new Map(point.slices.map((slice) => [slice.n, slice.avgPrice])),
    }))
    .filter((point) => Number.isFinite(point.at))
    .sort((left, right) => left.at - right.at);

  const values = points.flatMap((point) => [point.our, ...[3, 6, 12, 30].map((n) => point.byN.get(n) ?? null)])
    .filter((value): value is number => value != null);
  if (!points.length || !values.length) {
    return <div className="grid min-h-[180px] place-items-center rounded-xl border border-slate-200 text-[10px] text-slate-400">График появится после первого сбора с ценами.</div>;
  }

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = Math.max((rawMax - rawMin) * 0.08, rawMax * 0.01, 1);
  const yMin = Math.max(0, rawMin - pad);
  const yMax = rawMax + pad;
  const W = 680;
  const H = 235;
  const L = 58;
  const R = 10;
  const T = 10;
  const B = 26;
  const x = (index: number) => points.length === 1 ? L + (W - L - R) / 2 : L + (index / (points.length - 1)) * (W - L - R);
  const y = (value: number) => T + (1 - (value - yMin) / (yMax - yMin)) * (H - T - B);
  const path = (get: (point: typeof points[number]) => number | null | undefined) => {
    let d = "";
    let pen = false;
    points.forEach((point, index) => {
      const value = get(point);
      if (value == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) * i) / 4);
  // Подпись дня — под первым сбором каждого дня; при большом окне прореживаем.
  const dayTickIndexes: number[] = [];
  points.forEach((point, index) => {
    if (index === 0 || points[index - 1].day !== point.day) dayTickIndexes.push(index);
  });
  const tickStep = Math.max(1, Math.ceil(dayTickIndexes.length / 10));
  const shownTicks = dayTickIndexes.filter((_, i) => i % tickStep === 0);

  const seriesList: { key: string; label: string; color: string; get: (point: typeof points[number]) => number | null | undefined }[] = [
    { key: "our", label: `${watch.supplierArticle || watch.nmId} (вы)`, color: OUR_COLOR, get: (point) => point.our },
    ...[3, 6, 12, 30].map((n) => ({ key: `top${n}`, label: `Топ-${n} — ср. цена`, color: SLICE_COLORS[n], get: (point: typeof points[number]) => point.byN.get(n) ?? null })),
  ];

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="mb-1 text-[11px] font-bold text-slate-700">Динамика цен</div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[480px] w-full" role="img" aria-label="Динамика нашей цены и средних по срезам">
          {yTicks.map((tick) => (
            <g key={tick}>
              <line x1={L} x2={W - R} y1={y(tick)} y2={y(tick)} stroke="#e2e8f0" strokeWidth="1" />
              <text x={L - 6} y={y(tick) + 3} textAnchor="end" fontSize="9" fill="#94a3b8">{Math.round(tick).toLocaleString("ru-RU")} ₽</text>
            </g>
          ))}
          {shownTicks.map((index) => (
            <text key={index} x={x(index)} y={H - 8} textAnchor="middle" fontSize="9" fill="#94a3b8">{points[index].day}</text>
          ))}
          {seriesList.map((series) => (
            <path key={series.key} d={path(series.get)} fill="none" stroke={series.color} strokeWidth={series.key === "our" ? 2.2 : 1.6} />
          ))}
          {points.map((point, index) => seriesList.map((series) => {
            const value = series.get(point);
            return value == null ? null : <circle key={`${series.key}-${index}`} cx={x(index)} cy={y(value)} r={series.key === "our" ? 2.6 : 1.8} fill={series.color} />;
          }))}
        </svg>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-slate-500">
        {seriesList.map((series) => (
          <span key={series.key}><span className="mr-1 inline-block h-[3px] w-4 rounded align-middle" style={{ backgroundColor: series.color }} />{series.label}</span>
        ))}
      </div>
    </div>
  );
}

// Свод по НАШЕЙ цене за окно анализа: изменение, мин/макс с датами, средняя.
function PeriodSummary({ history }: { history: HistoryPoint[] }) {
  const ours = history
    .map((point) => ({ at: Date.parse(point.collectedAt), price: point.ourPrice }))
    .filter((point): point is { at: number; price: number } => Number.isFinite(point.at) && point.price != null)
    .sort((left, right) => left.at - right.at);
  if (!ours.length) return null;
  const first = ours[0];
  const last = ours[ours.length - 1];
  const change = last.price - first.price;
  const changePct = first.price > 0 ? (change / first.price) * 100 : null;
  const minPoint = ours.reduce((best, point) => point.price < best.price ? point : best);
  const maxPoint = ours.reduce((best, point) => point.price > best.price ? point : best);
  const avg = ours.reduce((sum, point) => sum + point.price, 0) / ours.length;
  const dayCount = new Set(ours.map((point) => new Date(point.at).toDateString())).size;
  const fmtDate = (at: number) => new Date(at).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  const cards: { label: string; value: string; hint: string }[] = [
    {
      label: `Изменение за ${dayCount} ${dayCount === 1 ? "день" : dayCount < 5 ? "дня" : "дней"}`,
      value: changePct == null ? "—" : `${changePct > 0 ? "+" : ""}${changePct.toFixed(2)}%`,
      hint: signedRub(change),
    },
    { label: "Мин. цена за период", value: rub(minPoint.price), hint: fmtDate(minPoint.at) },
    { label: "Макс. цена за период", value: rub(maxPoint.price), hint: fmtDate(maxPoint.at) },
    { label: "Средняя цена за период", value: rub(avg), hint: `${ours.length} ${ours.length === 1 ? "сбор" : ours.length < 5 ? "сбора" : "сборов"}` },
    { label: "Период анализа", value: `${fmtDate(first.at)} – ${fmtDate(last.at)}`, hint: `${dayCount} ${dayCount === 1 ? "день" : dayCount < 5 ? "дня" : "дней"}` },
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => (
        <div key={card.label} className="rounded-xl border border-slate-200 p-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{card.label}</div>
          <div className="mt-0.5 whitespace-nowrap text-sm font-bold tabular-nums text-slate-800">{card.value}</div>
          <div className="mt-0.5 text-[11px] text-slate-400">{card.hint}</div>
        </div>
      ))}
    </div>
  );
}

export function WbShelfPage() {
  const { activeCabinet, cabinetId, cabinets, ready, loading: cabinetsLoading, error: cabinetsError, hasExactCabinet, canWrite, user } = useWbCabinet();
  // Внешний селлер пользуется «Полками» полностью: ведёт конкурентов своего
  // кабинета сам (общий canWrite для него false — он про владельческие правки).
  const canManage = canWrite || (user?.role === "seller" && hasExactCabinet);
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
  const [exclOpen, setExclOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
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
    }, `Артикул ${nm} добавлен — сборщик подберёт его в ближайшие ~15 минут`);
    // Инпуты чистим только после успеха: при ошибке набранное не пропадает.
    if (saved) {
      setNewNm("");
      setNewSupplier("");
    }
  };

  const globalBrands = settings.find((row) => row.cabinet_id === cabinetId)?.global_excluded_brands ?? [];
  // Ручной порядок выдачи артикулов (настраивается в РНП) действует и здесь.
  const { orderIndex } = useCabinetSkuOrder(hasExactCabinet ? cabinetId : null);
  const { tags, tagIdsByNm } = useRnpTags(hasExactCabinet ? cabinetId : null);
  const skuNames = useWbSkuNames(hasExactCabinet ? cabinetId : null);
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  useEffect(() => setActiveTagIds([]), [cabinetId]);
  // Ярлык на модели = все её цвета одной группой: фильтр сужает и список,
  // и сводку над ним — карточки сводки честны к выбранному ярлыку.
  const taggedItems = useMemo(
    () => items.filter((item) => nmMatchesTags(tagIdsByNm, item.watch.nmId, activeTagIds)),
    [activeTagIds, items, tagIdsByNm],
  );
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const tagId of tagIdsByNm.get(item.watch.nmId) ?? []) counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
    }
    return counts;
  }, [items, tagIdsByNm]);
  const orderedItems = useMemo(
    () => sortByCustomSkuOrder(taggedItems, (item) => item.watch.nmId, orderIndex),
    [taggedItems, orderIndex],
  );
  const totalActive = taggedItems.filter((item) => item.watch.active).length;

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
          <div className="relative">
            <button type="button" onClick={() => setInfoOpen((open) => !open)} aria-label="Как это устроено" aria-expanded={infoOpen} className="grid h-11 w-11 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 sm:h-8 sm:w-8">
              <Info className="h-3.5 w-3.5" />
            </button>
            {infoOpen ? (
              <div className="absolute right-0 top-full z-50 mt-1 w-[320px] rounded-xl border border-slate-200 bg-white p-3 text-[10px] leading-4 text-slate-600 shadow-[0_18px_55px_rgba(15,23,42,0.18)]">
                <b className="text-slate-800">Как это устроено.</b> Цены снимает внешний сборщик (Playwright + реальный Chrome на Mac — антибот WB не пропускает серверный скрейпинг), панель принимает снимки и считает срезы. Средние Топ-3/6/12/30 — по порядку показа среди неисключённых конкурентов с ценой; нехватка подписывается «доступно X из N», срез из одних своих карточек — «только свои товары». «+» в разнице = конкурент дороже нас. Цена — «с WB Кошельком». Новые артикулы сборщик подбирает в течение ~15 минут, плановые сборы — 10:00 / 18:00 / 22:00 МСК.
              </div>
            ) : null}
          </div>
          <button type="button" onClick={() => reload()} disabled={loading} aria-label="Обновить" className="grid h-11 w-11 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 disabled:opacity-60 sm:h-8 sm:w-8">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </div>}
      />

      <div className="space-y-3 px-2 py-3 sm:px-6">
        {message ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">{message}</div> : null}
        {error && !loading ? <WbErrorState message={error} onRetry={() => reload()} /> : null}

        {hasExactCabinet ? (
          <section className="relative rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-end gap-2">
              {canManage ? (
                <>
                  <label className="flex flex-col gap-1 text-[10px] font-semibold text-slate-500">
                    Артикул WB
                    <input value={newNm} onChange={(event) => setNewNm(event.target.value)} inputMode="numeric" placeholder="786649863" className="min-h-11 w-40 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-violet-400 sm:min-h-9" />
                  </label>
                  <label className="flex flex-col gap-1 text-[10px] font-semibold text-slate-500">
                    Артикул поставщика
                    <input value={newSupplier} onChange={(event) => setNewSupplier(event.target.value)} placeholder="NV-836…" className="min-h-11 w-40 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-violet-400 sm:min-h-9" />
                  </label>
                  <button type="button" disabled={busy || !newNm.trim()} onClick={() => void addWatch()} className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-violet-600 px-3 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-40 sm:min-h-9">
                    <Plus className="h-3.5 w-3.5" />отслеживать
                  </button>
                </>
              ) : <span className="text-[11px] text-slate-500">Реестр ведёт менеджер кабинета.</span>}
              <button
                type="button"
                onClick={() => setExclOpen((open) => !open)}
                aria-expanded={exclOpen}
                className={`ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-semibold transition sm:min-h-9 ${exclOpen ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}
              >
                <Ban className="h-3.5 w-3.5" />
                Исключения кабинета{globalBrands.length ? ` · ${globalBrands.length}` : ""}
              </button>
            </div>
            {canManage ? <p className="mt-1.5 text-[10px] text-slate-400">Свой бренд артикула исключается из конкурентов автоматически при первом сборе.</p> : null}
            {exclOpen ? (
              <div className="absolute right-3 top-full z-40 mt-1 w-[min(420px,calc(100vw-48px))] rounded-xl border border-slate-200 bg-white p-3 shadow-[0_18px_55px_rgba(15,23,42,0.18)]">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Глобальные бренды-исключения кабинета</div>
                {canManage ? (
                  <div className="mt-2 flex gap-2">
                    <input
                      value={globalDraft ?? globalBrands.join(", ")}
                      onChange={(event) => setGlobalDraft(event.target.value)}
                      placeholder="Бренды через запятую"
                      className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-violet-400 sm:min-h-9"
                    />
                    <button
                      type="button"
                      disabled={busy || globalDraft == null}
                      onClick={() => {
                        const brands = (globalDraft ?? "").split(",").map((brand) => brand.trim()).filter(Boolean);
                        setGlobalDraft(null);
                        setExclOpen(false);
                        void mutate("/api/shelf/watch", { method: "PUT", body: JSON.stringify({ cabinetId, globalExcludedBrands: brands }) }, "Глобальные исключения сохранены");
                      }}
                      className="min-h-10 rounded-lg bg-violet-600 px-3 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-40 sm:min-h-9"
                    >сохранить</button>
                  </div>
                ) : <div className="mt-2 text-xs text-slate-500">{globalBrands.length ? globalBrands.join(", ") : "не заданы"}</div>}
                <p className="mt-2 text-[10px] leading-4 text-slate-400">Применяются ко всем артикулам кабинета поверх авто-исключения своего бренда; правка честно пересчитывает и историю срезов.</p>
              </div>
            ) : null}
          </section>
        ) : <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">В режиме «Все кабинеты» показывается сводка. Добавлять артикулы и править исключения можно, выбрав конкретный кабинет.</div>}

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <LoadingBanner seconds={elapsed} hint={`полки · ${activeCabinet?.name ?? "все кабинеты"}`} />
            <SkeletonTableRows rows={4} cols={6} />
          </div>
        ) : items.length === 0 ? (
          <WbEmptyState>
            {hasExactCabinet && canManage
              ? "Реестр пуст. Добавьте артикулы формой выше — сборщик (tools/shelf-collector, Mac с реальным Chrome) заберёт их в ближайший слот 10:00 / 18:00 / 22:00 МСК и пришлёт цены блока «Смотрите также»."
              : "В этом срезе пока нет отслеживаемых артикулов. Добавить их может менеджер, выбрав конкретный кабинет."}
          </WbEmptyState>
        ) : (
          <div className="space-y-2">
            <WbTagFilterChips
              tags={tags}
              activeIds={activeTagIds}
              counts={tagCounts}
              onToggle={(tagId) => setActiveTagIds((current) => current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId])}
              onClear={() => setActiveTagIds([])}
            />
            {(() => {
              const withTop6 = taggedItems
                .map((item) => item.latest?.slices.find((slice) => slice.n === 6)?.diffPct)
                .filter((value): value is number => value != null);
              const cheaper = withTop6.filter((value) => value > 0).length;
              const dearer = withTop6.filter((value) => value < 0).length;
              const avgDiff = withTop6.length ? withTop6.reduce((sum, value) => sum + value, 0) / withTop6.length : null;
              const lastCollected = taggedItems
                .map((item) => item.latest?.collectedAt)
                .filter((value): value is string => Boolean(value))
                .sort()
                .at(-1);
              const cards: { label: string; value: string; hint: string; tone?: string }[] = [
                { label: activeTagIds.length ? "По ярлыку" : "В реестре", value: String(taggedItems.length), hint: `${totalActive} активных для сбора` },
                { label: "Мы дешевле рынка", value: withTop6.length ? `${cheaper} из ${withTop6.length}` : "—", hint: "по средней Топ-6", tone: cheaper > dearer ? "text-emerald-700" : undefined },
                { label: "Мы дороже рынка", value: withTop6.length ? `${dearer} из ${withTop6.length}` : "—", hint: avgDiff == null ? "нет данных" : `средняя дельта ${pct(avgDiff)}`, tone: dearer > 0 ? "text-rose-600" : undefined },
                { label: "Последний сбор", value: lastCollected ? new Date(lastCollected).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—", hint: `следующий слот ${nextSlotLabel()} МСК` },
              ];
              return (
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  {cards.map((card) => (
                    <div key={card.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                      <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{card.label}</div>
                      <div className={`mt-1.5 whitespace-nowrap text-[26px] font-bold leading-7 tracking-[-0.02em] tabular-nums ${card.tone ?? "text-slate-800"}`}>{card.value}</div>
                      <div className="text-[9px] text-slate-400">{card.hint}</div>
                    </div>
                  ))}
                </div>
              );
            })()}
            {/* Шапка колонок — подписи один раз над списком, как в таблице.
                Цветные точки совпадают с линиями графика в раскрытой карточке.
                Прилипает под верхней панелью (54px), чтобы при прокрутке длинного
                реестра было видно, где чей срез. Отрицательные поля растягивают
                фон на всю ширину контента — иначе карточки просвечивают по краям. */}
            <div className="sticky top-[54px] z-20 -mx-2 hidden border-b border-slate-200 bg-[#f6f7f9]/95 px-5 py-2 backdrop-blur-sm sm:-mx-6 sm:flex sm:items-end sm:px-10">
              <div className="min-w-0 flex-1" />
              <div className="flex items-center gap-3">
                <div className={SLICE_GRID_CLASS}>
                  <div className="text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">наша</div>
                  {SLICE_ORDER.map((n) => (
                    <div key={n} className={`flex items-center justify-end gap-1.5 whitespace-nowrap text-[12px] font-semibold ${SLICE_HEAD_DIVIDER_CLASS}`}>
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SLICE_COLORS[n] }} />
                      <span style={{ color: SLICE_COLORS[n] }}>Топ-{n}</span>
                      <span className="text-[11px] font-medium text-slate-400">(ср. цена)</span>
                    </div>
                  ))}
                </div>
                <span className="h-4 w-4 shrink-0" aria-hidden="true" />
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] [&>section+section]:border-t [&>section+section]:border-slate-100">
            {orderedItems.map((item) => {
              const { watch, latest, history } = item;
              const expanded = expandedId === watch.id;
              const age = latest ? collectedAge(latest.collectedAt) : null;
              const visibleRows = latest ? latest.rows.filter((row) => showExcluded || !row.excluded) : [];
              const excludedCount = latest ? latest.rows.filter((row) => row.excluded).length : 0;
              return (
                <section key={watch.id} className={`group bg-white transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-violet-50/25 ${watch.active ? "" : "opacity-60"}`}>
                  <button type="button" onClick={() => setExpandedId(expanded ? null : watch.id)} aria-expanded={expanded} className="flex w-full flex-wrap items-center gap-4 px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <WbProductImage nm={watch.nmId} src={watch.ourImg} label={displaySkuArticle(watch.supplierArticle, skuNames, watch.nmId)} className="h-16 w-[52px] shrink-0 rounded-lg bg-slate-100 object-cover ring-1 ring-slate-200/60" />
                    <div className="min-w-0">
                      {/* Три строки опознания, как в воронке: артикул склада,
                          номер WB для поиска в кабинете, название карточки.
                          Компонент воронки сюда не годится — там мелкая
                          табличная ячейка, здесь заголовок карточки. */}
                      <div className="flex items-baseline gap-2">
                        <span className="truncate text-[17px] font-bold tracking-[-0.01em] text-slate-800">{displaySkuArticle(watch.supplierArticle, skuNames, watch.nmId) || `WB ${watch.nmId}`}</span>
                        {watch.ourBrand ? <span className="hidden shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:inline">{watch.ourBrand}</span> : null}
                      </div>
                      <div className="truncate text-[11px] font-normal tabular-nums text-slate-400">WB {watch.nmId}</div>
                      {displaySkuName(watch.supplierArticle ?? "", null, skuNames, watch.nmId) ? <div className="truncate text-[11px] font-normal text-slate-500">{displaySkuName(watch.supplierArticle ?? "", null, skuNames, watch.nmId)}</div> : null}
                      {/* Номер WB стоит строкой выше — здесь только состояние
                          сбора. Раньше строка начиналась с «nm 1224062420», и
                          после появления строки «WB 1224062420» номер оказался
                          на карточке дважды. */}
                      {(!watch.active || !watch.ourBrand || age) ? (
                        <div className="mt-1 text-[12px] text-slate-400">
                          {[
                            watch.active ? null : "сбор выключен",
                            watch.ourBrand ? null : "бренд появится после первого сбора",
                          ].filter(Boolean).join(" · ")}
                          {age ? (
                            <span className={age.stale ? "text-amber-600" : ""}>
                              {(!watch.active || !watch.ourBrand) ? " · " : ""}{age.label}{age.stale ? " — сборщик молчит" : ""}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex w-full items-center gap-3 sm:ml-auto sm:w-auto">
                      {latest ? (
                        <div className={SLICE_GRID_CLASS}>
                          <div className="flex items-baseline justify-end gap-2">
                            <PriceSparkline history={history} />
                            <span className="text-[17px] font-bold tabular-nums text-slate-800">{price(latest.ourPrice)}</span>
                          </div>
                          {SLICE_ORDER.map((n) => (
                            <SliceCell key={n} slice={latest.slices.find((slice) => slice.n === n)} />
                          ))}
                        </div>
                      ) : <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-semibold text-slate-500">сборов ещё не было</span>}
                      <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </div>
                  </button>

                  {expanded ? (
                    <div className="space-y-3 border-t border-slate-100 p-3">
                      {latest ? (
                        <>
                          <div className="text-[10px] text-slate-400">сбор {new Date(latest.collectedAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · конкурентов в блоке: {latest.competitorCount}</div>
                          <div className="grid gap-3 xl:grid-cols-[minmax(0,470px)_minmax(0,1fr)]">
                            <SliceTable latest={latest} watch={watch} />
                            <PriceHistoryChart history={history} watch={watch} />
                          </div>
                          <PeriodSummary history={history} />
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
                              <thead className="bg-slate-50">
                                <tr className="text-[9px] font-semibold uppercase tracking-wide text-slate-400"><th className="px-2 py-2 text-left">#</th><th className="px-2 py-2 text-left">Товар</th><th className="px-2 py-2 text-left">Бренд</th><th className="px-2 py-2 text-right">Цена</th><th className="px-2 py-2 text-right" title="Плюс — конкурент дороже нас">К нашей цене</th><th className="px-2 py-2 text-left" /></tr>
                              </thead>
                              <tbody>
                                {visibleRows.map((row) => (
                                  <tr key={`${row.position}`} className={`border-t border-slate-100 transition-colors odd:bg-slate-50/40 hover:bg-violet-50/40 ${row.excluded ? "opacity-45" : ""}`}>
                                    <td className="px-2 py-2 tabular-nums text-slate-400">{row.position}</td>
                                    <td className="px-2 py-2">
                                      {row.nmId ? (
                                        <a
                                          href={`https://www.wildberries.ru/catalog/${row.nmId}/detail.aspx`}
                                          target="_blank"
                                          rel="noreferrer"
                                          title="Открыть карточку конкурента на WB"
                                          className="group flex items-center gap-2"
                                        >
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <WbProductImage nm={row.nmId} src={row.img} label={row.brand || null} className="h-10 w-8 rounded bg-slate-100 object-cover" />
                                          <span className="tabular-nums font-semibold text-violet-700 group-hover:underline">{row.nmId}</span>
                                        </a>
                                      ) : (
                                        <div className="flex items-center gap-2">
                                          {row.img ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={row.img} alt="" loading="lazy" className="h-10 w-8 rounded bg-slate-100 object-cover" />
                                          ) : <span className="h-10 w-8 rounded bg-slate-100" />}
                                          <span className="text-slate-400">—</span>
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-2 py-2 text-slate-600">{row.brand ?? "(бренд не указан)"}</td>
                                    <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums font-semibold text-slate-700">{price(row.price)}</td>
                                    <td className="px-2 py-2 text-right">
                                      {row.price != null && latest.ourPrice != null && latest.ourPrice > 0
                                        ? <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-bold tabular-nums ${row.price >= latest.ourPrice ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"}`}>{pct(((row.price - latest.ourPrice) / latest.ourPrice) * 100)}</span>
                                        : <span className="text-slate-400">—</span>}
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

                      {canManage ? (
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
          </div>
        )}

      </div>
    </div>
  );
}
