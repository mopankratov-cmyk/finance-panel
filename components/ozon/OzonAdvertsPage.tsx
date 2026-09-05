"use client";

import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { AdvertProfitGuardrail } from "@/lib/adverts/profitGuardrails";
import { OzonModuleHeader } from "./OzonModuleHeader";
import { OzonCsvButton, EmptyState, Freshness, MetricCard, OzonError, OzonLoading, OzonStaleNotice, OzonAdCoverageNotice, type OzonAdCoverageItem, OzonWarnings, ProductCell, formatDateTime, formatMoney, formatNumber, formatPercent } from "./OzonUi";
import { csvFileName, downloadCsv } from "@/lib/ozon/csvExport";
import { OzonCampaignsPanel } from "./OzonCampaignsPanel";
import { useOzonCabinet } from "./OzonCabinetContext";
import { sortRows } from "@/lib/ozon/tableSort";
import { useOzonCockpit } from "./useOzonCockpit";
import { useOzonUrlFilter } from "./useOzonUrlFilter";
import { useOzonPeriod } from "./useOzonPeriod";

interface AdvertRow { key: string; cabinet: string; sku: string; offerId: string; name: string; image: string | null; spent: number; adRevenue: number; revenue: number; orders: number; drr: number; adDrr: number; roas: number | null; attributionCompatible: boolean; economics: AdvertProfitGuardrail; updatedAt: string | null }
interface AdvertsData { generatedAt: string; scope: { label: string; count: number }; period: { from: string; to: string; days: number }; summary: { spent: number; allocatedSpent?: number; adRevenue: number; revenue: number; drr: number; adDrr: number; roas: number | null; calculatedProfit: number | null; profitCoveragePct: number; recommendations: number; sku: number }; rows: AdvertRow[]; adCoverage?: OzonAdCoverageItem[]; warnings: string[] }

function recommendationLabel(row: AdvertRow) {
  if (row.economics.action === "increase") return `Увеличить ${row.economics.budgetChangePct}%`;
  if (row.economics.action === "decrease") return `Снизить ${Math.abs(row.economics.budgetChangePct ?? 0)}%`;
  if (row.economics.action === "pause") return "Пауза";
  if (row.economics.action === "insufficient") return "Нет данных";
  return "Оставить";
}

