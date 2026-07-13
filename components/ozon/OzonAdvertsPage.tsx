"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { OzonModuleHeader } from "./OzonModuleHeader";
import { EmptyState, Freshness, MetricCard, OzonError, OzonLoading, OzonWarnings, ProductCell, formatDateTime, formatMoney, formatNumber, formatPercent } from "./OzonUi";
import { useOzonCockpit } from "./useOzonCockpit";

interface AdvertRow { key: string; cabinet: string; sku: string; offerId: string; name: string; image: string | null; spent: number; adRevenue: number; revenue: number; orders: number; drr: number; adDrr: number; roas: number; updatedAt: string | null }
interface AdvertsData { generatedAt: string; scope: { label: string; count: number }; period: { from: string; to: string; days: number }; summary: { spent: number; adRevenue: number; revenue: number; drr: number; adDrr: number; roas: number; sku: number }; rows: AdvertRow[]; warnings: string[] }

export function OzonAdvertsPage() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"spent" | "revenue" | "adRevenue" | "drr" | "roas">("spent");
  const { data, loading, error, refresh } = useOzonCockpit<AdvertsData>("adverts", 14);
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return [...(data?.rows ?? [])].filter((row) => !needle || `${row.name} ${row.offerId} ${row.sku} ${row.cabinet}`.toLocaleLowerCase("ru-RU").includes(needle)).sort((a, b) => b[sort] - a[sort]);
  }, [data?.rows, query, sort]);
  return <div>
    <OzonModuleHeader eyebrow="Ozon · Performance" title="Реклама" subtitle="Расходы и атрибутированные продажи по SKU за 14 дней: общий ДРР, рекламный ДРР и ROAS." onRefresh={refresh} refreshing={loading} />
    <div className="mx-auto max-w-[1600px] space-y-4 px-4 py-4 sm:px-5">
      {loading && !data ? <OzonLoading rows={9} /> : error ? <OzonError message={error} onRetry={refresh} /> : !data ? <EmptyState title="Нет рекламных данных" detail="Подключите Performance API и запустите синхронизацию." href="/cabinets" /> : <>
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-semibold text-slate-600">{data.scope.label} · {data.period.from} — {data.period.to}</div><Freshness generatedAt={data.generatedAt} /></div>
        <OzonWarnings warnings={data.warnings} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7"><MetricCard label="Расход" value={formatMoney(data.summary.spent)} tone="amber" /><MetricCard label="Продажи с рекламы" value={formatMoney(data.summary.adRevenue)} /><MetricCard label="Общая выручка" value={formatMoney(data.summary.revenue)} /><MetricCard label="ДРР общий" value={formatPercent(data.summary.drr)} tone={data.summary.drr >= 30 ? "red" : data.summary.drr >= 20 ? "amber" : "emerald"} /><MetricCard label="ДРР рекламный" value={formatPercent(data.summary.adDrr)} /><MetricCard label="ROAS" value={`${data.summary.roas.toLocaleString("ru-RU")}×`} /><MetricCard label="SKU в рекламе" value={formatNumber(data.summary.sku)} tone="slate" /></div>
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-col gap-2 border-b border-slate-100 p-3 sm:flex-row sm:items-center"><label className="relative flex-1 sm:max-w-sm"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск товара или кабинета" className="h-11 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-xs outline-none focus:border-sky-400 sm:h-8" /></label><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 sm:ml-auto sm:h-8" aria-label="Сортировка рекламы"><option value="spent">Расход</option><option value="adRevenue">Продажи с рекламы</option><option value="revenue">Общая выручка</option><option value="drr">ДРР</option><option value="roas">ROAS</option></select></div>
          {rows.length === 0 ? <div className="p-4"><EmptyState title="Рекламные SKU не найдены" detail="Проверьте Performance API, синхронизацию и поиск." href="/sync" /></div> : <div className="overflow-x-auto"><table className="w-full min-w-[1020px] text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">Товар</th><th className="px-3 py-2 text-right">Расход</th><th className="px-3 py-2 text-right">Продажи с рекламы</th><th className="px-3 py-2 text-right">Общая выручка</th><th className="px-3 py-2 text-right">Заказы</th><th className="px-3 py-2 text-right">ДРР общий</th><th className="px-3 py-2 text-right">ДРР рекламный</th><th className="px-3 py-2 text-right">ROAS</th><th className="px-4 py-2 text-right">Обновлено</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key} className="border-t border-slate-100 hover:bg-sky-50/40"><td className="px-4 py-2"><ProductCell image={row.image} name={row.name} code={row.offerId || `SKU ${row.sku}`} cabinet={data.scope.count > 1 ? row.cabinet : undefined} /></td><td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(row.spent)}</td><td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.adRevenue)}</td><td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.revenue)}</td><td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.orders)}</td><td className={`px-3 py-2 text-right font-semibold tabular-nums ${row.drr >= 30 ? "text-red-600" : row.drr >= 20 ? "text-amber-600" : "text-emerald-700"}`}>{formatPercent(row.drr)}</td><td className="px-3 py-2 text-right tabular-nums">{formatPercent(row.adDrr)}</td><td className="px-3 py-2 text-right font-semibold tabular-nums">{row.roas.toLocaleString("ru-RU")}×</td><td className="px-4 py-2 text-right text-[10px] text-slate-400">{formatDateTime(row.updatedAt)}</td></tr>)}</tbody></table></div>}
        </section>
        <p className="text-[10px] text-slate-400">Атрибуция продаж берётся из Ozon Performance; общая выручка — из Seller API. Поэтому два показателя могут относиться к разным моделям атрибуции.</p>
      </>}
    </div>
  </div>;
}
