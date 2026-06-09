"use client";

import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { AnalyticsShell } from "../AnalyticsShell";
import { AnalyticsTable, type Column } from "../AnalyticsTable";
import { DateRangeSelector } from "../DateRangeSelector";
import { formatRub, formatNumber, formatPct } from "../MetricCard";
import { ChartSkeleton, TableSkeleton } from "../LoadingSkeleton";
import { useProductCosts } from "@/hooks/useProductCosts";
import { useWbData } from "@/hooks/useWbData";
import { addDays, toISODate } from "@/lib/analytics/format";
import {
  computeStockAlerts,
  computeStocks,
  computeWarehouseDistribution,
  type StockRow,
} from "@/lib/wb/analytics/products";
import type { DateRange } from "@/lib/wb/analytics/sales";

const STATUS_LABELS: Record<StockRow["status"], string> = {
  critical: "Критично",
  reorder: "Дозаказать",
  normal: "Норма",
  excess: "Излишек",
};

const STATUS_COLORS: Record<StockRow["status"], string> = {
  critical: "text-red-400",
  reorder: "text-amber-400",
  normal: "text-emerald-400",
  excess: "text-slate-400",
};

const PIE_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4"];

function daysColor(days: number): string {
  if (days < 14) return "text-red-400 font-bold";
  if (days <= 30) return "text-amber-400";
  return "text-emerald-400";
}

export function ProductsAnalyticsPage() {
  const [range, setRange] = useState<DateRange>(() => {
    const to = new Date();
    const from = addDays(to, -29);
    return { from: toISODate(from), to: toISODate(to) };
  });

  const { sales, stocks, loading, error, timestamp, refresh } = useWbData(range.from, range.to);
  const { costs } = useProductCosts();

  const stockRows = useMemo(
    () => computeStocks(stocks, sales, range, costs),
    [stocks, sales, range, costs],
  );
  const alerts = useMemo(() => computeStockAlerts(stockRows), [stockRows]);
  const warehouses = useMemo(() => computeWarehouseDistribution(stocks), [stocks]);

  const stockColumns: Column<StockRow>[] = [
    { key: "article", label: "Артикул", render: (r) => r.article, csv: (r) => r.article },
    { key: "name", label: "Название", render: (r) => <span className="max-w-[120px] truncate block">{r.name}</span>, csv: (r) => r.name },
    { key: "warehouse", label: "Склад", render: (r) => r.warehouse, csv: (r) => r.warehouse },
    { key: "stock", label: "Остаток", sortable: true, align: "right", render: (r) => formatNumber(r.stock), csv: (r) => String(r.stock) },
    { key: "spd", label: "Продаж/день", sortable: true, align: "right", render: (r) => r.salesPerDay.toFixed(1), csv: (r) => String(r.salesPerDay) },
    { key: "days", label: "Дней до нуля", sortable: true, align: "right", render: (r) => <span className={daysColor(r.daysToZero)}>{r.daysToZero >= 999 ? "∞" : Math.round(r.daysToZero)}</span>, csv: (r) => String(r.daysToZero) },
    { key: "frozen", label: "Заморожено ₽", sortable: true, align: "right", render: (r) => formatRub(r.frozenRub), csv: (r) => String(r.frozenRub) },
    { key: "status", label: "Статус", render: (r) => <span className={STATUS_COLORS[r.status]}>{STATUS_LABELS[r.status]}</span>, csv: (r) => r.status },
    { key: "reorder", label: "Рекомендация", sortable: true, align: "right", render: (r) => r.reorderQty > 0 ? `+${formatNumber(r.reorderQty)} шт` : "—", csv: (r) => String(r.reorderQty) },
  ];

  return (
    <AnalyticsShell
      title="Товары и остатки"
      subtitle="Контроль запасов, дозаказ и замороженные деньги"
      timestamp={timestamp}
      loading={loading}
      error={error}
      onRefresh={refresh}
      toolbar={<DateRangeSelector range={range} onChange={setRange} />}
    >
      {!loading && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-red-800/50 bg-red-950/20 p-4">
            <p className="text-xs text-red-400">🔴 Нет в наличии</p>
            <p className="mt-1 text-2xl font-bold text-white">{alerts.outOfStock}</p>
            <p className="text-xs text-slate-500">артикулов</p>
          </div>
          <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-4">
            <p className="text-xs text-amber-400">🟡 Заканчивается (&lt;14 дн)</p>
            <p className="mt-1 text-2xl font-bold text-white">{alerts.low}</p>
            <p className="text-xs text-slate-500">артикулов</p>
          </div>
          <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-4">
            <p className="text-xs text-emerald-400">🟢 В норме</p>
            <p className="mt-1 text-2xl font-bold text-white">{alerts.normal}</p>
            <p className="text-xs text-slate-500">артикулов</p>
          </div>
          <div className="rounded-xl border border-slate-600 bg-slate-800/60 p-4">
            <p className="text-xs text-slate-400">📦 Излишки (&gt;90 дн)</p>
            <p className="mt-1 text-2xl font-bold text-white">{alerts.excess}</p>
            <p className="text-xs text-slate-500">деньги заморожены</p>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Остатки по товарам</h2>
        {loading ? <TableSkeleton /> : <AnalyticsTable columns={stockColumns} data={stockRows} filename="stocks.csv" emptyMessage="Нет данных об остатках" />}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Распределение по складам</h2>
        {loading ? <ChartSkeleton height={220} /> : warehouses.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-700/80 bg-slate-800/40 p-4">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={warehouses} dataKey="stock" nameKey="warehouse" cx="50%" cy="50%" outerRadius={80} label={(props) => `${String(props.name ?? "")} ${Number(props.percent ?? 0).toFixed(0)}%`}>
                    {warehouses.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #475569" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <AnalyticsTable
              columns={[
                { key: "warehouse", label: "Склад", render: (r) => r.warehouse, csv: (r) => r.warehouse },
                { key: "stock", label: "Остаток", sortable: true, align: "right", render: (r) => formatNumber(r.stock), csv: (r) => String(r.stock) },
                { key: "pct", label: "% от общего", sortable: true, align: "right", render: (r) => formatPct(r.pct), csv: (r) => String(r.pct) },
              ]}
              data={warehouses}
              filename="warehouses.csv"
            />
          </div>
        ) : (
          <p className="text-sm text-slate-500">Нет данных по складам</p>
        )}
      </section>
    </AnalyticsShell>
  );
}
