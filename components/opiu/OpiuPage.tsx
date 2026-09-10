"use client";

import { formatPct, formatRub, formatTime } from "@/lib/analytics/format";
import { currentWeekStartParam, mondayOfWeek, todayParam } from "@/lib/opiu/weeks";
import type { MonthWeek } from "@/lib/opiu/weeks";
import { DEFAULT_OPIU_BRAND_ID, OPIU_BRANDS } from "@/lib/opiu/constants";
import type { OpiuReport, OpiuTableRow } from "@/lib/opiu/buildReport";
import { createOpiuRequestCoordinator } from "@/lib/opiu/requestCoordinator";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type OpiuTab = "sale_date" | "report_date";

/** Строки-подпункты "Прочие удержания" — сворачиваются/разворачиваются вместе, спрятаны по умолчанию. */
const OTHER_DEDUCTIONS_CHILD_IDS = new Set(["jem", "withdraw_now", "transit", "acceptance"]);

interface OpiuMeta {
  salesRows: number;
  ordersCount: number;
  costsCount: number;
  adCampaigns: number;
}

interface OpiuResponse {
  report: OpiuReport;
  reportByReportDate?: OpiuReport;
  timestamp: string;
  meta?: OpiuMeta;
  error?: string;
}

interface OpiuRangeResponse {
  report: OpiuReport;
  timestamp: string;
  meta?: OpiuMeta;
  error?: string;
}

function valueClass(
  value: number | null,
  row: Pick<OpiuTableRow, "kind" | "expense" | "id">,
): string {
  if (value == null || row.kind === "separator") return "text-slate-400";
  if (row.kind === "percent") return "text-slate-500";
  if (row.expense) return value > 0 ? "text-red-600" : value < 0 ? "text-emerald-600" : "text-slate-700";
  if (row.id === "marginal" || row.id === "gross") {
    if (value > 0) return "text-emerald-600";
    if (value < 0) return "text-red-600";
    return "text-slate-700";
  }
  if (value > 0) return "text-emerald-600";
  if (value < 0) return "text-red-600";
  return "text-slate-700";
}

function formatCell(value: number | null, row: Pick<OpiuTableRow, "kind" | "expense">): string {
  if (value == null) return "—";
  if (row.kind === "percent") return formatPct(value);
  const display = row.expense ? Math.abs(value) : value;
  return formatRub(display);
}

function toLocalISODate(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalISODate(d);
}

function defaultRangeFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return toLocalISODate(d);
}

function defaultRangeTo(): string {
  return toLocalISODate(new Date());
}

