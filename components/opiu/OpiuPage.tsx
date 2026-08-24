"use client";

import { formatPct, formatRub, formatTime } from "@/lib/analytics/format";
import { currentMonthParam } from "@/lib/opiu/weeks";
import type { OpiuReport, OpiuTableRow } from "@/lib/opiu/buildReport";
import { checkReportConsistency } from "@/lib/opiu/dataHealthCheck";
import { createOpiuRequestCoordinator } from "@/lib/opiu/requestCoordinator";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type OpiuTab = "sale_date" | "report_date";

interface OpiuResponse {
  month: string;
  report: OpiuReport;
  reportByReportDate?: OpiuReport;
  timestamp: string;
  meta?: {
    salesRows: number;
    ordersCount: number;
    costsCount: number;
    adCampaigns: number;
  };
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
  const [month, setMonth] = useState(currentMonthParam);
  const [tab, setTab] = useState<OpiuTab>("sale_date");
  const [data, setData] = useState<OpiuResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingWeeks, setSavingWeeks] = useState<Set<string>>(() => new Set());

  const fetchReport = useCallback(async (
    m: string,
    refresh = false,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ month: m });
    if (refresh) params.set("refresh", "1");
    const res = await fetch(`/api/opiu?${params}`, { signal });
    const json = (await res.json()) as OpiuResponse & { error?: string };
    if (!res.ok) throw new Error(json.error ?? "Ошибка загрузки");
    return json;
  }, []);

  const coordinatorRef = useRef<ReturnType<
    typeof createOpiuRequestCoordinator<OpiuResponse>
  > | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = createOpiuRequestCoordinator<OpiuResponse>({
      fetchReport,
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
    coordinator.setMonth(month);
    setData(null);
    void coordinator.loadReport(month, false);
  }, [coordinator, month]);

  useEffect(() => () => coordinator.dispose(), [coordinator]);

  const handleMonthChange = (nextMonth: string) => {
    setError(null);
    setRefreshing(false);
    setLoading(true);
    setMonth(nextMonth);
  };

  const handleRefresh = () => {
    void coordinator.loadReport(month, true);
  };

  const handleWarehouseSave = (weekStart: string, raw: string) => {
    const amount = Number(raw.replace(/\s/g, "").replace(",", ".")) || 0;
    return coordinator.saveWarehouse({ month, weekStart, amount });
  };

  const report = tab === "report_date"
    ? data?.reportByReportDate
    : data?.report;
  const weekCount = report?.weeks.length ?? 4;
  const colCount = weekCount + 2;

  const healthIssues = useMemo(() => {
    if (!data?.report || !data.reportByReportDate) return [];
    return checkReportConsistency(data.report, data.reportByReportDate);
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">ОПиУ</h1>
          <p className="mt-1 text-sm text-slate-500">
            ИП Панкратов · Wildberries · недели пн–вс
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="month"
            value={month}
            onChange={(e) => handleMonthChange(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Обновить
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {data?.timestamp && !loading && (
        <p className="text-xs text-slate-400">
          Данные WB: {formatTime(data.timestamp)}
          {data.meta && (
            <>
              {" · "}
              строк отчёта: {data.meta.salesRows.toLocaleString("ru-RU")}, заказов:{" "}
              {data.meta.ordersCount.toLocaleString("ru-RU")}, себестоимостей:{" "}
              {data.meta.costsCount}
            </>
          )}
        </p>
      )}

      {healthIssues.length > 0 && !loading && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">
                Расхождение между сводами по дате продажи и по дате отчёта за месяц
              </p>
              <ul className="mt-1 space-y-0.5">
                {healthIssues.map((issue) => (
                  <li key={issue.id}>
                    {issue.label}: {formatRub(issue.saleDateTotal)} vs {formatRub(issue.reportDateTotal)}
                    {" "}(разница {formatPct(issue.diffPct)})
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-200">
        {(
          [
            { id: "sale_date", label: "Свод по дате продажи" },
            { id: "report_date", label: "Свод по дате отчёта" },
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

      {loading ? (
        <OpiuTableSkeleton cols={colCount} />
      ) : tab === "report_date" && !report ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-800">
          Данные по дате отчёта пока недоступны: источник не синхронизирован
        </div>
      ) : report ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
                <th className="sticky left-0 z-10 min-w-[200px] bg-slate-50 px-4 py-3 font-medium">
                  Показатель
                </th>
                {report.weeks.map((w) => (
                  <th
                    key={w.weekStart}
                    className="w-[120px] px-3 py-3 text-right font-medium"
                  >
                    {w.label}
                  </th>
                ))}
                <th className="w-[120px] px-4 py-3 text-right font-bold text-slate-900">
                  Итого
                </th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                let stripeIndex = 0;
                return report.rows.map((row) => {
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
                  const rowBg = stripeIndex % 2 === 1 ? "bg-slate-50" : "bg-white";
                  stripeIndex += 1;

                  return (
                    <tr
                      key={row.id}
                      className={`border-b border-slate-100 transition-colors hover:bg-violet-50 ${rowBg} ${
                        isTotal ? "border-t-2 border-t-slate-300" : ""
                      }`}
                    >
                      <td
                        className={`sticky left-0 z-10 px-4 py-2.5 ${rowBg} ${
                          isPercent ? "text-xs text-slate-500" : "text-slate-700"
                        } ${isTotal ? "font-medium text-slate-900" : ""}`}
                      >
                        {row.label}
                      </td>
                      {row.values.slice(0, -1).map((val, i) => {
                        const week = report.weeks[i];
                        const isEditable = row.editable && week;

                        if (isEditable && week) {
                          return (
                            <td key={week.weekStart} className="px-2 py-1.5 text-right">
                              <input
                                key={`${week.weekStart}-${val}`}
                                type="text"
                                defaultValue={val != null ? String(Math.round(val)) : "0"}
                                disabled={savingWeeks.has(`${month}:${week.weekStart}`)}
                                onBlur={(e) => {
                                  const next = e.target.value;
                                  const prev = val != null ? String(Math.round(val)) : "0";
                                  if (next !== prev) {
                                    void handleWarehouseSave(week.weekStart, next);
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    (e.target as HTMLInputElement).blur();
                                  }
                                }}
                                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-right text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                              />
                            </td>
                          );
                        }

                        return (
                          <td
                            key={week?.weekStart ?? i}
                            className={`px-3 py-2.5 text-right tabular-nums ${
                              isPercent ? "text-xs" : ""
                            } ${valueClass(val, row)}`}
                          >
                            {formatCell(val, row)}
                          </td>
                        );
                      })}
                      <td
                        className={`px-4 py-2.5 text-right font-bold tabular-nums ${
                          isPercent ? "text-xs" : ""
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
