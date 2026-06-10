"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { AnalyticsShell } from "../AnalyticsShell";
import { AnalyticsTable, type Column } from "../AnalyticsTable";
import { DateRangeSelector } from "../DateRangeSelector";
import { MetricCard, formatRub, formatNumber, formatPct } from "../MetricCard";
import { ChartSkeleton, MetricSkeleton, TableSkeleton } from "../LoadingSkeleton";
import { useWbData } from "@/hooks/useWbData";
import { addDays, toISODate } from "@/lib/analytics/format";
import {
  computeAdsSummary,
  computeCampaigns,
  computeDailyAdSpend,
  verdictLabel,
  type CampaignRow,
} from "@/lib/wb/analytics/ads";
import { computeExecutiveSummary, getPreviousRange, type DateRange } from "@/lib/wb/analytics/sales";

function drrColor(drr: number): string {
  if (drr < 10) return "text-emerald-400";
  if (drr <= 20) return "text-amber-400";
  return "text-red-400";
}

function roasColor(roas: number): string {
  if (roas > 5) return "text-emerald-400";
  if (roas >= 3) return "text-amber-400";
  return "text-red-400";
}

function cpoColor(cpo: number): string {
  if (cpo < 500) return "text-emerald-400";
  if (cpo <= 1500) return "text-amber-400";
  return "text-red-400";
}

