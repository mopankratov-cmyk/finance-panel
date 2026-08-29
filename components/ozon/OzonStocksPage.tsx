"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { OzonModuleHeader } from "./OzonModuleHeader";
import { OzonCsvButton, EmptyState, Freshness, MetricCard, OzonError, OzonLoading, OzonStaleNotice, OzonWarnings, ProductCell, StatusPill, formatNumber } from "./OzonUi";
import { csvFileName, downloadCsv } from "@/lib/ozon/csvExport";
import { useOzonCabinet } from "./OzonCabinetContext";
import { useOzonCockpit } from "./useOzonCockpit";
import { useOzonUrlFilter } from "./useOzonUrlFilter";
import { useOzonPeriod } from "./useOzonPeriod";

type StockStatus = "all" | "out" | "critical" | "warning" | "ok" | "overstock";
interface StockRow { key: string; cabinet: string; offerId: string; name: string; image: string | null; free: number; reserved: number; orders: number; dailySales: number; daysCover: number | null; reorderQty: number; status: Exclude<StockStatus, "all">; warehouses: { name: string; value: number }[] }
interface StocksData { generatedAt: string; scope: { label: string; count: number }; period: { days: number; from: string; to: string }; summary: { free: number; reserved: number; sku: number; critical: number; overstock: number; reorderQty: number; cabinetsWithStocks: number; cabinets: number }; rows: StockRow[]; warnings: string[] }

