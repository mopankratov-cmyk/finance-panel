"use client";

import { formatPct, formatRub, formatTime } from "@/lib/analytics/format";
import { currentMonthParam } from "@/lib/opiu/weeks";
import type { OpiuReport, OpiuTableRow } from "@/lib/opiu/buildReport";
import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface OpiuResponse {
  month: string;
  report: OpiuReport;
  timestamp: string;
  error?: string;
}

function valueClass(value: number | null, kind: OpiuTableRow["kind"]): string {
  if (value == null || kind === "separator") return "text-slate-400";
  if (kind === "percent") return "text-slate-400";
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-slate-300";
}

function formatCell(value: number | null, kind: OpiuTableRow["kind"]): string {
  if (value == null) return "—";
  if (kind === "percent") return formatPct(value);
  return formatRub(value);
}

function OpiuTableSkeleton({ cols }: { cols: number }) {
  return (
    <div className="animate-pulse overflow-hidden rounded-xl border border-white/10 bg-[#16162a]">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="h-4 w-48 rounded bg-white/10" />
      </div>
      <div className="space-y-2 p-4">
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="h-8 w-40 shrink-0 rounded bg-white/10" />
            {Array.from({ length: cols }).map((_, j) => (
              <div key={j} className="h-8 flex-1 rounded bg-white/5" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function OpiuPage() {
  const [month, setMonth] = useState(currentMonthParam);
  const [data, setData] = useState<OpiuResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingWeek, setSavingWeek] = useState<string | null>(null);

  const fetchReport = useCallback(async (m: string, refresh = false) => {
    const params = new URLSearchParams({ month: m });
    if (refresh) params.set("refresh", "1");
    const res = await fetch(`/api/opiu?${params}`);
    const json = (await res.json()) as OpiuResponse & { error?: string };
    if (!res.ok) throw new Error(json.error ?? "Ошибка загрузки");
    return json;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchReport(month)
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [month, fetchReport]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const json = await fetchReport(month, true);
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка обновления");
    } finally {
      setRefreshing(false);
    }
  };

  const handleWarehouseSave = async (weekStart: string, raw: string) => {
    const amount = Number(raw.replace(/\s/g, "").replace(",", ".")) || 0;
    setSavingWeek(weekStart);
    try {
      const res = await fetch("/api/opiu/warehouse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, weekStart, amount }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "Ошибка сохранения");
      }
      const json = await fetchReport(month);
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSavingWeek(null);
    }
  };

  const report = data?.report;
  const weekCount = report?.weeks.length ?? 4;
  const colCount = weekCount + 2;

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
            onChange={(e) => setMonth(e.target.value)}
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
        </p>
      )}

      {loading ? (
        <OpiuTableSkeleton cols={colCount} />
      ) : report ? (
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#1a1a2e] shadow-lg">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-slate-400">
                <th className="sticky left-0 z-10 min-w-[200px] bg-[#1a1a2e] px-4 py-3 font-medium">
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
                <th className="w-[120px] px-4 py-3 text-right font-bold text-white">
                  Итого
                </th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => {
                if (row.kind === "separator") {
                  return (
                    <tr key={row.id} className="bg-black/25">
                      <td
                        colSpan={colCount}
                        className="h-2 border-y border-white/5 px-4"
                      />
                    </tr>
                  );
                }

                const isPercent = row.kind === "percent";

                return (
                  <tr
                    key={row.id}
                    className="border-b border-white/5 transition-colors hover:bg-white/5"
                  >
                    <td
                      className={`sticky left-0 z-10 bg-[#1a1a2e] px-4 py-2.5 ${
                        isPercent ? "text-xs text-slate-500" : "text-slate-200"
                      }`}
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
                              disabled={savingWeek === week.weekStart}
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
                              className="w-full rounded border border-white/15 bg-[#16162a] px-2 py-1 text-right text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
                            />
                          </td>
                        );
                      }

                      return (
                        <td
                          key={week?.weekStart ?? i}
                          className={`px-3 py-2.5 text-right tabular-nums ${
                            isPercent ? "text-xs" : ""
                          } ${valueClass(val, row.kind)}`}
                        >
                          {formatCell(val, row.kind)}
                        </td>
                      );
                    })}
                    <td
                      className={`px-4 py-2.5 text-right font-bold tabular-nums ${
                        isPercent ? "text-xs" : ""
                      } ${valueClass(row.values[row.values.length - 1] ?? null, row.kind)}`}
                    >
                      {formatCell(row.values[row.values.length - 1] ?? null, row.kind)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
