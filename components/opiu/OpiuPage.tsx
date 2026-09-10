"use client";

import { formatPct, formatRub, formatTime } from "@/lib/analytics/format";
import { currentMonthParam } from "@/lib/opiu/weeks";
import type { MonthWeek } from "@/lib/opiu/weeks";
import { DEFAULT_OPIU_BRAND_ID, OPIU_BRANDS } from "@/lib/opiu/constants";
import type { OpiuReport, OpiuTableRow } from "@/lib/opiu/buildReport";
import { buildOpiuSheetPayload, exportOpiuToGoogleSheets, OPIU_SECTION_BEFORE } from "@/lib/opiu/googleSheetExport";
import { createOpiuRequestCoordinator } from "@/lib/opiu/requestCoordinator";
import { FileSpreadsheet, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type OpiuTab = "sale_date" | "report_date";

interface OpiuMeta {
  salesRows: number;
  ordersCount: number;
  costsCount: number;
  adCampaigns: number;
}

interface OpiuResponse {
  month: string;
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

function defaultRangeFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return toLocalISODate(d);
}

function defaultRangeTo(): string {
  return toLocalISODate(new Date());
}

function humanDate(value: string): string {
  const [year, month, day] = value.split("-");
  return [day, month, year].filter(Boolean).join(".");
}

function humanMonth(value: string): string {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  const label = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" })
    .format(new Date(year, month - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
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

export function OpiuPage() {
  const [brand, setBrand] = useState(DEFAULT_OPIU_BRAND_ID);
  const [month, setMonth] = useState(currentMonthParam);
  const [tab, setTab] = useState<OpiuTab>("sale_date");
  const [data, setData] = useState<OpiuResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingWeeks, setSavingWeeks] = useState<Set<string>>(() => new Set());
  const [resyncingWeeks, setResyncingWeeks] = useState<Set<string>>(() => new Set());
  const [resyncError, setResyncError] = useState<string | null>(null);

  const [rangeFrom, setRangeFrom] = useState(defaultRangeFrom);
  const [rangeTo, setRangeTo] = useState(defaultRangeTo);
  const [rangeData, setRangeData] = useState<OpiuRangeResponse | null>(null);
  const [rangeLoading, setRangeLoading] = useState(true);
  const [rangeRefreshing, setRangeRefreshing] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const [googleResult, setGoogleResult] = useState<{ message: string; url?: string; error?: boolean } | null>(null);

  const fetchReport = useCallback(async (
    m: string,
    refresh = false,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ month: m, brand });
    if (refresh) params.set("refresh", "1");
    const res = await fetch(`/api/opiu?${params}`, { signal });
    const json = (await res.json()) as OpiuResponse & { error?: string };
    if (!res.ok) throw new Error(json.error ?? "Ошибка загрузки");
    return json;
  }, [brand]);

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
    coordinator.setMonth(month);
    setData(null);
    void coordinator.loadReport(month, false);
  }, [coordinator, month, tab, brand]);

  useEffect(() => () => coordinator.dispose(), [coordinator]);

  const isValidRange = rangeFrom && rangeTo && rangeFrom <= rangeTo;

  const fetchRange = useCallback(async (
    from: string,
    to: string,
    signal?: AbortSignal,
  ): Promise<OpiuRangeResponse> => {
    const params = new URLSearchParams({ dateFrom: from, dateTo: to, brand });
    const res = await fetch(`/api/opiu?${params}`, { signal });
    const json = (await res.json()) as OpiuRangeResponse & { error?: string };
    if (!res.ok) throw new Error(json.error ?? "Ошибка загрузки");
    return json;
  }, [brand]);

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

  const handleMonthChange = (nextMonth: string) => {
    setError(null);
    setRefreshing(false);
    setLoading(true);
    setMonth(nextMonth);
  };

  const handleBrandChange = (nextBrand: string) => {
    setError(null);
    setRangeError(null);
    setGoogleResult(null);
    setBrand(nextBrand);
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
    void coordinator.loadReport(month, true);
  };

  const handleResyncWeek = async (week: MonthWeek) => {
    setResyncError(null);
    setResyncingWeeks((current) => new Set(current).add(week.weekStart));
    try {
      const res = await fetch("/api/opiu/report-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom: week.rangeFrom, dateTo: week.rangeTo, brand }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Ошибка пересинка");
      await coordinator.loadReport(month, true);
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

  const currentBrandLabel = OPIU_BRANDS.find((b) => b.id === brand)?.label ?? brand;
  const report = tab === "report_date" ? data?.reportByReportDate : rangeData?.report;
  const isRangeTab = tab === "sale_date";
  const weekCount = report?.weeks.length ?? 4;
  const colCount = isRangeTab ? 2 : weekCount + 2;
  const activeLoading = isRangeTab ? rangeLoading : loading;
  const activeRefreshing = isRangeTab ? rangeRefreshing : refreshing;
  const activeError = isRangeTab ? rangeError : error;
  const activeTimestamp = isRangeTab ? rangeData?.timestamp : data?.timestamp;
  const activeMeta = isRangeTab ? rangeData?.meta : data?.meta;
  const periodLabel = isRangeTab
    ? `${humanDate(rangeFrom)}–${humanDate(rangeTo)}`
    : humanMonth(month);
  const totalFor = (id: string) => {
    const values = report?.rows.find((row) => row.id === id)?.values;
    return values?.[values.length - 1] ?? null;
  };
  const displayRows: Array<OpiuTableRow | { id: string; label: string; kind: "section" }> = [];
  for (const row of report?.rows ?? []) {
    const section = OPIU_SECTION_BEFORE[row.id];
    if (section) displayRows.push({ id: `section:${row.id}`, label: section, kind: "section" });
    displayRows.push(row);
  }

  const handleGoogleExport = async () => {
    if (!report) return;
    setGoogleSyncing(true);
    setGoogleResult(null);
    try {
      const payload = buildOpiuSheetPayload(report, {
        brandLabel: currentBrandLabel,
        periodLabel,
        generatedAt: new Date(activeTimestamp ?? Date.now()).toLocaleString("ru-RU"),
      });
      const result = await exportOpiuToGoogleSheets(payload);
      setGoogleResult({ message: `Лист «${payload.sheetName}» обновлён`, url: result.spreadsheetUrl });
    } catch (exportError) {
      setGoogleResult({
        message: exportError instanceof Error ? exportError.message : "Не удалось выгрузить финансовый отчёт WB",
        error: true,
      });
    } finally {
      setGoogleSyncing(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 px-4 pb-8 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Финансовый отчёт WB</h1>
        <p className="mt-1 text-sm text-slate-500">
          {currentBrandLabel} · Wildberries · недели пн–вс
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:flex-wrap lg:items-end">
        <div className="flex min-w-0 flex-col gap-1.5 sm:min-w-48">
          <label className="text-sm font-medium text-slate-500">Бренд</label>
          <select
            value={brand}
            onChange={(e) => handleBrandChange(e.target.value)}
            className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          >
            {OPIU_BRANDS.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5 lg:flex-none">
          <label className="text-sm font-medium text-slate-500">Период</label>
          {isRangeTab ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="date"
                value={rangeFrom}
                max={rangeTo}
                onChange={(e) => setRangeFrom(e.target.value)}
                className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
              <span className="hidden text-slate-400 sm:inline">–</span>
              <input
                type="date"
                value={rangeTo}
                min={rangeFrom}
                onChange={(e) => setRangeTo(e.target.value)}
                className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
          ) : (
            <input
              type="month"
              value={month}
              onChange={(e) => handleMonthChange(e.target.value)}
              className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          )}
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={activeRefreshing || activeLoading || (isRangeTab && !isValidRange)}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
        >
          {activeRefreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Обновить
        </button>
        <button
          type="button"
          onClick={() => void handleGoogleExport()}
          disabled={!report || activeLoading || googleSyncing}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {googleSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          {googleSyncing ? "Выгружаю…" : "Google Таблица"}
        </button>
      </div>

      {googleResult && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${googleResult.error ? "border-red-300 bg-red-50 text-red-700" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>
          {googleResult.message}
          {googleResult.url && (
            <a href={googleResult.url} target="_blank" rel="noreferrer" className="ml-2 font-semibold underline underline-offset-2">
              Открыть таблицу
            </a>
          )}
        </div>
      )}

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

      {report && !activeLoading && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Выручка без СПП", value: totalFor("revenue_without_spp"), percent: false },
            { label: "Маржинальный доход", value: totalFor("marginal"), percent: false },
            { label: "Валовая прибыль", value: totalFor("gross"), percent: false },
            { label: "Рентабельность", value: totalFor("gross_pct"), percent: true },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
              <p className={`mt-2 text-xl font-bold tabular-nums ${item.value == null ? "text-slate-400" : item.value < 0 ? "text-red-600" : "text-slate-950"}`}>
                {item.value == null ? "—" : item.percent ? formatPct(item.value) : formatRub(item.value)}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="scroll-x flex gap-1 border-b border-slate-200">
        {(
          [
            { id: "sale_date", label: "Свод по произвольной дате" },
            { id: "report_date", label: "Свод по дате продажи" },
          ] as { id: OpiuTab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`min-h-11 shrink-0 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-violet-600 text-violet-600"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

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
                return displayRows.map((row) => {
                  if (row.kind === "section") {
                    return (
                      <tr key={row.id} className="border-y border-amber-300 bg-amber-300 text-slate-800">
                        <td colSpan={colCount} className="sticky left-0 z-10 bg-amber-300 px-4 py-2 text-xs font-bold uppercase tracking-wide">
                          {row.label}
                        </td>
                      </tr>
                    );
                  }
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
                          {row.label}
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
                        {row.label}
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
                                disabled={savingWeeks.has(`${month}:${week.weekStart}`)}
                                onBlur={(e) => {
                                  const next = e.target.value;
                                  const prev = val != null ? String(Math.round(val)) : "0";
                                  if (next !== prev) {
                                    void coordinator.saveWarehouse({
                                      month,
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
  );
}