export function OzonStocksPage() {
  const { noCabinets } = useOzonCabinet();
  const { period, preset, applyPreset, applyRange } = useOzonPeriod();
  const [query, setQuery] = useOzonUrlFilter<string>("q", "");
  const [status, setStatus] = useOzonUrlFilter<StockStatus>("status", "all", ["all", "out", "critical", "warning", "ok", "overstock"]);
  const { data, loading, error, updating, refresh, reload } = useOzonCockpit<StocksData>("stocks", period);
  const rows = useMemo(() => { const needle = query.trim().toLocaleLowerCase("ru-RU"); return (data?.rows ?? []).filter((row) => (status === "all" || row.status === status) && (!needle || `${row.name} ${row.offerId} ${row.cabinet}`.toLocaleLowerCase("ru-RU").includes(needle))); }, [data?.rows, query, status]);
  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      csvFileName(["ozon-остатки", data.scope.label, data.period.from, data.period.to]),
      [
        { header: "Товар", value: (row: StockRow) => row.name },
        { header: "Артикул", value: (row: StockRow) => row.offerId },
        { header: "Кабинет", value: (row: StockRow) => row.cabinet },
        { header: "Доступно, шт", value: (row: StockRow) => row.free },
        { header: "В резерве, шт", value: (row: StockRow) => row.reserved },
        { header: "Продано за период, шт", value: (row: StockRow) => row.orders },
        { header: "Продажи в день, шт", value: (row: StockRow) => row.dailySales },
        { header: "Дней запаса", value: (row: StockRow) => row.daysCover },
        { header: "К пополнению, шт", value: (row: StockRow) => row.reorderQty },
        { header: "Склады", value: (row: StockRow) => row.warehouses.map((w) => `${w.name}: ${w.value}`).join(", ") },
        { header: "Статус", value: (row: StockRow) => row.status },
      ],
      rows,
    );
  };
  return <div>
    <OzonModuleHeader eyebrow="Ozon · Запасы" title="Остатки и пополнение" subtitle="Дни запаса, критические SKU, излишки и ориентир пополнения на 30 дней по скорости продаж." period={period} preset={preset} onApplyPreset={applyPreset} onApplyRange={applyRange} onRefresh={refresh} refreshing={loading} />
    <div className={`mx-auto max-w-[1600px] space-y-4 px-4 py-4 transition-opacity sm:px-5 ${updating ? "opacity-60" : ""}`}>
      {loading && !data ? <OzonLoading rows={10} /> : noCabinets ? <EmptyState title="Кабинет Ozon не подключён" detail="Добавьте кабинет с ключами Seller API и Performance API — после этого экраны наполнятся данными." href="/cabinets" /> : error && !data ? <OzonError message={error} onRetry={reload} /> : !data ? <EmptyState title="Нет остатков" detail="Проверьте Seller API и выбранный кабинет." /> : <>
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-semibold text-slate-600">{data.scope.label} · спрос за {period.days} дней</div><Freshness generatedAt={data.generatedAt} /></div>{error ? <OzonStaleNotice message={error} onRetry={reload} /> : null}<OzonWarnings warnings={data.warnings} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"><MetricCard label="Доступно" value={formatNumber(data.summary.free)} /><MetricCard label="В резерве" value={formatNumber(data.summary.reserved)} tone="slate" /><MetricCard label="SKU" value={formatNumber(data.summary.sku)} /><MetricCard label="Критичные" value={formatNumber(data.summary.critical)} tone={data.summary.critical ? "red" : "emerald"} /><MetricCard label="Излишки" value={formatNumber(data.summary.overstock)} tone="amber" /><MetricCard label="К пополнению" value={`${formatNumber(data.summary.reorderQty)} шт.`} detail="цель 30 дней" /></div>
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-col gap-2 border-b border-slate-100 p-3 lg:flex-row lg:items-center"><div className="flex flex-wrap gap-1">{(["all", "out", "critical", "warning", "ok", "overstock"] as StockStatus[]).map((value) => <button key={value} type="button" onClick={() => setStatus(value)} className={`min-h-11 rounded-lg px-2.5 text-[11px] font-semibold sm:min-h-8 ${status === value ? "bg-sky-700 text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}>{({ all: "Все", out: "Нет остатка", critical: "≤ 7 дней", warning: "≤ 14 дней", ok: "Норма", overstock: "Излишек" } as Record<StockStatus, string>)[value]}</button>)}</div><div className="lg:ml-auto"><OzonCsvButton count={rows.length} onExport={exportCsv} /></div><label className="relative lg:max-w-sm flex-1"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Товар, артикул, кабинет" className="h-11 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-xs outline-none focus:border-sky-400 sm:h-8" /></label></div>
          {rows.length === 0 ? <div className="p-4">{data.summary.cabinetsWithStocks === 0 ? <EmptyState title="Ozon не отдал остатки" detail="Это сбой на стороне Ozon, а не пустой склад: причина — в блоке «Часть данных недоступна» выше. Нажмите «Обновить» через пару минут." /> : <EmptyState title="Нет товаров в этом срезе" detail="Измените фильтр, поиск или период спроса." />}</div> :<div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">Товар</th><th className="px-3 py-2 text-right">Доступно</th><th className="px-3 py-2 text-right">Резерв</th><th className="px-3 py-2 text-right">Продано</th><th className="px-3 py-2 text-right">В день</th><th className="px-3 py-2 text-right">Дней запаса</th><th className="px-3 py-2 text-right">К пополнению</th><th className="px-3 py-2 text-left">Склады</th><th className="px-4 py-2 text-right">Статус</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key} className="border-t border-slate-100 hover:bg-sky-50/40"><td className="px-4 py-2"><ProductCell image={row.image} name={row.name} code={row.offerId} cabinet={data.scope.count > 1 ? row.cabinet : undefined} /></td><td className={`px-3 py-2 text-right font-semibold tabular-nums ${row.free <= 0 ? "text-red-600" : ""}`}>{formatNumber(row.free)}</td><td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.reserved)}</td><td className="px-3 py-2 text-right tabular-nums">{formatNumber(row.orders)}</td><td className="px-3 py-2 text-right tabular-nums">{row.dailySales.toLocaleString("ru-RU")}</td><td className="px-3 py-2 text-right font-semibold tabular-nums">{row.daysCover == null ? "Нет продаж" : `${row.daysCover.toLocaleString("ru-RU")} дн.`}</td><td className="px-3 py-2 text-right font-semibold tabular-nums text-sky-700">{row.reorderQty ? `${formatNumber(row.reorderQty)} шт.` : "—"}</td><td className="max-w-64 px-3 py-2 text-[10px] text-slate-500">{row.warehouses.slice(0, 3).map((warehouse) => `${warehouse.name}: ${formatNumber(warehouse.value)}`).join(" · ") || "—"}</td><td className="px-4 py-2 text-right"><StatusPill status={row.status} /></td></tr>)}</tbody></table></div>}
        </section>
        <p className="text-[10px] text-slate-400">Рекомендация пополнения = прогноз продаж на 30 дней минус доступный остаток. Это ориентир, а не готовый заказ поставщику.</p>
      </>}
    </div>
  </div>;
}
