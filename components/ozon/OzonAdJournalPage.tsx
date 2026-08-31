"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { csvFileName, downloadCsv } from "@/lib/ozon/csvExport";
import { useOzonCabinet } from "./OzonCabinetContext";
import { OzonModuleHeader } from "./OzonModuleHeader";
import {
  EmptyState,
  Freshness,
  MetricCard,
  OzonAdCoverageNotice,
  OzonCsvButton,
  OzonError,
  OzonLoading,
  formatMoney,
  formatNumber,
  type OzonAdCoverageItem,
} from "./OzonUi";
import { useOzonPeriod } from "./useOzonPeriod";

interface JournalRow {
  key: string;
  cabinet: string;
  sku: string;
  offerId: string;
  name: string;
  image: string | null;
  total: number;
  adRevenue: number;
  byDay: Record<string, number>;
}

interface JournalData {
  generatedAt: string;
  scope: { label: string; count: number };
  period: { from: string; to: string; days: number };
  days: string[];
  totalsByDay: Record<string, number>;
  total: number;
  rows: JournalRow[];
  coverage: OzonAdCoverageItem[];
}

const dayLabel = (day: string) => day.slice(8, 10);
const monthLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("ru-RU", { month: "short", timeZone: "UTC" });

export function OzonAdJournalPage() {
  const { cabinetId, ready } = useOzonCabinet();
  const { period, preset, applyPreset, applyRange } = useOzonPeriod();
  const [query, setQuery] = useState("");
  const [data, setData] = useState<JournalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!ready || !cabinetId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ cabinet: cabinetId, from: period.from, to: period.to });
    fetch(`/api/ozon/ad-journal?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as JournalData & { error?: string };
        if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then(setData)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить журнал");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cabinetId, period.from, period.to, ready, reloadKey]);

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return (data?.rows ?? []).filter((row) => !needle
      || `${row.name} ${row.offerId} ${row.sku} ${row.cabinet}`.toLocaleLowerCase("ru-RU").includes(needle));
  }, [data?.rows, query]);

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      csvFileName(["ozon-журнал-рекламы", data.scope.label, data.period.from, data.period.to]),
      [
        { header: "Товар", value: (row: JournalRow) => row.name },
        { header: "Артикул", value: (row: JournalRow) => row.offerId },
        { header: "SKU", value: (row: JournalRow) => row.sku },
        { header: "Кабинет", value: (row: JournalRow) => row.cabinet },
        { header: "Расход за период, ₽", value: (row: JournalRow) => row.total },
        ...data.days.map((day) => ({ header: day, value: (row: JournalRow) => row.byDay[day] ?? 0 })),
      ],
      rows,
    );
  };

  // День с самым большим расходом стоит подсветить: именно его менеджер ищет
  // глазами, когда разбирается, откуда взялся скачок ДРР.
  const peakDay = useMemo(() => {
    if (!data) return null;
    return data.days.reduce<{ day: string; value: number } | null>((peak, day) => {
      const value = data.totalsByDay[day] ?? 0;
      return !peak || value > peak.value ? { day, value } : peak;
    }, null);
  }, [data]);

  return (
    <div>
      <OzonModuleHeader
        eyebrow="Ozon · Performance"
        title="Журнал рекламы"
        subtitle="Расход по каждому товару и каждому дню — видно, когда именно изменился темп трат."
        period={period}
        preset={preset}
        onApplyPreset={applyPreset}
        onApplyRange={applyRange}
        onRefresh={() => setReloadKey((key) => key + 1)}
        refreshing={loading}
      />
      <div className={`mx-auto max-w-[1600px] space-y-4 px-4 py-4 transition-opacity sm:px-5 ${loading && data ? "opacity-60" : ""}`}>
        {loading && !data ? <OzonLoading rows={10} />
          : error && !data ? <OzonError message={error} onRetry={() => setReloadKey((key) => key + 1)} />
            : !data ? <EmptyState title="Нет данных журнала" detail="История рекламы по дням ещё не собрана." />
              : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-slate-600">{data.scope.label} · {data.period.from} — {data.period.to}</div>
                    <Freshness generatedAt={data.generatedAt} />
                  </div>
                  <OzonAdCoverageNotice coverage={data.coverage} />

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <MetricCard label="Расход за период" value={formatMoney(data.total)} tone="amber" />
                    <MetricCard label="Товаров с расходом" value={formatNumber(data.rows.length)} />
                    <MetricCard
                      label="Средний расход в день"
                      value={formatMoney(data.days.length ? data.total / data.days.length : 0)}
                    />
                    <MetricCard
                      label="Пик расхода"
                      value={peakDay ? formatMoney(peakDay.value) : "—"}
                      detail={peakDay ? `${dayLabel(peakDay.day)} ${monthLabel(peakDay.day)}` : undefined}
                      tone="slate"
                    />
                  </div>

                  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:flex-row sm:items-center">
                      <label className="relative flex-1 sm:max-w-sm">
                        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <input
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder="Товар, артикул, SKU"
                          className="h-11 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-xs outline-none focus:border-sky-400 sm:h-8"
                        />
                      </label>
                      <div className="sm:ml-auto"><OzonCsvButton count={rows.length} onExport={exportCsv} /></div>
                    </div>

                    {rows.length === 0 ? (
                      <div className="p-4">
                        {data.total > 0 ? (
                          // Сумма по дням известна, а разнесения по товарам ещё
                          // нет: показать «расхода нет» здесь было бы прямой
                          // неправдой — деньги потрачены и видны ниже по дням.
                          <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-xs text-sky-900">
                            <div className="font-semibold">Расход по дням известен, разнесение по товарам ещё собирается</div>
                            <p className="mt-1">
                              Ozon отдаёт сумму за день сразу, а разбивку по товарам — отчётами, по очереди.
                              Итоги по дням ниже верные; строки товаров появятся по мере сбора.
                            </p>
                            <div className="mt-3 overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead className="text-[10px] uppercase tracking-wide text-sky-700">
                                  <tr>{data.days.map((day) => <th key={day} className="px-2 py-1 text-right">{dayLabel(day)}</th>)}</tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    {data.days.map((day) => (
                                      <td key={day} className="px-2 py-1 text-right font-semibold tabular-nums">
                                        {Math.round(data.totalsByDay[day] ?? 0).toLocaleString("ru-RU")}
                                      </td>
                                    ))}
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : (
                          <EmptyState
                            title="Расхода за период нет"
                            detail="Либо реклама не крутилась, либо история по этим дням ещё собирается — смотрите подпись о полноте выше."
                          />
                        )}
                      </div>
                    ) : (
                      <div className="max-h-[68vh] overflow-auto">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="sticky left-0 z-20 bg-slate-50 px-4 py-2 text-left">Товар</th>
                              <th className="px-3 py-2 text-right">Итого</th>
                              {data.days.map((day) => (
                                <th key={day} className={`px-2 py-2 text-right ${peakDay?.day === day ? "text-amber-700" : ""}`}>
                                  {dayLabel(day)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((row) => (
                              <tr key={row.key} className="border-t border-slate-100 hover:bg-sky-50/40">
                                <td className="sticky left-0 z-10 bg-white px-4 py-2">
                                  <div className="max-w-[280px] truncate font-semibold text-slate-800" title={row.name}>{row.name}</div>
                                  <div className="mt-0.5 text-[10px] text-slate-400">{row.offerId || `SKU ${row.sku}`}{data.scope.count > 1 ? ` · ${row.cabinet}` : ""}</div>
                                </td>
                                <td className="px-3 py-2 text-right font-bold tabular-nums">{formatMoney(row.total)}</td>
                                {data.days.map((day) => {
                                  const value = row.byDay[day] ?? 0;
                                  return (
                                    <td
                                      key={day}
                                      className={`px-2 py-2 text-right tabular-nums ${value === 0 ? "text-slate-300" : value >= row.total / data.days.length * 2 ? "font-semibold text-amber-700" : "text-slate-700"}`}
                                    >
                                      {value === 0 ? "—" : Math.round(value).toLocaleString("ru-RU")}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="sticky bottom-0 z-10 border-t-2 border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-700">
                            <tr>
                              <td className="sticky left-0 z-20 bg-slate-50 px-4 py-2.5">Итого по дням</td>
                              <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(data.total)}</td>
                              {data.days.map((day) => (
                                <td key={day} className="px-2 py-2.5 text-right tabular-nums">
                                  {Math.round(data.totalsByDay[day] ?? 0).toLocaleString("ru-RU")}
                                </td>
                              ))}
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </section>

                  <p className="rounded-lg bg-slate-100 px-3 py-2 text-[10px] text-slate-500">
                    Расход за сегодня Ozon отдаёт на следующий день — последний столбец наполняется с задержкой.
                    Прочерк означает «в этот день трат по товару не было», пустой период — что история ещё собирается.
                  </p>
                </>
              )}
      </div>
    </div>
  );
}
