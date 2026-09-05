"use client";

import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalyticsTable, type Column } from "@/components/analytics/AnalyticsTable";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { PeriodRangePicker, type PeriodPreset } from "@/components/ui/PeriodRangePicker";
import { formatRub } from "@/lib/analytics/format";
import { moscowToday } from "@/lib/ui/calendarGrid";
import type { PenaltiesResponse } from "@/app/api/supplies/penalties/route";
import type { WbPenaltyGroup, WbPenaltyRow } from "@/lib/wb/penalties";
import { WbEmptyState, WbErrorState } from "./WbModuleHeader";

/** Под-вкладка: либо конкретная группа удержаний, либо весь финотчёт целиком. */
type GroupTab = WbPenaltyGroup | "all";

const GROUP_TABS: ReadonlyArray<[GroupTab, string]> = [
  ["dimensions", "Штрафы за габариты"],
  ["measurement", "Замеры склада"],
  ["substitution", "Подмены и вложения"],
  ["all", "Из финотчёта"],
];

const KPI_GROUPS: ReadonlyArray<{ group: WbPenaltyGroup; label: string }> = [
  { group: "dimensions", label: "Габариты" },
  { group: "measurement", label: "Замеры склада" },
  { group: "substitution", label: "Подмены и вложения" },
  { group: "other", label: "Прочие удержания" },
];

const DAY_PRESETS = [7, 30, 90] as const;

const PERIOD_PRESETS: ReadonlyArray<PeriodPreset> = [
  { value: "7", label: "7 дней" },
  { value: "30", label: "30 дней" },
  { value: "90", label: "90 дней" },
];

const PILL_BASE = "min-h-10 shrink-0 rounded-md px-3 text-[10px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 lg:min-h-8";

