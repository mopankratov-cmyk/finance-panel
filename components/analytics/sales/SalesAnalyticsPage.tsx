"use client";

import { useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AnalyticsShell } from "../AnalyticsShell";
import { AnalyticsTable, type Column } from "../AnalyticsTable";
import { DateRangeSelector } from "../DateRangeSelector";
import { MetricCard, metricChange, formatRub, formatNumber, formatPct } from "../MetricCard";
import { ChartSkeleton, MetricSkeleton, TableSkeleton } from "../LoadingSkeleton";
import { useProductCosts } from "@/hooks/useProductCosts";
import { useWbData } from "@/hooks/useWbData";
import { addDays, toISODate } from "@/lib/analytics/format";
import {
  abcInsight,
  computeArticles,
  computeDailyDynamics,
  computeExecutiveSummary,
  computeNiches,
  computeReturns,
  computeWeeklyCohort,
  getPreviousRange,
  type ArticleRow,
  type DateRange,
  type NicheRow,
  type ReturnRow,
} from "@/lib/wb/analytics/sales";

function buyoutColor(pct: number): string {
  if (pct >= 80) return "text-emerald-400";
  if (pct >= 60) return "text-amber-400";
  return "text-red-400";
}

function marginRowClass(margin: number): string {
  if (margin > 30) return "bg-emerald-950/20";
  if (margin >= 10) return "bg-amber-950/15";
  return "bg-red-950/15";
}

interface SalesAnalyticsPageProps {
  initialQuickAdd?: never;
}