function OpiuTableSkeleton({ cols }: { cols: number }) {
  return (
    <div className="animate-pulse overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="h-4 w-48 rounded bg-slate-100" />
      </div>
      <div className="space-y-2 p-4">
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="h-8 w-40 shrink-0 rounded bg-slate-100" />
            {Array.from({ length: cols }).map((_, j) => (
              <div key={j} className="h-8 flex-1 rounded bg-slate-50" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function BrandMultiSelect({
  selected,
  onToggle,
  label,
}: {
  selected: string[];
  onToggle: (brandId: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-500">Бренд</label>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-10 min-w-[180px] items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute left-0 top-full z-20 mt-1 min-w-[220px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {OPIU_BRANDS.map((b) => {
            const checked = selected.includes(b.id);
            return (
              <button
                key={b.id}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => onToggle(b.id)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    checked ? "border-violet-600 bg-violet-600" : "border-slate-300 bg-white"
                  }`}
                >
                  {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                </span>
                {b.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function OpiuPage() {
  const [brands, setBrands] = useState<string[]>([DEFAULT_OPIU_BRAND_ID]);
  const [endDate, setEndDate] = useState(todayParam);
  const [tab, setTab] = useState<OpiuTab>("sale_date");
  const [data, setData] = useState<OpiuResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingWeeks, setSavingWeeks] = useState<Set<string>>(() => new Set());
  const [resyncingWeeks, setResyncingWeeks] = useState<Set<string>>(() => new Set());
  const [resyncError, setResyncError] = useState<string | null>(null);
  const [otherDeductionsExpanded, setOtherDeductionsExpanded] = useState(false);

  const [rangeFrom, setRangeFrom] = useState(defaultRangeFrom);
  const [rangeTo, setRangeTo] = useState(defaultRangeTo);
  const [rangeData, setRangeData] = useState<OpiuRangeResponse | null>(null);
  const [rangeLoading, setRangeLoading] = useState(true);
  const [rangeRefreshing, setRangeRefreshing] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);

  const fetchReport = useCallback(async (
    m: string,
    refresh = false,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ endDate: m });
    for (const b of brands) params.append("brand", b);
    if (refresh) params.set("refresh", "1");
    const res = await fetch(`/api/opiu?${params}`, { signal });
    const json = (await res.json()) as OpiuResponse & { error?: string };
    if (!res.ok) throw new Error(json.error ?? "Ошибка загрузки");
    return json;
  }, [brands]);

  const fetchReportRef = useRef(fetchReport);
  fetchReportRef.current = fetchReport;

  const coordinatorRef = useRef<ReturnType<
    typeof createOpiuRequestCoordinator<OpiuResponse>
  > | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = createOpiuRequestCoordinator<OpiuResponse>({
      fetchReport: (m, refresh, signal) => fetchReportRef.current(m, refresh, signal),
      writeWarehouse: async (payload) => {
        const res = await fetch("/api/opiu/warehouse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const json = (await res.json()) as { error?: string };
          throw new Error(json.error ?? "Ошибка сохранения");
        }
      },
      onReport: (json) => setData(json),
      onError: setError,
      onSavingChange: (payload, pendingCount) => {
        const key = `${payload.month}:${payload.weekStart}`;
        setSavingWeeks((current) => {
          const next = new Set(current);
          if (pendingCount > 0) next.add(key);
          else next.delete(key);
          return next;
        });
      },
      onReportStart: ({ refresh }) => {
        setError(null);
        setLoading(!refresh);
        setRefreshing(refresh);
      },
      onReportSettled: ({ refresh }) => {
        if (refresh) setRefreshing(false);
        else setLoading(false);
      },
    });
  }
  const coordinator = coordinatorRef.current;

  useEffect(() => {
    if (tab !== "report_date") return;
    coordinator.setMonth(endDate);
    setData(null);
    void coordinator.loadReport(endDate, false);
  }, [coordinator, endDate, tab, brands]);

  useEffect(() => () => coordinator.dispose(), [coordinator]);

  const isValidRange = rangeFrom && rangeTo && rangeFrom <= rangeTo;

  const fetchRange = useCallback(async (
    from: string,
    to: string,
    signal?: AbortSignal,
  ): Promise<OpiuRangeResponse> => {
    const params = new URLSearchParams({ dateFrom: from, dateTo: to });
    for (const b of brands) params.append("brand", b);
    const res = await fetch(`/api/opiu?${params}`, { signal });
    const json = (await res.json()) as OpiuRangeResponse & { error?: string };
    if (!res.ok) throw new Error(json.error ?? "Ошибка загрузки");
    return json;
  }, [brands]);

  useEffect(() => {
    if (tab !== "sale_date" || !isValidRange) return;
    const controller = new AbortController();
    setRangeError(null);
    setRangeLoading(true);
    fetchRange(rangeFrom, rangeTo, controller.signal)
      .then((json) => setRangeData(json))
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setRangeError(e instanceof Error ? e.message : "Ошибка загрузки");
      })
      .finally(() => setRangeLoading(false));
    return () => controller.abort();
  }, [tab, rangeFrom, rangeTo, isValidRange, fetchRange]);

  const handleEndDateChange = (nextEndDate: string) => {
    setError(null);
    setRefreshing(false);
    setLoading(true);
    setEndDate(nextEndDate);
  };

  const handleShiftWeeks = (weeks: number) => {
    handleEndDateChange(shiftDate(endDate, weeks * 7));
  };

  // Последняя (правая) неделя окна уже текущая — двигаться дальше в будущее некуда, там нет данных.
  const isAtLatestWeek = mondayOfWeek(endDate) >= currentWeekStartParam();

  const handleBrandToggle = (brandId: string) => {
    setBrands((current) => {
      const next = current.includes(brandId)
        ? current.filter((b) => b !== brandId)
        : [...current, brandId];
      // всегда должен быть выбран хотя бы один бренд
      return next.length > 0 ? next : current;
    });
    setError(null);
    setRangeError(null);
  };

  const handleRefresh = () => {
    if (tab === "sale_date") {
      if (!isValidRange) return;
      setRangeRefreshing(true);
      fetchRange(rangeFrom, rangeTo)
        .then((json) => setRangeData(json))
        .catch((e) => setRangeError(e instanceof Error ? e.message : "Ошибка загрузки"))
        .finally(() => setRangeRefreshing(false));
      return;
    }
    void coordinator.loadReport(endDate, true);
  };

  const handleResyncWeek = async (week: MonthWeek) => {
    setResyncError(null);
    setResyncingWeeks((current) => new Set(current).add(week.weekStart));
    try {
      // Пересинк идёт по WB-кабинету, а не по бренду — при нескольких выбранных
      // брендах на одном кабинете (Norvia/Heaton) достаточно одного запроса.
      const cabinetBrandIds = new Map<string, string>();
      for (const id of brands) {
        const b = OPIU_BRANDS.find((x) => x.id === id);
        if (b && !cabinetBrandIds.has(b.cabinetId)) cabinetBrandIds.set(b.cabinetId, b.id);
      }
      await Promise.all(
        [...cabinetBrandIds.values()].map((brand) =>
          fetch("/api/opiu/report-sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dateFrom: week.rangeFrom, dateTo: week.rangeTo, brand }),
          }).then(async (res) => {
            const json = (await res.json()) as { error?: string };
            if (!res.ok) throw new Error(json.error ?? "Ошибка пересинка");
          }),
        ),
      );
      await coordinator.loadReport(endDate, true);
    } catch (e) {
      setResyncError(e instanceof Error ? e.message : "Ошибка пересинка");
    } finally {
      setResyncingWeeks((current) => {
        const next = new Set(current);
        next.delete(week.weekStart);
        return next;
      });
    }
  };

  const selectedBrandLabels = OPIU_BRANDS.filter((b) => brands.includes(b.id)).map((b) => b.label);
  const currentBrandLabel = selectedBrandLabels.join(", ") || "—";
  const report = tab === "report_date" ? data?.report : rangeData?.report;
  const isRangeTab = tab === "sale_date";
  const weekCount = report?.weeks.length ?? 4;
  const colCount = isRangeTab ? 2 : weekCount + 2;
  const activeLoading = isRangeTab ? rangeLoading : loading;
  const activeRefreshing = isRangeTab ? rangeRefreshing : refreshing;
  const activeError = isRangeTab ? rangeError : error;
  const activeTimestamp = isRangeTab ? rangeData?.timestamp : data?.timestamp;
  const activeMeta = isRangeTab ? rangeData?.meta : data?.meta;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">ОПиУ</h1>
        <p className="mt-1 text-sm text-slate-500">
          {currentBrandLabel} · Wildberries · недели пн–вс
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <BrandMultiSelect selected={brands} onToggle={handleBrandToggle} label={currentBrandLabel} />

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-slate-500">Период</label>
          {isRangeTab ? (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={rangeFrom}
                max={rangeTo}
                onChange={(e) => setRangeFrom(e.target.value)}
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
              <span className="text-slate-400">–</span>
              <input
                type="date"
                value={rangeTo}
                min={rangeFrom}
                onChange={(e) => setRangeTo(e.target.value)}
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
          ) : (
            <input
              type="date"
              value={endDate}
              max={todayParam()}
              onChange={(e) => handleEndDateChange(e.target.value)}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          )}
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={activeRefreshing || activeLoading || (isRangeTab && !isValidRange)}
          className="mt-[26px] inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
        >
          {activeRefreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Обновить
        </button>
      </div>

      {isRangeTab && !isValidRange && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          Дата «по» не может быть раньше даты «с»
        </div>
      )}

      {resyncError && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          Пересинк не удался: {resyncError}
        </div>
      )}

      {activeError && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {activeError}
        </div>
      )}

      {activeTimestamp && !activeLoading && (
        <p className="text-xs text-slate-400">
          Данные WB: {formatTime(activeTimestamp)}
          {activeMeta && (
            <>
              {" · "}
              строк отчёта: {activeMeta.salesRows.toLocaleString("ru-RU")}, заказов:{" "}
              {activeMeta.ordersCount.toLocaleString("ru-RU")}, себестоимостей:{" "}
              {activeMeta.costsCount}
            </>
          )}
        </p>
      )}

      {report && report.missingCostArticles.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-medium">
            {report.missingCostArticles.length === 1 ? "Нет карточки в /costs у 1 артикула" : `Нет карточки в /costs у ${report.missingCostArticles.length} артикулов`}
            {" — Себестоимость и Подготовка по нему сейчас считаются как 0, а не как «не заполнено»."}
          </p>
          <p className="mt-1 text-amber-700">
            {report.missingCostArticles.map((m) => `${m.article} (${m.qty > 0 ? "+" : ""}${m.qty} шт.)`).join(", ")}
          </p>
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200">
        {(
          [
            { id: "report_date", label: "Свод по дате продажи" },
            { id: "sale_date", label: "Свод по произвольной дате" },
          ] as { id: OpiuTab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-violet-600 text-violet-600"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={isRangeTab ? undefined : "flex items-start gap-2"}>
        {!isRangeTab && (
          <button
            type="button"
            onClick={() => handleShiftWeeks(-1)}
            title="Неделя назад"
            aria-label="Неделя назад"
            className="tap-hit sticky top-[50vh] -translate-y-1/2 shrink-0 rounded-full border border-slate-200 bg-white p-2 text-slate-500 shadow-sm hover:bg-slate-50 hover:text-violet-600"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          {activeLoading ? (
            <OpiuTableSkeleton cols={colCount} />
          ) : tab === "report_date" && !report ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-800">
              Данные по дате продажи пока недоступны: источник не синхронизирован
            </div>
          ) : report ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table
                className={`w-full border-collapse text-[14px] ${
                  isRangeTab ? "table-fixed" : "min-w-[720px]"
                }`}
              >
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
                    <th
                      className={`sticky left-0 z-10 bg-slate-50 px-4 py-3.5 text-sm font-medium ${
                        isRangeTab ? "w-1/2" : "min-w-[220px]"
                      }`}
                    >
                      Показатель
                    </th>
                    {isRangeTab ? (
                      <th className="w-1/2 px-4 py-3.5 text-center text-sm font-medium">
                        {report.weeks[0]?.label ?? "Период"}
                      </th>
                    ) : (
                      <>
                        {report.weeks.map((w) => (
                          <th
                            key={w.weekStart}
                            className="w-[120px] px-3 py-3.5 text-center text-sm font-medium"
                          >
                            <div className="flex items-center justify-center gap-1">
                              <span>{w.label}</span>
                              <button
                                type="button"
                                onClick={() => void handleResyncWeek(w)}
                                disabled={resyncingWeeks.has(w.weekStart)}
                                title="Пересинкать финотчёт WB за эту неделю"
                                aria-label="Пересинкать неделю"
                                className="tap-hit shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-violet-600 disabled:opacity-50"
                              >
                                {resyncingWeeks.has(w.weekStart) ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                          </th>
                        ))}
                        <th className="w-[120px] px-4 py-3.5 text-center text-sm font-semibold text-slate-900">
                          Итого
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    let stripeIndex = 0;
                    const visibleRows = report.rows.filter(
                      (row) => otherDeductionsExpanded || !OTHER_DEDUCTIONS_CHILD_IDS.has(row.id),
                    );
                    return visibleRows.map((row) => {
                      if (row.kind === "separator") {
                        return (
                          <tr key={row.id}>
                            <td
                              colSpan={colCount}
                              className="h-2 border-y border-slate-100 bg-slate-50 px-4"
                            />
                          </tr>
                        );
                      }
    
                      const isPercent = row.kind === "percent";
                      const isTotal = row.id === "marginal" || row.id === "gross";
                      const isOtherRow = row.id === "other";
                      const isOtherChildRow = OTHER_DEDUCTIONS_CHILD_IDS.has(row.id);
                      const rowBg = isTotal
                        ? "bg-violet-50"
                        : stripeIndex % 2 === 1 ? "bg-slate-50" : "bg-white";
                      stripeIndex += 1;
                      const rowPad = isPercent ? "py-1.5" : "py-3";
                      const labelClass = isPercent
                        ? "text-xs text-slate-400"
                        : isTotal
                          ? "text-[14px] font-semibold text-slate-900"
                          : "text-[14px] text-slate-700";
                      const valueSizeClass = isPercent
                        ? "text-xs"
                        : isTotal
                          ? "text-[14px] font-semibold"
                          : "text-[14px] font-medium";

                      const labelContent = isOtherRow ? (
                        <button
                          type="button"
                          onClick={() => setOtherDeductionsExpanded((v) => !v)}
                          className="flex w-full items-center gap-1 text-left"
                        >
                          <ChevronRight
                            className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
                              otherDeductionsExpanded ? "rotate-90" : ""
                            }`}
                          />
                          {row.label}
                        </button>
                      ) : isOtherChildRow ? (
                        <span className="pl-[18px]">{row.label}</span>
                      ) : (
                        row.label
                      );

                      if (isRangeTab) {
                        const val = row.values[row.values.length - 1] ?? null;
                        return (
                          <tr
                            key={row.id}
                            className={`border-b border-slate-100 transition-colors hover:bg-violet-50 ${rowBg} ${
                              isTotal ? "border-t-2 border-t-violet-200" : ""
                            }`}
                          >
                            <td className={`sticky left-0 z-10 px-4 ${rowPad} ${rowBg} ${labelClass}`}>
                              {labelContent}
                            </td>
                            <td
                              className={`px-4 ${rowPad} text-center tabular-nums ${valueSizeClass} ${valueClass(val, row)}`}
                            >
                              {formatCell(val, row)}
                            </td>
                          </tr>
                        );
                      }
    
                      return (
                        <tr
                          key={row.id}
                          className={`border-b border-slate-100 transition-colors hover:bg-violet-50 ${rowBg} ${
                            isTotal ? "border-t-2 border-t-violet-200" : ""
                          }`}
                        >
                          <td className={`sticky left-0 z-10 px-4 ${rowPad} ${rowBg} ${labelClass}`}>
                            {labelContent}
                          </td>
                          {row.values.slice(0, -1).map((val, i) => {
                            const week = report.weeks[i];
                            const isEditable = row.editable && week;
    
                            if (isEditable && week) {
                              return (
                                <td key={week.weekStart} className="px-2 py-1.5 text-center">
                                  <input
                                    key={`${week.weekStart}-${val}`}
                                    type="text"
                                    defaultValue={val != null ? String(Math.round(val)) : "0"}
                                    disabled={savingWeeks.has(`${endDate}:${week.weekStart}`)}
                                    onBlur={(e) => {
                                      const next = e.target.value;
                                      const prev = val != null ? String(Math.round(val)) : "0";
                                      if (next !== prev) {
                                        void coordinator.saveWarehouse({
                                          month: endDate,
                                          weekStart: week.weekStart,
                                          amount: Number(next.replace(/\s/g, "").replace(",", ".")) || 0,
                                        });
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        (e.target as HTMLInputElement).blur();
                                      }
                                    }}
                                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-center text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                                  />
                                </td>
                              );
                            }
    
                            return (
                              <td
                                key={week?.weekStart ?? i}
                                className={`px-3 ${rowPad} text-center tabular-nums ${valueSizeClass} ${valueClass(val, row)}`}
                              >
                                {formatCell(val, row)}
                              </td>
                            );
                          })}
                          <td
                            className={`px-4 ${rowPad} text-center tabular-nums ${
                              isTotal ? "text-[14px] font-bold" : isPercent ? "text-xs font-medium" : "text-[14px] font-semibold"
                            } ${valueClass(row.values[row.values.length - 1] ?? null, row)}`}
                          >
                            {formatCell(row.values[row.values.length - 1] ?? null, row)}
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
        {!isRangeTab && (
          <button
            type="button"
            onClick={() => handleShiftWeeks(1)}
            disabled={isAtLatestWeek}
            title="Неделя вперёд"
            aria-label="Неделя вперёд"
            className="tap-hit sticky top-[50vh] -translate-y-1/2 shrink-0 rounded-full border border-slate-200 bg-white p-2 text-slate-500 shadow-sm hover:bg-slate-50 hover:text-violet-600 disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-500"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
