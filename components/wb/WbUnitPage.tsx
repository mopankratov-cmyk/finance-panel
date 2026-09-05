"use client";

import {
  Boxes,
  Calculator,
  Gem,
  Loader2,
  RefreshCw,
  Search,
  WalletCards,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { summarizeUnitRows } from "@/lib/unit/summary";
import { sortByCustomSkuOrder } from "@/lib/wb/skuOrder";
import { useCabinetSkuOrder } from "@/lib/wb/useCabinetSkuOrder";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { METRIC_TEXT_TONE, marketplaceMetricStatus } from "@/lib/analytics/marketplaceMetrics";
import { useDialogBehavior } from "@/hooks/useDialogBehavior";
import { useCategoryMap } from "@/lib/useCategoryMap";
import { useDashboardFilter } from "@/lib/useDashboardFilter";
import { useSort, sortGlyph } from "@/lib/useSort";
import { WbProductImage } from "./WbProductImage";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";
import { formatUnitPeriod, getDefaultUnitPeriod, parseUnitPeriodQuery } from "@/lib/unit/period";
import { CabinetUnitSettings, type AppliedUnitSettings } from "@/components/unit/CabinetUnitSettings";

interface UnitData {
  headers: string[];
  rows: (string | number)[][];
  img_urls: string[];
  names: string[];
  meta_text: string;
  settings?: AppliedUnitSettings;
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
  /** Сколько SKU всего подходит под расчёт — шторка показывает первые 500. */
  total?: number;
  truncated?: boolean;
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

// Колонки в шапке сгруппированы по смыслу: сколько получили, сколько отдали,
// что осталось. Без этого 18 одинаковых столбцов читаются как сплошная стена.
const COLUMN_GROUPS: Array<{ title: string; headers: string[]; tone: string }> = [
  { title: "Товар", headers: ["Юрлицо", "SKU", "Остаток + в пути", "Себес ₽"], tone: "text-slate-500" },
  { title: "Продажи", headers: ["Цена до СПП ₽", "Цена с СПП ₽", "Заказы", "Выручка ₽", "Выкуп %"], tone: "text-sky-700" },
  { title: "Расходы", headers: ["Удержания WB %", "Удержания WB ₽", "Эквайринг ₽", "Комиссия кабинета ₽", "Реклама ₽", "ДРР %", "Налог ₽"], tone: "text-amber-700" },
  { title: "Итог", headers: ["Маржа/ед ₽", "Маржа % до ДРР", "Вал % ПОСЛЕ ДРР"], tone: "text-emerald-700" },
];

function groupSpans(headers: string[]): Array<{ title: string; span: number; tone: string }> {
  const spans: Array<{ title: string; span: number; tone: string }> = [];
  for (const header of headers) {
    const group = COLUMN_GROUPS.find((candidate) => candidate.headers.includes(header));
    const title = group?.title ?? "Цель";
    const tone = group?.tone ?? "text-violet-700";
    const last = spans[spans.length - 1];
    if (last && last.title === title) last.span += 1;
    else spans.push({ title, span: 1, tone });
  }
  return spans;
}

function SummaryCard({ label, value, detail, tone = "slate" }: { label: string; value: string; detail?: string; tone?: "slate" | "emerald" | "rose" | "violet" }) {
  const toneClass = {
    slate: "text-slate-900",
    emerald: "text-emerald-700",
    rose: "text-rose-600",
    violet: "text-violet-700",
  }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-0.5 text-lg font-bold tabular-nums ${toneClass}`}>{value}</div>
      {detail ? <div className="mt-0.5 text-[10px] text-slate-400">{detail}</div> : null}
    </div>
  );
}

function valueTone(header: string, value: string | number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "text-slate-600";
  if (/вал %/i.test(header)) return METRIC_TEXT_TONE[marketplaceMetricStatus("marginBeforeAds", numeric)];
  if (/маржа|дельта/i.test(header)) return METRIC_TEXT_TONE[marketplaceMetricStatus("marginAfterMarketplace", numeric)];
  if (/ддр|дрр/i.test(header)) return METRIC_TEXT_TONE[marketplaceMetricStatus("drrOrders", numeric)];
  return "text-slate-600";
}

export function WbUnitPage() {
  const { activeCabinet, cabinetId, cabinets, ready, loading: cabinetsLoading, error: cabinetsError, canWrite, canOperate, user } = useWbCabinet();
  // Кнопки синхронизации — операция, а не пометка. Раньше они показывались по
  // праву «описывать», и админ-селлер видел три кнопки, каждая из которых
  // гарантированно отвечала 403: путь /api/unit/refresh-* селлеру закрыт
  // гейтом целиком, независимо от уровня в кабинете.
  const canRunSync = canOperate && user?.role !== "seller";
  const [data, setData] = useState<UnitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [refreshing, setRefreshing] = useState<"prices" | "stocks" | "cogs" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [category, setCategory] = useDashboardFilter<string>("category", "");
  const [query, setQuery] = useState("");
  const [onlyProblem, setOnlyProblem] = useState(false);
  const [rowWindow, setRowWindow] = useState({ start: 0, end: 18 });
  const [solverOpen, setSolverOpen] = useState(false);
  const [solver, setSolver] = useState<PriceSolverData | null>(null);
  const [solverLoading, setSolverLoading] = useState(false);
  const [solverError, setSolverError] = useState<string | null>(null);
  const [solverWindow, setSolverWindow] = useState({ start: 0, end: 18 });
  const requestId = useRef(0);
  const solverRef = useRef<HTMLElement | null>(null);
  const elapsed = useElapsedSeconds(loading);
  const { categories, byArticle } = useCategoryMap();
  const [appliedPeriod, setAppliedPeriod] = useState(getDefaultUnitPeriod);
  const [draftPeriod, setDraftPeriod] = useState(getDefaultUnitPeriod);
  const [periodError, setPeriodError] = useState<string | null>(null);

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
    setData(null);
    const refreshParam = retryKey > 0 ? "&refresh=1" : "";
    fetch(`/api/unit/table?cabinet=${encodeURIComponent(cabinetId || "all")}&from=${encodeURIComponent(appliedPeriod.from)}&to=${encodeURIComponent(appliedPeriod.to)}${refreshParam}`, { cache: "no-store", signal: controller.signal })
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
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, ready, retryKey, appliedPeriod.from, appliedPeriod.to]);

  const applyPeriod = () => {
    try {
      const next = parseUnitPeriodQuery(new URLSearchParams({ from: draftPeriod.from, to: draftPeriod.to }));
      setAppliedPeriod(next);
      setPeriodError(null);
    } catch (cause) {
      setPeriodError(cause instanceof Error ? cause.message : "Некорректный период");
    }
  };

  // Индексы колонок ищем по заголовку, а не по позиции: набор колонок меняется
  // (появились «Цена с СПП» и «Комиссия кабинета»), а сводка должна оставаться верной.
  const columns = useMemo(() => {
    const headers = data?.headers ?? [];
    const find = (label: string) => headers.findIndex((header) => header === label);
    // В группе кабинетов часть колонок названа иначе — смысл тот же. Если
    // искать только по одному имени, find вернёт -1, сводка молча покажет нули
    // и «себестоимость у 0».
    const firstOf = (...labels: string[]) => {
      for (const label of labels) {
        const index = find(label);
        if (index >= 0) return index;
      }
      return -1;
    };
    return {
      cost: firstOf("Себес ₽", "Себес ₽/ед"),
      orders: find("Заказы"),
      revenue: find("Выручка ₽"),
      marginUnit: firstOf("Маржа/ед ₽", "Маржа ₽/ед"),
      marginPct: find("Маржа % до ДРР"),
      buyoutPct: firstOf("Выкуп %", "Продажи / заказы %"),
      ad: find("Реклама ₽"),
    };
  }, [data?.headers]);

  const numberAt = (row: (string | number)[], index: number): number | null => {
    if (index < 0) return null;
    const raw = row[index];
    // Пустая ячейка — это «посчитать нечем», а не ноль: Number("") === 0, и
    // строка без себестоимости молча становилась нулевой маржой.
    if (raw === "" || raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  const filteredIndices = useMemo(() => {
    const rows = data?.rows ?? [];
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return rows.map((_, index) => index).filter((index) => {
      const row = rows[index];
      const article = String(row[2]);
      if (category) {
        const matches = category === "__none" ? !byArticle[article] : byArticle[article] === category;
        if (!matches) return false;
      }
      if (onlyProblem) {
        const margin = numberAt(row, columns.marginUnit);
        const cost = numberAt(row, columns.cost);
        // Проблемный SKU — либо в минусе, либо считать нечем: без себестоимости
        // маржа не рассчитана, и такую строку тоже надо уметь быстро найти.
        if (!(margin != null && margin < 0) && !(cost == null || cost <= 0)) return false;
      }
      if (!needle) return true;
      const name = String(data?.names[index] ?? "");
      return `${article} ${name}`.toLocaleLowerCase("ru-RU").includes(needle);
    });
  }, [byArticle, category, columns.cost, columns.marginUnit, data, onlyProblem, query]);

  // Ручной порядок выдачи артикулов (настраивается в РНП): перечисленные —
  // первыми в заданной последовательности, остальные — как шли.
  const { orderIndex } = useCabinetSkuOrder(cabinetId && cabinetId !== "all" ? cabinetId : null);
  const orderedIndices = useMemo(
    () => sortByCustomSkuOrder(filteredIndices, (index) => Number((data?.rows ?? [])[index]?.[4]), orderIndex),
    [data, filteredIndices, orderIndex],
  );

  // Сводка считается по отфильтрованным строкам: цифры наверху должны совпадать
  // с тем, что человек видит в таблице, а не с полным кабинетом.
  const summary = useMemo(() => {
    const rows = data?.rows ?? [];
    return summarizeUnitRows(orderedIndices.map((index) => {
      const row = rows[index];
      return {
        revenue: numberAt(row, columns.revenue) ?? 0,
        orders: numberAt(row, columns.orders) ?? 0,
        buyoutPct: numberAt(row, columns.buyoutPct),
        marginUnit: numberAt(row, columns.marginUnit),
        ad: numberAt(row, columns.ad) ?? 0,
        cost: numberAt(row, columns.cost),
      };
    }));
  }, [columns.ad, columns.buyoutPct, columns.cost, columns.marginUnit, columns.orders, columns.revenue, data?.rows, orderedIndices]);

  // Карточка вместо таблицы (до md) раньше печатала только первые шесть колонок,
  // и маржи — то, ради чего экран открывают, — с телефона не было видно нигде.
  // Итоговые показатели поднимаем в свёрнутый вид, остальные уводим под
  // «Все показатели»: карточка остаётся короткой, но ни одна колонка не пропала.
  const mobileColumns = useMemo(() => {
    const headers = data?.headers ?? [];
    const isTotal = (header: string) => /маржа|вал %/i.test(header);
    const lead: number[] = [];
    const rest: number[] = [];
    headers.forEach((header, index) => {
      if (index < FIRST_DATA_COL) return;
      if (index < FIRST_DATA_COL + 6 || isTotal(header)) lead.push(index);
      else rest.push(index);
    });
    // sort стабилен, поэтому итоговые встают первыми, а порядок остальных не меняется.
    lead.sort((a, b) => Number(isTotal(headers[b])) - Number(isTotal(headers[a])));
    return { lead, rest };
  }, [data?.headers]);

  const { sorted: indices, sortField, sortDir, toggleSort } = useSort(orderedIndices, (rowIndex, field) => {
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

  // Escape, ловушка фокуса и неподвижный фон: без последнего свайп по длинной
  // таблице цен уводил страницу за спиной шторки, и закрыв её, человек
  // оказывался в другом месте экрана.
  const closeSolver = useCallback(() => setSolverOpen(false), []);
  useDialogBehavior(solverOpen, closeSolver, solverRef);

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
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold text-white shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60 lg:min-h-8 ${tone}`}
    >
      {refreshing === kind ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Icon className="h-3.5 w-3.5" />}
      {label}
    </button>
  );

  return (
    <div className="min-h-[calc(100dvh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
      <WbModuleHeader
        icon={Gem}
        title="Unit fact"
        description={data?.meta_text || "Цена до СПП − себестоимость − комиссия − эквайринг − ДРР − налог"}
        actions={
          <>
            {categories.length ? (
              <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Категория" className="min-h-11 max-w-44 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-600 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 lg:min-h-8">
                <option value="">Все категории</option>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
                <option value="__none">Без категории</option>
              </select>
            ) : null}
            {canRunSync ? actionButton("prices", "Обновить цены", WalletCards, "bg-violet-600 hover:bg-violet-700") : null}
            {canRunSync ? actionButton("stocks", "Обновить остатки", RefreshCw, "bg-amber-500 hover:bg-amber-600") : null}
            {canRunSync ? actionButton("cogs", "Обновить себест.", Boxes, "bg-violet-600 hover:bg-violet-700") : null}
            <button type="button" onClick={() => setSolverOpen(true)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 lg:min-h-8">
              <Calculator className="h-3.5 w-3.5" /> Калькулятор цены
            </button>
          </>
        }
      />

      <div className="px-2 py-3 sm:px-6">
        <div className="mb-3">
          <CabinetUnitSettings
            cabinetId={cabinetId || null}
            cabinetName={activeCabinet?.name}
            canWrite={canWrite}
            applied={data?.settings ?? null}
            onSaved={() => setRetryKey((value) => value + 1)}
          />
        </div>
        {data && !loading && !error ? (
          <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryCard label="SKU" value={summary.sku.toLocaleString("ru-RU")} detail={`себестоимость у ${summary.costKnown}`} />
            <SummaryCard
              label="Выручка заказов"
              value={rub(summary.ordersRevenue)}
              detail={`выкуплено ${rub(summary.buyoutRevenue)} · ${formatUnitPeriod(appliedPeriod)}`}
            />
            <SummaryCard label="Прибыль" value={rub(summary.profit)} detail="по выкупам, после ДРР и налога" tone={summary.profit < 0 ? "rose" : "emerald"} />
            <SummaryCard
              label="Маржа"
              value={summary.marginPct == null ? "—" : `${summary.marginPct.toFixed(1)}%`}
              detail="от выручки выкупов"
              tone={summary.marginPct != null && summary.marginPct < 0 ? "rose" : "emerald"}
            />
            <SummaryCard label="В минусе" value={summary.negative.toLocaleString("ru-RU")} detail="SKU с отрицательной маржой" tone={summary.negative ? "rose" : "emerald"} />
          </div>
        ) : null}
        {/* Заказ виден сразу, выкуп — после доставки. На коротком периоде прибыль
            по выкупам законно ниже: не прятать этот разрыв, а объяснить его. */}
        {data && !loading && !error && summary.ordersRevenue > 0 && summary.buyoutRevenue < summary.ordersRevenue * 0.5 ? (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            Выкуплено {Math.round(summary.buyouts).toLocaleString("ru-RU")} из {Math.round(summary.orders).toLocaleString("ru-RU")} заказов периода.
            Прибыль считается по выкупам — на коротком периоде доставка ещё идёт, и цифра догонит заказы позже.
          </div>
        ) : null}

        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
          <label className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по артикулу или названию"
              aria-label="Поиск товара"
              className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-xs outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
          </label>
          <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-[11px] font-medium text-slate-600">
            <input type="checkbox" checked={onlyProblem} onChange={(event) => setOnlyProblem(event.target.checked)} className="h-3.5 w-3.5 accent-violet-600" />
            Только проблемные
          </label>
          <span className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" />
          {/* Даты и «Применить» — один подблок: при переносе по flex-wrap кнопка
              отрывалась от полей, и между выбором периода и его применением
              вставала вся ширина экрана. Ошибка периода печатается тут же под
              полями, а не последней строкой всего ряда. */}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label className="flex h-10 items-center gap-1.5 text-[11px] font-medium text-slate-500">
              С
              <input type="date" value={draftPeriod.from} onChange={(event) => setDraftPeriod((current) => ({ ...current, from: event.target.value }))} className="h-10 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-violet-400" />
            </label>
            <label className="flex h-10 items-center gap-1.5 text-[11px] font-medium text-slate-500">
              по
              <input type="date" value={draftPeriod.to} onChange={(event) => setDraftPeriod((current) => ({ ...current, to: event.target.value }))} className="h-10 rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-violet-400" />
            </label>
            <button type="button" onClick={applyPeriod} className="h-10 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">Применить</button>
            {periodError ? <span role="alert" className="w-full text-xs text-rose-600">{periodError}</span> : null}
          </div>
          <span className="ml-auto text-[11px] text-slate-400">{formatUnitPeriod(appliedPeriod)}</span>
        </div>
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
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-700">{activeCabinet?.name ?? "Все кабинеты"}</span>
              <span className="text-slate-300">·</span>
              <span>{indices.length === (data.rows.length) ? `${indices.length} SKU` : `${indices.length} из ${data.rows.length} SKU`}</span>
              {summary.negative ? (
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">{summary.negative} в минусе</span>
              ) : null}
              <span className="ml-auto hidden text-[10px] text-slate-400 md:inline">Клик по заголовку — сортировка</span>
              {/* Заголовки таблицы — единственный способ сортировать, а сама
                  таблица до md заменена карточками. Без этой пары подсказка
                  «клик по заголовку» на телефоне обещала то, чего там нет. */}
              <div className="ml-auto flex items-center gap-1.5 md:hidden">
                <select
                  aria-label="Сортировка"
                  value={sortField ?? ""}
                  onChange={(event) => { if (event.target.value) toggleSort(event.target.value); }}
                  className="min-h-11 max-w-[190px] rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 outline-none focus:border-violet-400"
                >
                  <option value="" disabled>Сортировка</option>
                  <option value="2">Артикул</option>
                  {data.headers.slice(FIRST_DATA_COL).map((header, index) => <option key={`${header}-${index}`} value={String(FIRST_DATA_COL + index)}>{header}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => toggleSort(sortField ?? "2")}
                  aria-label={sortDir === -1 ? "Сортировать по возрастанию" : "Сортировать по убыванию"}
                  className="tap shrink-0 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600"
                >
                  {sortDir === -1 ? "↓" : "↑"}
                </button>
              </div>
            </div>
            <div className="max-h-[70svh] min-h-[360px] overflow-auto overscroll-contain md:max-h-[calc(100dvh-260px)]" onScroll={(event) => updateRowWindow(event.currentTarget)}>
              <table className="hidden w-full min-w-[1560px] border-collapse text-[11px] md:table">
                <thead className="sticky top-0 z-30">
                  <tr className="h-[26px] bg-slate-100">
                    <th className="sticky left-0 z-40 w-[245px] min-w-[245px] border-b border-r border-slate-200 bg-slate-100 px-3 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">Товар</th>
                    {groupSpans(data.headers.slice(FIRST_DATA_COL)).map((group, index) => (
                      <th
                        key={`${group.title}-${index}`}
                        colSpan={group.span}
                        className={`border-b border-r border-slate-200 px-2 text-center text-[10px] font-semibold uppercase tracking-wide last:border-r-0 ${group.tone}`}
                      >
                        {group.title}
                      </th>
                    ))}
                  </tr>
                  <tr className="h-[34px] bg-white">
                    <th onClick={() => toggleSort("2")} className="sticky left-0 z-40 w-[245px] min-w-[245px] cursor-pointer select-none border-b border-r border-slate-200 bg-white px-3 text-left font-semibold text-slate-600 hover:text-violet-700">Артикул{sortGlyph(sortField === "2", sortDir)}</th>
                    {data.headers.slice(FIRST_DATA_COL).map((header, index) => {
                      const field = String(FIRST_DATA_COL + index);
                      const active = sortField === field;
                      return (
                        <th
                          key={`${header}-${index}`}
                          onClick={() => toggleSort(field)}
                          className={`min-w-[84px] cursor-pointer select-none border-b border-r border-slate-200 px-2 text-right font-semibold last:border-r-0 hover:text-violet-700 ${active ? "text-violet-700" : "text-slate-500"}`}
                        >
                          {header}{sortGlyph(active, sortDir)}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rowWindow.start > 0 ? <tr aria-hidden="true" style={{ height: rowWindow.start * ROW_HEIGHT }}><td colSpan={data.headers.length} /></tr> : null}
                  {indices.slice(rowWindow.start, rowWindow.end).map((rowIndex) => {
                    const row = data.rows[rowIndex];
                    const marginUnit = numberAt(row, columns.marginUnit);
                    const negative = marginUnit != null && marginUnit < 0;
                    return (
                      <tr key={`${row[2]}-${rowIndex}`} className={`group h-[49px] border-b border-slate-100 transition-colors hover:bg-violet-50/40 ${negative ? "bg-rose-50/40" : ""}`}>
                        <td className={`sticky left-0 z-20 border-r border-slate-200 px-2 shadow-[1px_0_0_rgba(226,232,240,0.9)] ${negative ? "bg-[#fff1f2]" : "bg-white"} group-hover:bg-[#fbfaff]`}>
                          <div className="flex min-w-0 items-center gap-2">
                            <WbProductImage nm={Number(row[4])} src={data.img_urls[rowIndex]} className="h-9 w-9 shrink-0 rounded-md border border-slate-100 bg-slate-50 object-cover" />
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-slate-700">{show(row[2])}</div>
                              <div className="max-w-[185px] truncate text-[9px] text-slate-400">{data.names[rowIndex]}</div>
                            </div>
                          </div>
                        </td>
                        {row.slice(FIRST_DATA_COL).map((value, columnIndex) => {
                          const header = data.headers[FIRST_DATA_COL + columnIndex] || "";
                          // Итоговые колонки выделены: глаз должен цепляться за маржу,
                          // а не за середину строки с удержаниями.
                          const strong = /маржа|вал %/i.test(header);
                          return (
                            <td
                              key={columnIndex}
                              className={`border-r border-slate-100 px-2 text-right tabular-nums whitespace-nowrap last:border-r-0 ${strong ? "font-semibold" : ""} ${valueTone(header, value)}`}
                            >
                              {show(value)}
                            </td>
                          );
                        })}
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
                        <WbProductImage nm={Number(row[4])} src={data.img_urls[rowIndex]} className="h-10 w-10 shrink-0 rounded bg-slate-50 object-cover" />
                        <div className="min-w-0"><div className="truncate text-xs font-semibold text-slate-800">{show(row[2])}</div><div className="truncate text-[10px] text-slate-400">{data.names[rowIndex]}</div></div>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                        {mobileColumns.lead.map((column) => <div key={column} className="flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5"><dt className="text-[9px] text-slate-400">{data.headers[column]}</dt><dd className={`text-[10px] font-medium tabular-nums ${valueTone(data.headers[column], row[column])}`}>{show(row[column])}</dd></div>)}
                      </dl>
                      {mobileColumns.rest.length ? (
                        <details className="mt-2 border-t border-slate-100">
                          <summary className="tap-row flex cursor-pointer list-none items-center text-[10px] font-semibold text-violet-700">Все показатели ({mobileColumns.rest.length})</summary>
                          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 pb-1">
                            {mobileColumns.rest.map((column) => <div key={column} className="flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5"><dt className="text-[9px] text-slate-400">{data.headers[column]}</dt><dd className={`text-[10px] font-medium tabular-nums ${valueTone(data.headers[column], row[column])}`}>{show(row[column])}</dd></div>)}
                          </dl>
                        </details>
                      ) : null}
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
          <aside ref={solverRef} role="dialog" aria-modal="true" aria-label="Калькулятор цены" className="fixed bottom-0 right-0 top-[calc(54px+var(--safe-t))] z-[80] flex w-full max-w-[920px] flex-col border-l border-slate-200 bg-[#f6f7f9] pb-safe shadow-2xl">
            <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-violet-100 text-violet-700"><Calculator className="h-4 w-4" /></span>
              <div className="min-w-0"><h2 className="text-sm font-bold text-slate-800">Калькулятор цены</h2><p className="truncate text-[10px] text-slate-400">Цена под целевую маржу · {activeCabinet?.name ?? "все кабинеты"}{solver?.truncated ? ` · показаны первые ${solver.items.length} из ${solver.total ?? solver.items.length}` : ""}</p></div>
              <button type="button" onClick={() => setSolverOpen(false)} aria-label="Закрыть" className="ml-auto grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 lg:h-10 lg:w-10"><X className="h-4 w-4" /></button>
            </div>
            <div className="border-b border-slate-200 px-4 py-2 text-[11px] leading-4 text-slate-500">Обратный расчёт: какая цена нужна под 15 / 25 / 35% маржи и насколько она отличается от текущей.</div>
            <div className="min-h-0 flex-1 p-3">
              {solverLoading ? <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> Считаем цены по SKU…</div> : null}
              {solverError ? <WbErrorState message={solverError} /> : null}
              {!solverLoading && !solverError && solver && solver.items.length === 0 ? <WbEmptyState>Нужны себестоимость и заказы по SKU.</WbEmptyState> : null}
              {!solverLoading && !solverError && solver && solver.items.length ? (
                <div className="h-full max-h-[calc(100dvh-165px)] overflow-auto rounded-xl border border-slate-200 bg-white" onScroll={(event) => updateSolverWindow(event.currentTarget)}>
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