/** Период считаем от сегодняшнего московского дня — как остальные WB-экраны. */
function rangeForDays(days: number): { from: string; to: string } {
  const to = moscowToday();
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { from: start.toISOString().slice(0, 10), to };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

const money = (value: number) => (value === 0 ? "—" : formatRub(value));

/** Дата для сортировки: нераспознанная дата — null (уедет в конец), а не 0. */
const dayValue = (iso: string | null): number | null => {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
};

const columns: Column<WbPenaltyRow>[] = [
  {
    key: "date",
    label: "Дата",
    sortable: true,
    render: (row) => <span className="tabular-nums text-slate-600">{formatDate(row.date)}</span>,
    csv: (row) => row.date ?? "",
    // Даты сортируются числом: как текст «2026-08-19» превращается в 2026 и
    // все дни одного года становятся равными.
    sortValue: (row) => dayValue(row.date),
  },
  {
    key: "article",
    label: "Артикул",
    render: (row) => (
      <div>
        <div className="font-semibold text-violet-700">{row.article || (row.nmId ? String(row.nmId) : "по кабинету")}</div>
        {row.nmId ? <div className="text-[11px] tabular-nums text-slate-400">nm {row.nmId}</div> : null}
      </div>
    ),
    csv: (row) => row.article || (row.nmId ? String(row.nmId) : ""),
  },
  {
    key: "brand",
    label: "Бренд",
    render: (row) => <span className="text-slate-600">{row.brand ?? "—"}</span>,
    csv: (row) => row.brand ?? "",
  },
  {
    key: "reason",
    label: "Обоснование",
    render: (row) => <span className="text-slate-700">{row.reason || "—"}</span>,
    csv: (row) => row.reason,
  },
  {
    key: "operation",
    label: "Операция",
    render: (row) => <span className="text-slate-500">{row.operation || "—"}</span>,
    csv: (row) => row.operation,
  },
  {
    key: "penalty",
    label: "Штраф",
    align: "right",
    sortable: true,
    render: (row) => <span className="tabular-nums">{money(row.penalty)}</span>,
    csv: (row) => String(row.penalty),
  },
  {
    key: "deduction",
    label: "Удержание",
    align: "right",
    sortable: true,
    render: (row) => <span className="tabular-nums">{money(row.deduction)}</span>,
    csv: (row) => String(row.deduction),
  },
  {
    key: "total",
    label: "Итого",
    align: "right",
    sortable: true,
    render: (row) => (
      <span className={`tabular-nums font-semibold ${row.total > 0 ? "text-rose-600" : "text-slate-600"}`}>{money(row.total)}</span>
    ),
    csv: (row) => String(row.total),
  },
];

/** Кабинет должен быть один и реальный: удержания принадлежат юрлицу, а не выборке. */
function isSingleCabinet(cabinetId: string): boolean {
  return Boolean(cabinetId) && cabinetId !== "all" && !cabinetId.startsWith("group:");
}

export function WbPenaltiesTab({ cabinetId, cabinetName }: { cabinetId: string; cabinetName?: string }) {
  const [range, setRange] = useState(() => rangeForDays(30));
  const [group, setGroup] = useState<GroupTab>("dimensions");
  const [data, setData] = useState<PenaltiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const requestId = useRef(0);
  const elapsed = useElapsedSeconds(loading);
  const single = isSingleCabinet(cabinetId);
  const lastDay = useMemo(() => moscowToday(), []);

  const activeDays = useMemo(
    () => DAY_PRESETS.find((days) => {
      const preset = rangeForDays(days);
      return preset.from === range.from && preset.to === range.to;
    }) ?? null,
    [range],
  );

  const load = useCallback(() => {
    const controller = new AbortController();
    if (!single) return controller;
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ cabinet: cabinetId, from: range.from, to: range.to });
    fetch(`/api/supplies/penalties?${query.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as PenaltiesResponse;
        if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then((body) => { if (current === requestId.current) setData(body); })
      .catch((cause: unknown) => {
        if (current === requestId.current && !controller.signal.aborted) {
          setData(null);
          setError(cause instanceof Error ? cause.message : "Не удалось загрузить удержания");
        }
      })
      .finally(() => { if (current === requestId.current) setLoading(false); });
    return controller;
  }, [cabinetId, range, single]);

  useEffect(() => {
    const controller = load();
    return () => controller.abort();
  }, [load, retryKey]);

  const rows = useMemo(() => data?.data?.rows ?? [], [data]);
  const visibleRows = useMemo(
    () => (group === "all" ? rows : rows.filter((row) => row.group === group)),
    [rows, group],
  );
  const visibleTotal = useMemo(
    () => visibleRows.reduce((sum, row) => sum + row.total, 0),
    [visibleRows],
  );
  const summaryByGroup = useMemo(() => {
    const map = new Map<WbPenaltyGroup, { amount: number; rows: number }>();
    for (const item of data?.data?.summary ?? []) map.set(item.group, { amount: item.amount, rows: item.rows });
    return map;
  }, [data]);

  if (!single) {
    return <WbEmptyState>Штрафы читаются по одному реальному кабинету. Выберите кабинет в верхней панели.</WbEmptyState>;
  }

  const header = (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold text-slate-800">Штрафы и замеры склада</div>
          <div className="text-[11px] text-slate-400">Удержания WB: габариты упаковки, замеры, подмены товаров</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
            {DAY_PRESETS.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setRange(rangeForDays(days))}
                className={`${PILL_BASE} ${activeDays === days ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                {days} дней
              </button>
            ))}
          </div>
          <PeriodRangePicker
            from={range.from}
            to={range.to}
            presets={PERIOD_PRESETS}
            activePreset={activeDays ? String(activeDays) : undefined}
            maxIso={lastDay}
            align="right"
            onApplyPreset={(value) => setRange(rangeForDays(Number(value) || 30))}
            onApplyRange={(from, to) => setRange({ from, to })}
          />
        </div>
      </div>

      <div role="tablist" aria-label="Группы удержаний" className="scroll-x flex max-w-full gap-1 rounded-lg bg-slate-100 p-0.5">
        {GROUP_TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={group === value}
            onClick={() => setGroup(value)}
            className={`${PILL_BASE} ${group === value ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-3">
        {header}
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <LoadingBanner seconds={elapsed} hint={`удержания · ${cabinetName ?? "кабинет"}`} />
          <SkeletonTableRows rows={8} cols={8} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        {header}
        <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} />
      </div>
    );
  }

  const warnings = data?.meta.warnings ?? [];
  // Время среза: вкладка остаётся смонтированной при переключении, поэтому
  // без этой строки старые данные выглядели бы только что загруженными.
  const snapshotAt = data?.meta.generatedAt ? new Date(data?.meta.generatedAt).toLocaleString("ru-RU") : null;
  const exclusions = data?.data?.exclusions ?? null;

  return (
    <div className="space-y-3">
      {header}

      {warnings.length ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <ul className="space-y-0.5">
            {warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="px-1 text-[11px] text-slate-400">
        Группы собраны по тексту причины WB (bonus_type_name) — своего поля-классификатора у WB нет,
        поэтому редкая формулировка может попасть в «Прочие удержания».
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {KPI_GROUPS.map((kpi) => {
          const item = summaryByGroup.get(kpi.group);
          const amount = item?.amount ?? 0;
          return (
            <div
              key={kpi.group}
              title="Группа определена по тексту причины WB, а не по полю-классификатору"
              className={`rounded-xl border bg-white p-3 ${amount > 0 ? "border-rose-200" : "border-slate-200"}`}
            >
              <div className="text-[11px] text-slate-500">{kpi.label}</div>
              <div className={`mt-1 text-xl font-bold tabular-nums ${amount > 0 ? "text-rose-600" : "text-slate-400"}`}>{formatRub(amount)}</div>
              <div className="mt-0.5 text-[11px] text-slate-400">{item?.rows ?? 0} строк · по тексту причины</div>
            </div>
          );
        })}
        <div className="rounded-xl border border-slate-300 bg-slate-50 p-3">
          <div className="text-[11px] text-slate-500">Итого удержаний в выборке</div>
          {snapshotAt ? <div className="text-[11px] text-slate-400">Данные на {snapshotAt}</div> : null}
          <div className="mt-1 text-xl font-bold tabular-nums text-slate-800">{formatRub(data?.data?.total ?? 0)}</div>
          <div className="mt-0.5 text-[11px] text-slate-400">{formatDate(range.from)} — {formatDate(range.to)}</div>
        </div>
      </div>

      {exclusions ? (
        <div className="space-y-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[11px] text-slate-500">
          <div className="font-semibold text-slate-600">Это не вся сумма удержаний кабинета — вот что в неё не вошло</div>
          <div>
            Реклама и продвижение: {exclusions.advertRows} строк на {formatRub(exclusions.advertAmount)} — это расходы
            рекламного контура, а не штрафы склада.
          </div>
          <div>
            Вне товарного контура кабинета: {exclusions.outOfScopeRows} строк на {formatRub(exclusions.outOfScopeAmount)} —
            в том числе удержания по кабинету целиком, без привязки к товару.
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-slate-500">
        <span>
          {GROUP_TABS.find(([value]) => value === group)?.[1]}: {visibleRows.length} строк на {formatRub(visibleTotal)}
        </span>
        <span className="text-slate-400">источник — детализация финансового отчёта WB</span>
      </div>

      <AnalyticsTable
        columns={columns}
        data={visibleRows}
        filename={`wb-penalties-${cabinetName ?? cabinetId}-${range.to}.csv`}
        emptyMessage="За период удержаний нет."
      />
    </div>
  );
}