export function AdsAnalyticsPage() {
  const [range, setRange] = useState<DateRange>(() => {
    const to = new Date();
    const from = addDays(to, -29);
    return { from: toISODate(from), to: toISODate(to) };
  });

  const { sales, orders, adStats, loading, syncing, error, empty, timestamp, refresh } = useWbData(range.from, range.to);
  const prevRange = useMemo(() => getPreviousRange(range), [range]);
  const revenue = useMemo(
    () => computeExecutiveSummary(sales, orders, range, prevRange).revenue,
    [sales, orders, range, prevRange],
  );

  const summary = useMemo(() => computeAdsSummary(adStats, revenue), [adStats, revenue]);
  const daily = useMemo(() => computeDailyAdSpend(adStats, range), [adStats, range]);
  const campaigns = useMemo(() => computeCampaigns(adStats, revenue), [adStats, revenue]);

  const scatterData = campaigns.map((c) => ({
    name: c.name,
    spend: c.spend,
    roas: c.roas,
    orders: c.orders,
  }));

  const campaignColumns: Column<CampaignRow>[] = [
    { key: "name", label: "Кампания", render: (r) => r.name, csv: (r) => r.name },
    { key: "type", label: "Тип", render: (r) => r.type, csv: (r) => r.type },
    { key: "status", label: "Статус", render: (r) => <span className="rounded bg-emerald-900/50 px-1.5 py-0.5 text-xs text-emerald-400">{r.status}</span>, csv: (r) => r.status },
    { key: "spend", label: "Расходы", sortable: true, align: "right", render: (r) => formatRub(r.spend), csv: (r) => String(r.spend) },
    { key: "views", label: "Показы", sortable: true, align: "right", render: (r) => formatNumber(r.views), csv: (r) => String(r.views) },
    { key: "clicks", label: "Клики", sortable: true, align: "right", render: (r) => formatNumber(r.clicks), csv: (r) => String(r.clicks) },
    { key: "ctr", label: "CTR%", sortable: true, align: "right", render: (r) => <span className={r.ctr > 1 ? "text-emerald-400" : ""}>{formatPct(r.ctr)}</span>, csv: (r) => String(r.ctr) },
    { key: "orders", label: "Заказов", sortable: true, align: "right", render: (r) => formatNumber(r.orders), csv: (r) => String(r.orders) },
    { key: "revenue", label: "Выручка", sortable: true, align: "right", render: (r) => formatRub(r.revenue), csv: (r) => String(r.revenue) },
    { key: "cpo", label: "CPO", sortable: true, align: "right", render: (r) => <span className={cpoColor(r.cpo)}>{formatRub(r.cpo)}</span>, csv: (r) => String(r.cpo) },
    { key: "drr", label: "ДРР%", sortable: true, align: "right", render: (r) => <span className={drrColor(r.drr)}>{formatPct(r.drr)}</span>, csv: (r) => String(r.drr) },
    { key: "roas", label: "ROAS", sortable: true, align: "right", render: (r) => <span className={roasColor(r.roas)}>{r.roas.toFixed(2)}</span>, csv: (r) => String(r.roas) },
    { key: "verdict", label: "Вердикт", render: (r) => verdictLabel(r.verdict), csv: (r) => r.verdict },
  ];

  return (
    <AnalyticsShell
      title="Аналитика рекламы"
      subtitle="CPO, ДРР, ROAS и эффективность кампаний WB"
      timestamp={timestamp || undefined}
      loading={loading}
      syncing={syncing}
      empty={empty}
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
          <MetricCard label="Расходы на рекламу" value={formatRub(summary.spend)} tooltip="Сумма расходов по всем кампаниям" />
          <MetricCard label="Заказов с рекламы" value={formatNumber(summary.orders)} tooltip="Заказы атрибутированные рекламе" />
          <MetricCard label="CPO" value={formatRub(summary.cpo)} tooltip="Расходы / Заказы" />
          <MetricCard label="ДРР%" value={formatPct(summary.drr)} valueClass={drrColor(summary.drr)} tooltip="Расходы / Выручка × 100" />
          <MetricCard label="ROAS" value={summary.roas.toFixed(2)} valueClass={roasColor(summary.roas)} tooltip="Выручка с рекламы / Расходы" />
          <MetricCard label="Охват (показы)" value={formatNumber(summary.views)} tooltip="Суммарные показы" />
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Динамика расходов</h2>
        {loading ? <ChartSkeleton /> : (
          <div className="rounded-xl border border-slate-700/80 bg-slate-800/40 p-4">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => v.slice(8)} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <Tooltip
                  contentStyle={{ background: "#1e293b", border: "1px solid #475569", borderRadius: 8 }}
                  formatter={(value, name) => {
                    const v = Number(value ?? 0);
                    const n = String(name);
                    return [
                      n === "spend" || n === "cpo" ? formatRub(v) : formatNumber(v),
                      n === "spend" ? "Расходы" : n === "orders" ? "Заказы" : "CPO",
                    ];
                  }}
                />
                <Line yAxisId="left" type="monotone" dataKey="spend" stroke="#ef4444" strokeWidth={2} dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="orders" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Кампании</h2>
        {loading ? <TableSkeleton /> : <AnalyticsTable columns={campaignColumns} data={campaigns} filename="campaigns.csv" emptyMessage="Нет данных по кампаниям. Проверьте WB_TOKEN_ADVERT и доступ к рекламе." />}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Матрица эффективности</h2>
        {loading ? <ChartSkeleton height={300} /> : campaigns.length > 0 ? (
          <div className="rounded-xl border border-slate-700/80 bg-slate-800/40 p-4">
            <div className="mb-2 grid grid-cols-2 gap-2 text-[10px] text-slate-500">
              <span>↖ Скрытые гемы</span>
              <span className="text-right">Звёзды ↗</span>
              <span>↙ Аутсайдеры</span>
              <span className="text-right">Пожиратели бюджета ↘</span>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" dataKey="spend" name="Расходы" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <YAxis type="number" dataKey="roas" name="ROAS" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <ZAxis type="number" dataKey="orders" range={[40, 400]} />
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #475569" }} cursor={{ strokeDasharray: "3 3" }} />
                <Scatter data={scatterData} fill="#10b981" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Нет данных для матрицы</p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Ключевые слова</h2>
        <div className="rounded-xl border border-slate-700/80 bg-slate-800/40 p-6 text-center text-sm text-slate-500">
          Данные по ключевым словам недоступны через текущий API. Подключите отчёт search-report для детализации.
        </div>
      </section>
    </AnalyticsShell>
  );
}