function recommendationTone(action: AdvertProfitGuardrail["action"]) {
  if (action === "increase") return "bg-emerald-50 text-emerald-700";
  if (action === "decrease" || action === "pause") return "bg-red-50 text-red-700";
  if (action === "insufficient") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

export function OzonAdvertsPage() {
  const [query, setQuery] = useOzonUrlFilter<string>("q", "");
  const [sort, setSort] = useState<"spent" | "revenue" | "adRevenue" | "drr" | "roas">("spent");
  // Список умел только «по убыванию»: найти самый слабый товар было нечем.
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const { noCabinets } = useOzonCabinet();
  const { period, preset, applyPreset, applyRange } = useOzonPeriod();
  const { data, loading, error, updating, refresh, reload } = useOzonCockpit<AdvertsData>("adverts", period);
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    const base = (data?.rows ?? []).filter((row) => !needle || `${row.name} ${row.offerId} ${row.sku} ${row.cabinet}`.toLocaleLowerCase("ru-RU").includes(needle));
    // Общее правило сортировки: «нет данных» всегда внизу, в обе стороны.
    return sortRows(base, { key: sort, dir: sortDir }, (row, key) => row[key] as number | null);
  }, [data?.rows, query, sort, sortDir]);
  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      csvFileName(["ozon-реклама", data.scope.label, data.period.from, data.period.to]),
      [
        { header: "Товар", value: (row: AdvertRow) => row.name },
        { header: "Артикул", value: (row: AdvertRow) => row.offerId },
        { header: "SKU", value: (row: AdvertRow) => row.sku },
        { header: "Кабинет", value: (row: AdvertRow) => row.cabinet },
        { header: "Расход, ₽", value: (row: AdvertRow) => row.spent },
        { header: "Продажи с рекламы, ₽", value: (row: AdvertRow) => row.adRevenue },
        { header: "Общая выручка, ₽", value: (row: AdvertRow) => row.revenue },
        { header: "Заказы, шт", value: (row: AdvertRow) => row.orders },
        { header: "ДРР общий, %", value: (row: AdvertRow) => row.drr },
        { header: "ДРР рекламный, %", value: (row: AdvertRow) => row.adDrr },
        { header: "Break-even ДРР, %", value: (row: AdvertRow) => row.economics.breakEvenDrr },
        { header: "ROAS", value: (row: AdvertRow) => row.roas },
        { header: "Прибыль после рекламы, ₽", value: (row: AdvertRow) => row.economics.profitAfterAds },
        { header: "Дней запаса", value: (row: AdvertRow) => row.economics.daysCover },
        { header: "Рекомендация", value: (row: AdvertRow) => recommendationLabel(row) },
        { header: "Обоснование", value: (row: AdvertRow) => row.economics.reason },
        { header: "Уверенность, %", value: (row: AdvertRow) => row.economics.confidencePct },
      ],
      rows,
    );
  };
  return <div>
    <OzonModuleHeader eyebrow="Ozon · Performance" title="Реклама" subtitle="Расходы и атрибутированные продажи по SKU: общий ДРР, рекламный ДРР и ROAS." period={period} preset={preset} onApplyPreset={applyPreset} onApplyRange={applyRange} onRefresh={refresh} refreshing={loading} />
    <div className={`mx-auto max-w-[1600px] space-y-4 px-4 py-4 transition-opacity sm:px-5 ${updating ? "opacity-60" : ""}`}>
      {loading && !data ? <OzonLoading rows={9} /> : noCabinets ? <EmptyState title="Кабинет Ozon не подключён" detail="Добавьте кабинет с ключами Seller API и Performance API — после этого экраны наполнятся данными." href="/cabinets" /> : error && !data ? <OzonError message={error} onRetry={reload} /> : !data ? <EmptyState title="Нет рекламных данных" detail="Подключите Performance API и запустите синхронизацию." href="/cabinets" /> : <>
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-semibold text-slate-600">{data.scope.label} · {data.period.from} — {data.period.to}</div><Freshness generatedAt={data.generatedAt} /></div>
        {error ? <OzonStaleNotice message={error} onRetry={reload} /> : null}<OzonWarnings warnings={data.warnings} /><OzonAdCoverageNotice coverage={data.adCoverage} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-9"><MetricCard label="Расход" value={formatMoney(data.summary.spent)} detail={data.summary.allocatedSpent != null && data.summary.allocatedSpent < data.summary.spent ? `по товарам разложено ${formatMoney(data.summary.allocatedSpent)}` : undefined} tone="amber" /><MetricCard label="Прибыль после рекламы" value={formatMoney(data.summary.calculatedProfit)} detail={`покрытие ${formatPercent(data.summary.profitCoveragePct)}`} tone={data.summary.profitCoveragePct < 90 || data.summary.calculatedProfit == null ? "amber" : data.summary.calculatedProfit < 0 ? "red" : "emerald"} /><MetricCard label="Рекомендации" value={formatNumber(data.summary.recommendations)} detail="увеличить / снизить / пауза" tone={data.summary.recommendations ? "amber" : "emerald"} /><MetricCard label="Продажи с рекламы" value={formatMoney(data.summary.adRevenue)} /><MetricCard label="Общая выручка" value={formatMoney(data.summary.revenue)} /><MetricCard label="ДРР общий" value={formatPercent(data.summary.drr)} tone={data.summary.drr >= 30 ? "red" : data.summary.drr >= 20 ? "amber" : "emerald"} /><MetricCard label="ДРР рекламный" value={formatPercent(data.summary.adDrr)} /><MetricCard label="ROAS рекламный" value={data.summary.roas == null ? "—" : `${data.summary.roas.toLocaleString("ru-RU")}×`} /><MetricCard label="SKU в рекламе" value={formatNumber(data.summary.sku)} tone="slate" /></div>
        <OzonCampaignsPanel />
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:flex-row sm:items-center"><OzonCsvButton count={rows.length} onExport={exportCsv} /><label className="relative flex-1 sm:max-w-sm"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} type="search" enterKeyHint="search" placeholder="Поиск товара или кабинета" className="h-11 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-xs outline-none focus:border-sky-400 sm:h-8" /></label><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 sm:ml-auto sm:h-8" aria-label="Сортировка рекламы"><option value="spent">Расход</option><option value="adRevenue">Продажи с рекламы</option><option value="revenue">Общая выручка</option><option value="drr">ДРР</option><option value="roas">ROAS</option></select><button type="button" onClick={() => setSortDir((d) => d === "desc" ? "asc" : "desc")} title={sortDir === "desc" ? "Сейчас по убыванию — нажмите для возрастания" : "Сейчас по возрастанию — нажмите для убывания"} aria-label="Направление сортировки" className="grid h-11 w-11 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-sky-700 sm:h-8 sm:w-8">{sortDir === "desc" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUp className="h-3.5 w-3.5" />}</button></div>
          {rows.length === 0 ? <div className="p-4"><EmptyState title="Рекламные SKU не найдены" detail="Проверьте Performance API, синхронизацию и поиск." href="/sync" /></div> : (
            // scroll-x рисует на касании тонкую полосу и сдерживает жест на краю
            // таблицы; первая колонка закреплена — на 1580px без неё строка
            // теряет имя товара сразу после первой прокрутки вбок.
            <div className="scroll-x">
              <table className="w-full min-w-[1580px] text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="sticky left-0 z-20 bg-slate-50 px-4 py-2 text-left">Товар</th>
                    <th className="px-3 py-2 text-right">Расход</th>
                    <th className="px-3 py-2 text-right">Прибыль после рекламы</th>
                    <th className="px-3 py-2 text-right">Продажи с рекламы</th>
                    <th className="px-3 py-2 text-right">Общая выручка</th>
                    <th className="px-3 py-2 text-right">ДРР общий</th>
                    <th className="px-3 py-2 text-right">Break-even ДРР</th>
                    <th className="px-3 py-2 text-right">ДРР рекламный</th>
                    <th className="px-3 py-2 text-right">ROAS / break-even</th>
                    <th className="px-3 py-2 text-right">Запас</th>
                    <th className="px-3 py-2 text-left">Рекомендация</th>
                    <th className="px-3 py-2 text-right">Уверенность</th>
                    <th className="px-4 py-2 text-right">Обновлено</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className="group border-t border-slate-100 hover:bg-sky-50/40">
                      <td className="sticky left-0 z-10 bg-white px-4 py-2 group-hover:bg-[#f9fdff]"><ProductCell image={row.image} name={row.name} code={row.offerId || `SKU ${row.sku}`} cabinet={data.scope.count > 1 ? row.cabinet : undefined} /></td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(row.spent)}</td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${row.economics.profitAfterAds == null ? "text-slate-400" : row.economics.profitAfterAds < 0 ? "text-red-600" : "text-emerald-700"}`}>{row.economics.profitAfterAds == null ? "—" : formatMoney(row.economics.profitAfterAds)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.adRevenue)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.revenue)}</td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${row.drr >= 30 ? "text-red-600" : row.drr >= 20 ? "text-amber-600" : "text-emerald-700"}`}>{formatPercent(row.drr)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-600">{row.economics.breakEvenDrr == null ? "—" : formatPercent(row.economics.breakEvenDrr)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatPercent(row.adDrr)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{row.roas == null ? "—" : `${row.roas.toLocaleString("ru-RU")}×`} / {row.economics.breakEvenRoas == null ? "—" : `${row.economics.breakEvenRoas.toLocaleString("ru-RU")}×`}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.economics.daysCover == null ? "—" : `${row.economics.daysCover.toLocaleString("ru-RU")} дн.`}</td>
                      <td className="max-w-[240px] px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${recommendationTone(row.economics.action)}`}>{recommendationLabel(row)}</span>
                        {/* Причина видна текстом, а не в `title`: на касании
                            всплывающей подсказки нет, и менять бюджет
                            предлагалось вслепую. */}
                        {row.economics.reason ? <div className="mt-1 text-[10px] leading-4 text-slate-500">{row.economics.reason}</div> : null}
                        {row.economics.expectedProfitEffect != null && row.economics.expectedProfitEffect !== 0 ? <div className="mt-1 text-[9px] tabular-nums text-slate-400">эффект {row.economics.expectedProfitEffect > 0 ? "+" : ""}{formatMoney(row.economics.expectedProfitEffect)}</div> : null}
                        {!row.attributionCompatible ? <div className="mt-1 text-[9px] text-amber-600">атрибуция не совпадает</div> : null}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{row.economics.confidencePct}%</td>
                      <td className="px-4 py-2 text-right text-[10px] text-slate-400">{formatDateTime(row.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <p className="text-xs leading-4 text-slate-400 md:text-[10px]">Прибыль после рекламы и общий ДРР рассчитаны по общей выручке Seller API и экономике товара. Продажи с рекламы, рекламный ДРР и ROAS берутся из модели атрибуции Ozon Performance и могут отличаться. История изменения ставок Ozon пока недоступна через текущий источник, поэтому честное сравнение «до / после» здесь не показывается.</p>
      </>}
    </div>
  </div>;
}
