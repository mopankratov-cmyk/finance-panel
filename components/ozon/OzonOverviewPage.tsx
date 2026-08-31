"use client";

import { AlertCircle, AlertTriangle, ArrowRight, BadgeRussianRuble, RotateCcw, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { withOzonCabinetScope } from "@/lib/ozon/navigation";
import { useOzonCabinet } from "./OzonCabinetContext";
import { OzonModuleHeader } from "./OzonModuleHeader";
import { EmptyState, Freshness, MetricCard, OzonError, OzonLoading, OzonStaleNotice, OzonAdCoverageNotice, type OzonAdCoverageItem, OzonWarnings, ProductCell, formatMoney, formatNumber, formatPercent } from "./OzonUi";
import { days } from "@/lib/ozon/plural";
import { useOzonCockpit } from "./useOzonCockpit";
import { useOzonPeriod } from "./useOzonPeriod";

interface OverviewData {
  generatedAt: string;
  scope: { label: string; count: number };
  period: { days: number; from: string; to: string };
  summary: {
    orders: number; revenue: number; avgPrice: number; stock: number | null; reserved: number | null; stocksIncomplete: boolean;
    adSpend: number; adRevenue: number; drr: number; refunds: number; deductions: number; payout: number;
    delta: { orders: number | null; revenue: number | null; adSpend: number | null };
  };
  finance: { commission: number; logistics: number; services: number; refunds: number; other: number; deductions: number };
  trend: { day: string; orders: number; revenue: number; adSpend: number }[];
  attention: { severity: "critical" | "warning"; title: string; detail: string; href: string }[];
  topSku: { key: string; cabinet: string; sku: string; offerId: string; name: string; image: string | null; orders: number; revenue: number; stock: number | null; daysCover: number | null; adSpend: number; drr: number; deltaRevenue: number | null }[];
  adCoverage?: OzonAdCoverageItem[]; warnings: string[];
}

export function OzonOverviewPage() {
  const { period, preset, applyPreset, applyRange } = useOzonPeriod();
  const { cabinetId, noCabinets } = useOzonCabinet();
  const { data, loading, error, updating, refresh, reload } = useOzonCockpit<OverviewData>("overview", period);
  return (
    <div>
      <OzonModuleHeader eyebrow="Ozon Cockpit" title="Обзор" subtitle="Главная картина по продажам, рекламе, остаткам и удержаниям — с честными статусами полноты данных." period={period} preset={preset} onApplyPreset={applyPreset} onApplyRange={applyRange} onRefresh={refresh} refreshing={loading} />
      <div className={`mx-auto max-w-[1600px] space-y-4 px-4 py-4 transition-opacity sm:px-5 ${updating ? "opacity-60" : ""}`}>
        {loading && !data ? <OzonLoading /> : noCabinets ? <EmptyState title="Кабинет Ozon не подключён" detail="Добавьте кабинет с ключами Seller API и Performance API — после этого экраны наполнятся данными." href="/cabinets" /> : error && !data ? <OzonError message={error} onRetry={reload} /> : !data ? <EmptyState title="Нет данных Ozon" detail="Подключите Seller API и выберите кабинет." href="/cabinets" /> : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-600">{data.scope.label} · {data.period.from} — {data.period.to}</div>
              <Freshness generatedAt={data.generatedAt} />
            </div>
            {error ? <OzonStaleNotice message={error} onRetry={reload} /> : null}<OzonWarnings warnings={data.warnings} /><OzonAdCoverageNotice coverage={data.adCoverage} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
              <MetricCard label="Выручка" value={formatMoney(data.summary.revenue)} delta={data.summary.delta.revenue} detail={`${formatNumber(data.summary.orders)} заказов`} />
              <MetricCard label="Заказы" value={formatNumber(data.summary.orders)} delta={data.summary.delta.orders} detail={`Средняя цена ${formatMoney(data.summary.avgPrice)}`} />
              <MetricCard label="Реклама" value={formatMoney(data.summary.adSpend)} delta={data.summary.delta.adSpend} detail={`ДРР ${formatPercent(data.summary.drr)}`} tone={data.summary.drr >= 30 ? "red" : data.summary.drr >= 20 ? "amber" : "sky"} />
              <MetricCard label="Остаток" value={formatNumber(data.summary.stock)} detail={data.summary.stock == null ? "Ozon не отдал остатки" : data.summary.stocksIncomplete ? `${formatNumber(data.summary.reserved)} в резерве · часть кабинетов молчит` : `${formatNumber(data.summary.reserved)} в резерве`} tone={data.summary.stock == null || data.summary.stocksIncomplete ? "amber" : "slate"} />
              <MetricCard label="Возвраты" value={formatMoney(data.summary.refunds)} detail={data.summary.revenue > 0 ? `${formatPercent(data.summary.refunds / data.summary.revenue * 100)} выручки` : "Факт Ozon"} tone={data.summary.refunds > 0 ? "amber" : "emerald"} />
              <MetricCard label="Удержания" value={formatMoney(data.summary.deductions)} detail="Факт Ozon" tone="amber" />
              <MetricCard label="К выплате" value={formatMoney(data.summary.payout)} detail="Расчёт по транзакциям" tone="emerald" />
              <MetricCard label="Продажи с рекламы" value={formatMoney(data.summary.adRevenue)} detail="Атрибуция Performance" />
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,0.8fr)]">
              <section className="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="ozon-trend-title">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div><h2 id="ozon-trend-title" className="text-sm font-bold text-slate-900">Динамика продаж и рекламы</h2><p className="mt-0.5 text-[11px] text-slate-500">Выручка и расход по дням; точные значения доступны в подсказке.</p></div>
                  <BadgeRussianRuble className="h-4 w-4 text-sky-600" />
                </div>
                <div className="min-h-[280px] min-w-0 w-full" role="img" aria-label={`График выручки и рекламы за ${days(period.days)}`}>
                  <ResponsiveContainer width="100%" height={280} minWidth={0}>
                    <LineChart data={data.trend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="day" tickFormatter={(value) => String(value).slice(5)} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(value) => Number(value).toLocaleString("ru-RU", { notation: "compact" })} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} width={48} />
                      <Tooltip formatter={(value, name) => [formatMoney(Number(value)), name === "revenue" ? "Выручка" : "Реклама"]} labelFormatter={(label) => `Дата ${label}`} />
                      <Legend formatter={(value) => value === "revenue" ? "Выручка" : "Реклама"} wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="revenue" stroke="#0369a1" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                      <Line type="monotone" dataKey="adSpend" stroke="#d97706" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white" aria-labelledby="ozon-attention-title">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <div><h2 id="ozon-attention-title" className="text-sm font-bold text-slate-900">Требует внимания</h2><p className="mt-0.5 text-[10px] text-slate-400">Приоритетные сигналы по выбранному срезу</p></div>
                  <span className={`rounded-md px-2 py-1 text-[10px] font-bold ${data.attention.length ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{data.attention.length}</span>
                </div>
                <div className="max-h-[318px] overflow-y-auto p-2">
                  {data.attention.length ? data.attention.map((item, index) => (
                    <Link key={`${item.title}-${index}`} href={withOzonCabinetScope(item.href, cabinetId)} className="flex min-h-14 items-start gap-2 rounded-lg px-2.5 py-2 hover:bg-slate-50">
                      {item.severity === "critical" ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                      <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-slate-800">{item.title}</span><span className="mt-0.5 block text-[10px] text-slate-500">{item.detail}</span></span>
                      <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-300" />
                    </Link>
                  )) : <div className="grid min-h-52 place-items-center text-center"><div><ShoppingBag className="mx-auto h-6 w-6 text-emerald-400" /><div className="mt-2 text-xs font-semibold text-slate-700">Критичных сигналов нет</div><div className="mt-1 text-[10px] text-slate-400">Остатки и реклама в допустимых пределах</div></div></div>}
                </div>
              </section>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.55fr)]">
              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><div><h2 className="text-sm font-bold text-slate-900">Топ SKU по выручке</h2><p className="mt-0.5 text-[10px] text-slate-400">Продажи, остаток, запас и ДРР в одном месте</p></div><Link href={withOzonCabinetScope("/ozon/sales", cabinetId)} className="inline-flex min-h-11 items-center gap-1 px-2 text-[11px] font-semibold text-sky-700 sm:min-h-8">Все продажи <ArrowRight className="h-3 w-3" /></Link></div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[840px] text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2 text-left">Товар</th><th className="px-3 py-2 text-right">Заказы</th><th className="px-3 py-2 text-right">Выручка</th><th className="px-3 py-2 text-right">Остаток</th><th className="px-3 py-2 text-right">Запас</th><th className="px-3 py-2 text-right">Реклама</th><th className="px-4 py-2 text-right">ДРР</th></tr></thead>
                    <tbody>{data.topSku.slice(0, 12).map((row) => <tr key={row.key} className="border-t border-slate-100 hover:bg-sky-50/40"><td className="px-4 py-2"><ProductCell image={row.image} name={row.name} code={row.offerId || `SKU ${row.sku}`} cabinet={data.scope.count > 1 ? row.cabinet : undefined} /></td><td className="px-3 py-2 text-right font-semibold tabular-nums">{formatNumber(row.orders)}</td><td className="px-3 py-2 text-right font-semibold tabular-nums">{formatMoney(row.revenue)}</td><td className={`px-3 py-2 text-right tabular-nums ${row.stock != null && row.stock <= 0 && row.orders > 0 ? "font-bold text-red-600" : ""}`}>{formatNumber(row.stock)}</td><td className="px-3 py-2 text-right tabular-nums">{row.daysCover == null ? "—" : `${row.daysCover} дн.`}</td><td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.adSpend)}</td><td className={`px-4 py-2 text-right font-semibold tabular-nums ${row.drr >= 30 ? "text-red-600" : row.drr >= 20 ? "text-amber-600" : "text-emerald-700"}`}>{formatPercent(row.drr)}</td></tr>)}</tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between"><div><h2 className="text-sm font-bold text-slate-900">Структура удержаний</h2><p className="mt-0.5 text-[10px] text-slate-400">Фактические транзакции Ozon</p></div><RotateCcw className="h-4 w-4 text-slate-400" /></div>
                <div className="mt-4 space-y-3">{[
                  ["Комиссия", data.finance.commission, "bg-sky-600"],
                  ["Логистика", data.finance.logistics, "bg-indigo-500"],
                  ["Услуги", data.finance.services, "bg-amber-500"],
                  ["Возвраты", data.finance.refunds, "bg-red-500"],
                  ["Прочее", data.finance.other, "bg-slate-400"],
                ].map(([label, value, color]) => {
                  const amount = Number(value);
                  const width = data.finance.deductions > 0 ? Math.max(2, amount / data.finance.deductions * 100) : 0;
                  return <div key={String(label)}><div className="mb-1 flex items-center justify-between text-[11px]"><span className="text-slate-600">{label}</span><span className="font-semibold tabular-nums text-slate-800">{formatMoney(amount)}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} /></div></div>;
                })}</div>
                <div className="mt-4 border-t border-slate-100 pt-3"><div className="flex items-center justify-between text-xs"><span className="font-semibold text-slate-600">Всего удержаний</span><span className="font-bold tabular-nums text-slate-900">{formatMoney(data.finance.deductions)}</span></div></div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
