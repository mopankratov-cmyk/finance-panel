"use client";

import { BarChart3, Filter, Search, ShoppingCart } from "lucide-react";
import { useMemo, useState } from "react";
import { OzonModuleHeader } from "./OzonModuleHeader";
import { OzonCsvButton, EmptyState, Freshness, MetricCard, OzonError, OzonLoading, OzonStaleNotice, OzonAdCoverageNotice, type OzonAdCoverageItem, OzonWarnings, ProductCell, formatMoney, formatNumber, formatPercent } from "./OzonUi";
import { csvFileName, downloadCsv } from "@/lib/ozon/csvExport";
import { useOzonCockpit } from "./useOzonCockpit";
import { useOzonUrlFilter } from "./useOzonUrlFilter";
import { useOzonPeriod } from "./useOzonPeriod";

interface SalesRow {
  key: string; cabinet: string; sku: string; offerId: string; name: string; image: string | null;
  views: number; carts: number; orders: number; revenue: number; avgPrice: number;
  crCart: number | null; crOrder: number | null; stock: number; adSpend: number; drr: number;
  daily: { day: string; orders: number; revenue: number }[]; funnelAvailable: boolean;
}

interface SalesData {
  generatedAt: string; scope: { label: string; count: number }; period: { days: number; from: string; to: string };
  summary: { views: number; carts: number; orders: number; revenue: number; avgPrice: number; crCart: number | null; crOrder: number | null };
  funnelAvailable: boolean; funnelCabinets: string[]; rows: SalesRow[]; adCoverage?: OzonAdCoverageItem[]; warnings: string[];
}

type SortKey = "revenue" | "orders" | "stock" | "adSpend" | "drr" | "views" | "carts" | "crCart" | "crOrder";

function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return <div className="flex h-7 items-end justify-end gap-px" aria-label={`Динамика: ${values.join(", ")}`}>{values.map((value, index) => <span key={index} className="w-1.5 rounded-t bg-sky-400" style={{ height: `${Math.max(2, value / max * 100)}%` }} />)}</div>;
}