export function SalesAnalyticsPage(_props: SalesAnalyticsPageProps) {
  const [range, setRange] = useState<DateRange>(() => {
    const to = new Date();
    const from = addDays(to, -6);
    return { from: toISODate(from), to: toISODate(to) };
  });

  const { sales, orders, loading, error, timestamp, refresh } = useWbData(range.from, range.to);
  const { costs, setCost } = useProductCosts();
  const prevRange = useMemo(() => getPreviousRange(range), [range]);

  const summary = useMemo(
    () => computeExecutiveSummary(sales, orders, range, prevRange),
    [sales, orders, range, prevRange],
  );
  const daily = useMemo(() => computeDailyDynamics(sales, orders, range), [sales, orders, range]);
  const niches = useMemo(() => computeNiches(sales, range), [sales, range]);
  const articles = useMemo(() => computeArticles(sales, range, costs), [sales, range, costs]);
  const returns = useMemo(() => computeReturns(sales, range), [sales, range]);
  const weekly = useMemo(() => computeWeeklyCohort(sales, orders, range), [sales, orders, range]);

  const totalRev = niches.reduce((s, n) => s + n.revenue, 0) || 1;
  const topReturns = returns.filter((r) => r.returnPct > 20)[0];

  const nicheColumns: Column<NicheRow>[] = [
    { key: "subject", label: "Ниша", sortable: true, render: (r) => r.subject, csv: (r) => r.subject },
    {
      key: "revenue",
      label: "Выручка ₽",
      sortable: true,
      align: "right",
      render: (r) => (
        <div>
          <div>{formatRub(r.revenue)}</div>
          <div className="mt-1 h-1.5 w-full rounded bg-slate-700">
            <div className="h-full rounded bg-emerald-500" style={{ width: `${(r.revenue / totalRev) * 100}%` }} />
          </div>
        </div>
      ),
      csv: (r) => String(r.revenue),
    },
    { key: "orders", label: "Заказов", sortable: true, align: "right", render: (r) => formatNumber(r.orders), csv: (r) => String(r.orders) },
    { key: "sales", label: "Продаж", sortable: true, align: "right", render: (r) => formatNumber(r.sales), csv: (r) => String(r.sales) },
    { key: "returns", label: "Возвратов", sortable: true, align: "right", render: (r) => formatNumber(r.returns), csv: (r) => String(r.returns) },
    { key: "buyout", label: "% Выкупа", sortable: true, align: "right", render: (r) => <span className={buyoutColor(r.buyoutPct)}>{formatPct(r.buyoutPct)}</span>, csv: (r) => String(r.buyoutPct) },
    { key: "commission", label: "Комиссия WB", sortable: true, align: "right", render: (r) => formatRub(r.commission), csv: (r) => String(r.commission) },
    { key: "logistics", label: "Логистика", sortable: true, align: "right", render: (r) => formatRub(r.logistics), csv: (r) => String(r.logistics) },
    { key: "forPay", label: "К выплате", sortable: true, align: "right", render: (r) => formatRub(r.forPay), csv: (r) => String(r.forPay) },
    { key: "margin", label: "Маржа %", sortable: true, align: "right", render: (r) => formatPct(r.marginPct), csv: (r) => String(r.marginPct) },
  ];

  const articleColumns: Column<ArticleRow>[] = [
    {
      key: "article",
      label: "Артикул",
      render: (r) => (
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 shrink-0 rounded bg-slate-700" />
          <div>
            <div className="font-medium">{r.article}</div>
            <div className="text-xs text-slate-500 truncate max-w-[120px]">{r.name}</div>
            {articles.indexOf(r) < 3 && <span className="text-[10px]">🔥 Топ</span>}
            {r.marginPct < 0 && <span className="text-[10px] text-red-400"> ⚠️ Убыток</span>}
          </div>
        </div>
      ),
      csv: (r) => r.article,
    },
    { key: "brand", label: "Бренд", render: (r) => r.brand, csv: (r) => r.brand },
    { key: "revenue", label: "Выручка", sortable: true, align: "right", render: (r) => formatRub(r.revenue), csv: (r) => String(r.revenue) },
    { key: "orders", label: "Заказы", sortable: true, align: "right", render: (r) => formatNumber(r.orders), csv: (r) => String(r.orders) },
    { key: "sales", label: "Продажи", sortable: true, align: "right", render: (r) => formatNumber(r.sales), csv: (r) => String(r.sales) },
    { key: "returns", label: "Возвраты", sortable: true, align: "right", render: (r) => formatNumber(r.returns), csv: (r) => String(r.returns) },
    { key: "buyout", label: "% Выкупа", sortable: true, align: "right", render: (r) => <span className={buyoutColor(r.buyoutPct)}>{formatPct(r.buyoutPct)}</span>, csv: (r) => String(r.buyoutPct) },
    { key: "forPay", label: "К выплате", sortable: true, align: "right", render: (r) => formatRub(r.forPay), csv: (r) => String(r.forPay) },
    {
      key: "cost",
      label: "Себестоимость",
      align: "right",
      render: (r) => (
        <input
          type="number"
          className="w-20 rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-right text-xs"
          value={costs[r.nmId] ?? ""}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setCost(r.nmId, Number(e.target.value) || 0)}
        />
      ),
      csv: (r) => String(r.cost),
    },
    { key: "profit", label: "Прибыль", sortable: true, align: "right", render: (r) => <span className={r.profit >= 0 ? "text-emerald-400" : "text-red-400"}>{formatRub(r.profit)}</span>, csv: (r) => String(r.profit) },
    { key: "margin", label: "Маржа %", sortable: true, align: "right", render: (r) => formatPct(r.marginPct), csv: (r) => String(r.marginPct) },
    { key: "roi", label: "ROI %", sortable: true, align: "right", render: (r) => formatPct(r.roiPct), csv: (r) => String(r.roiPct) },
    { key: "abc", label: "ABC", render: (r) => <span className={r.abc === "A" ? "text-emerald-400" : r.abc === "B" ? "text-amber-400" : "text-red-400"}>{r.abc}</span>, csv: (r) => r.abc },
  ];

  const returnColumns: Column<ReturnRow>[] = [
    { key: "article", label: "Артикул", render: (r) => r.article, csv: (r) => r.article },
    { key: "returns", label: "Возвратов", sortable: true, align: "right", render: (r) => formatNumber(r.returns), csv: (r) => String(r.returns) },
    { key: "pct", label: "% возврата", sortable: true, align: "right", render: (r) => <span className={r.returnPct > 20 ? "text-red-400 font-bold" : ""}>{formatPct(r.returnPct)}</span>, csv: (r) => String(r.returnPct) },
    { key: "loss", label: "Потери ₽", sortable: true, align: "right", render: (r) => formatRub(r.loss), csv: (r) => String(r.loss) },
  ];

  const abcData = [
    { name: "A", value: articles.filter((a) => a.abc === "A").length, color: "#10b981" },
    { name: "B", value: articles.filter((a) => a.abc === "B").length, color: "#f59e0b" },
    { name: "C", value: articles.filter((a) => a.abc === "C").length, color: "#ef4444" },
  ];

  return (
    <AnalyticsShell
      title="Аналитика продаж"
      subtitle="Выручка, выкуп, маржинальность и ABC по данным WB"
      timestamp={timestamp}
      loading={loading}
      error={error}
      onRefresh={refresh}
      toolbar={<DateRangeSelector range={range} onChange={setRange} />}
    >
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <MetricSkeleton key={i} />)}
        </div>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Выручка" value={formatRub(summary.revenue)} change={metricChange(summary.revenue, summary.prev.revenue)} tooltip="Сумма ppvz_for_pay по продажам за период" />
          <MetricCard label="Заказов" value={formatNumber(summary.orders)} change={metricChange(summary.orders, summary.prev.orders)} tooltip="Количество заказов из API orders" />
          <MetricCard label="Продаж (выкуплено)" value={formatNumber(summary.sales)} change={metricChange(summary.sales, summary.prev.sales)} tooltip="Количество выкупленных единиц" />
          <MetricCard label="% Выкупа" value={formatPct(summary.buyoutPct)} valueClass={buyoutColor(summary.buyoutPct)} tooltip="Продажи / Заказы × 100" />
          <MetricCard label="Средний чек" value={formatRub(summary.avgCheck)} change={metricChange(summary.avgCheck, summary.prev.avgCheck)} tooltip="Выручка / Продажи" />
          <MetricCard label="Возвраты" value={`${formatNumber(summary.returnsQty)} шт · ${formatRub(summary.returnsSum)}`} change={metricChange(summary.returnsSum, summary.prev.returnsSum)} valueClass={summary.returnsSum > summary.prev.returnsSum ? "text-red-400" : "text-white"} tooltip="Количество и сумма возвратов" />
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Динамика выручки</h2>
        {loading ? <ChartSkeleton /> : (
          <div className="rounded-xl border border-slate-700/80 bg-slate-800/40 p-4">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => v.slice(8)} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <Tooltip
                  contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 8 }}
                  labelStyle={{ color: "#94a3b8" }}
                  formatter={(value, name) => {
                    const v = Number(value ?? 0);
                    const n = String(name);
                    return [
                      n === "revenue" ? formatRub(v) : formatNumber(v),
                      n === "revenue" ? "Выручка" : n === "orders" ? "Заказы" : "Выкуп %",
                    ];
                  }}
                />
                <Area yAxisId="left" type="monotone" dataKey="revenue" fill="#10b98133" stroke="#10b981" name="revenue" />
                <Line yAxisId="right" type="monotone" dataKey="orders" stroke="#3b82f6" strokeWidth={2} dot={false} name="orders" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Ниши</h2>
        {loading ? <TableSkeleton /> : <AnalyticsTable columns={nicheColumns} data={niches} filename="niches.csv" />}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Топ артикулов</h2>
        {loading ? <ChartSkeleton height={200} /> : (
          <div className="mb-4 rounded-xl border border-slate-700/80 bg-slate-800/40 p-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={articles.slice(0, 15)} layout="vertical" margin={{ left: 80 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <YAxis type="category" dataKey="article" tick={{ fontSize: 9, fill: "#94a3b8" }} width={75} />
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #475569" }} formatter={(v) => formatRub(Number(v ?? 0))} />
                <Bar dataKey="revenue" fill="#10b981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {loading ? <TableSkeleton /> : (
          <AnalyticsTable
            columns={articleColumns}
            data={articles}
            filename="articles.csv"
            rowClassName={(r) => marginRowClass(r.marginPct)}
          />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">ABC-анализ</h2>
        {!loading && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-700/80 bg-slate-800/40 p-4">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={abcData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>
                    {abcData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #475569" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center rounded-xl border border-slate-700/80 bg-slate-800/40 p-4">
              <p className="text-sm text-slate-300">{abcInsight(articles)}</p>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Возвраты</h2>
        {topReturns && (
          <p className="mb-3 text-sm text-red-400">
            Артикул {topReturns.article} — возврат {formatPct(topReturns.returnPct)}, потери {formatRub(topReturns.loss)}/период
          </p>
        )}
        {loading ? <ChartSkeleton height={180} /> : (
          <div className="mb-4 rounded-xl border border-slate-700/80 bg-slate-800/40 p-4">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={returns.slice(0, 10)}>
                <XAxis dataKey="article" tick={{ fontSize: 9, fill: "#94a3b8" }} />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #475569" }} />
                <Bar dataKey="returns" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {loading ? <TableSkeleton /> : <AnalyticsTable columns={returnColumns} data={returns} filename="returns.csv" />}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Недельная когорта</h2>
        {loading ? <TableSkeleton /> : (
          <AnalyticsTable
            columns={[
              { key: "week", label: "Неделя", render: (r) => `${r.week} (${r.label})`, csv: (r) => r.week },
              { key: "revenue", label: "Выручка", sortable: true, align: "right", render: (r) => formatRub(r.revenue), csv: (r) => String(r.revenue) },
              { key: "orders", label: "Заказы", sortable: true, align: "right", render: (r) => formatNumber(r.orders), csv: (r) => String(r.orders) },
              { key: "wow", label: "% к прошлой неделе", sortable: true, align: "right", render: (r) => <span className={r.wowPct >= 0 ? "text-emerald-400" : "text-red-400"}>{formatPct(r.wowPct)}</span>, csv: (r) => String(r.wowPct) },
              { key: "top", label: "Лучший артикул", render: (r) => r.topArticle, csv: (r) => r.topArticle },
            ]}
            data={weekly}
            filename="weekly.csv"
          />
        )}
      </section>
    </AnalyticsShell>
  );
}