export function OzonSalesPage() {
  const { period, preset, applyPreset, applyRange } = useOzonPeriod();
  const [tab, setTab] = useState<"rnp" | "funnel">("rnp");
  const [query, setQuery] = useOzonUrlFilter<string>("q", "");
  const [sort, setSort] = useState<SortKey>("revenue");
  const { data, loading, error, updating, refresh, reload } = useOzonCockpit<SalesData>("sales", period);
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return [...(data?.rows ?? [])]
      .filter((row) => !needle || `${row.name} ${row.offerId} ${row.sku} ${row.cabinet}`.toLocaleLowerCase("ru-RU").includes(needle))
      .sort((left, right) => Number(right[sort] ?? -1) - Number(left[sort] ?? -1));
  }, [data?.rows, query, sort]);
  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      csvFileName(["ozon-продажи", data.scope.label, data.period.from, data.period.to]),
      [
        { header: "Товар", value: (row: SalesRow) => row.name },
        { header: "Артикул", value: (row: SalesRow) => row.offerId },
        { header: "SKU", value: (row: SalesRow) => row.sku },
        { header: "Кабинет", value: (row: SalesRow) => row.cabinet },
        { header: "Заказы, шт", value: (row: SalesRow) => row.orders },
        { header: "Выручка, ₽", value: (row: SalesRow) => row.revenue },
        { header: "Средняя цена, ₽", value: (row: SalesRow) => row.avgPrice },
        { header: "Остаток, шт", value: (row: SalesRow) => row.stock },
        { header: "Реклама, ₽", value: (row: SalesRow) => row.adSpend },
        { header: "ДРР, %", value: (row: SalesRow) => row.drr },
        { header: "Показы", value: (row: SalesRow) => row.funnelAvailable ? row.views : null },
        { header: "В корзину", value: (row: SalesRow) => row.funnelAvailable ? row.carts : null },
        { header: "CR корзины, %", value: (row: SalesRow) => row.funnelAvailable ? row.crCart : null },
        { header: "CR заказа, %", value: (row: SalesRow) => row.funnelAvailable ? row.crOrder : null },
      ],
      rows,
    );
  };

  return (
    <div>
      <OzonModuleHeader eyebrow="Ozon · Продажи" title="Продажи и воронка" subtitle="РНП по SKU, дневная динамика, реклама и доступные Ozon-метрики воронки без подмены отсутствующих данных." period={period} preset={preset} onApplyPreset={applyPreset} onApplyRange={applyRange} onRefresh={refresh} refreshing={loading} />
      <div className={`mx-auto max-w-[1600px] space-y-4 px-4 py-4 transition-opacity sm:px-5 ${updating ? "opacity-60" : ""}`}>
        {loading && !data ? <OzonLoading rows={9} /> : error && !data ? <OzonError message={error} onRetry={reload} /> : !data ? <EmptyState title="Нет данных о продажах" detail="Проверьте выбранный кабинет и Seller API." /> : <>
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-semibold text-slate-600">{data.scope.label} · {data.period.from} — {data.period.to}</div><Freshness generatedAt={data.generatedAt} /></div>
          {error ? <OzonStaleNotice message={error} onRetry={reload} /> : null}<OzonWarnings warnings={data.warnings} /><OzonAdCoverageNotice coverage={data.adCoverage} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {tab === "funnel" && <><MetricCard label="Показы" value={data.funnelAvailable ? formatNumber(data.summary.views) : "—"} /><MetricCard label="В корзину" value={data.funnelAvailable ? formatNumber(data.summary.carts) : "—"} /></>}
            <MetricCard label="Заказы" value={formatNumber(data.summary.orders)} detail={`${period.days} дней`} />
            <MetricCard label="Выручка" value={formatMoney(data.summary.revenue)} />
            <MetricCard label="Средняя цена" value={formatMoney(data.summary.avgPrice)} />
            {tab === "funnel" && <><MetricCard label="CR в корзину" value={data.funnelAvailable ? formatPercent(data.summary.crCart) : "—"} /><MetricCard label="CR в заказ" value={data.funnelAvailable ? formatPercent(data.summary.crOrder) : "—"} /></>}
          </div>
          {tab === "funnel" && !data.funnelAvailable && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900"><div className="font-semibold">Воронка доступна не для всех выбранных кабинетов</div><p className="mt-1">Ozon не вернул показы и добавления в корзину. Заказы и выручка ниже реальные; недоступные показатели обозначены «—», а не нулями.{data.funnelCabinets.length ? ` Воронка доступна: ${data.funnelCabinets.join(", ")}.` : ""}</p></div>}

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-3 lg:flex-row lg:items-center">
              <div className="flex rounded-lg bg-slate-100 p-1">
                <button type="button" onClick={() => setTab("rnp")} className={`min-h-11 rounded-md px-3 text-xs font-semibold sm:min-h-8 ${tab === "rnp" ? "bg-white text-sky-700 shadow-sm" : "text-slate-500"}`}><BarChart3 className="mr-1 inline h-3.5 w-3.5" />РНП</button>
                <button type="button" onClick={() => setTab("funnel")} className={`min-h-11 rounded-md px-3 text-xs font-semibold sm:min-h-8 ${tab === "funnel" ? "bg-white text-sky-700 shadow-sm" : "text-slate-500"}`}><Filter className="mr-1 inline h-3.5 w-3.5" />Воронка</button>
              </div>
              <div className="lg:ml-auto"><OzonCsvButton count={rows.length} onExport={exportCsv} /></div>
              <label className="relative flex-1 lg:max-w-sm"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Товар, артикул, SKU, кабинет" className="h-11 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-xs outline-none focus:border-sky-400 sm:h-8" /></label>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Сортировка" className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600 sm:h-8"><option value="revenue">По выручке</option><option value="orders">По заказам</option><option value="stock">По остатку</option><option value="adSpend">По рекламе</option><option value="drr">По ДРР</option>{tab === "funnel" && <><option value="views">По показам</option><option value="crOrder">По CR заказа</option></>}</select>
            </div>
            {rows.length === 0 ? <div className="p-4"><EmptyState title="Товары не найдены" detail="Измените строку поиска или период." /></div> : <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">Товар</th>{tab === "funnel" && <><th className="px-3 py-2 text-right">Показы</th><th className="px-3 py-2 text-right">В корзину</th><th className="px-3 py-2 text-right">CR корзины</th></>}<th className="px-3 py-2 text-right">Заказы</th>{tab === "funnel" && <th className="px-3 py-2 text-right">CR заказа</th>}<th className="px-3 py-2 text-right">Выручка</th>{tab === "rnp" && <><th className="px-3 py-2 text-right">Ср. цена</th><th className="px-3 py-2 text-right">Остаток</th><th className="px-3 py-2 text-right">Реклама</th><th className="px-3 py-2 text-right">ДРР</th><th className="px-4 py-2 text-right">Динамика</th></>}</tr></thead><tbody>{rows.map((row) => <tr key={row.key} className="border-t border-slate-100 hover:bg-sky-50/40"><td className="px-4 py-2"><ProductCell image={row.image} name={row.name} code={row.offerId || `SKU ${row.sku}`} cabinet={data.scope.count > 1 ? row.cabinet : undefined} /></td>{tab === "funnel" && <><td className="px-3 py-2 text-right tabular-nums">{row.funnelAvailable ? formatNumber(row.views) : "—"}</td><td className="px-3 py-2 text-right tabular-nums">{row.funnelAvailable ? formatNumber(row.carts) : "—"}</td><td className="px-3 py-2 text-right tabular-nums">{row.funnelAvailable ? formatPercent(row.crCart) : "—"}</td></>}<td className="px-3 py-2 text-right font-semibold tabular-nums">{formatNumber(row.orders)}</td>{tab === "funnel" && <td className="px-3 py-2 text-right font-semibold tabular-nums">{row.funnelAvailable ? formatPercent(row.crOrder) : "—"}</td>}<td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(row.revenue)}</td>{tab === "rnp" && <><td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.avgPrice)}</td><td className={`px-3 py-2 text-right tabular-nums ${row.stock <= 0 && row.orders > 0 ? "font-bold text-red-600" : ""}`}>{formatNumber(row.stock)}</td><td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.adSpend)}</td><td className={`px-3 py-2 text-right font-semibold tabular-nums ${row.drr >= 30 ? "text-red-600" : row.drr >= 20 ? "text-amber-600" : "text-emerald-700"}`}>{formatPercent(row.drr)}</td><td className="px-4 py-2"><MiniBars values={row.daily.map((day) => day.revenue)} /></td></>}</tr>)}</tbody></table></div>}
          </section>
          <div className="flex items-center gap-2 text-[10px] text-slate-400"><ShoppingCart className="h-3 w-3" />{rows.length} SKU в текущем срезе</div>
        </>}
      </div>
    </div>
  );
}
