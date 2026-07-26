"use client";

import { Loader2, RefreshCw, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionableError } from "@/components/ui/ActionableError";
import {
  calculateSalesPlanRowMonth,
  calculateSalesPlanSummary,
  daysInSalesPlanMonth,
  getSalesPlanMonthState,
  salesPlanMonthLabel,
  type SalesPlanDocument,
  type SalesPlanMarketplace,
  type SalesPlanRow,
} from "@/lib/planning/salesPlan";

interface FactMetric {
  field: string;
  daily: (number | null)[];
  total?: number | null;
  forecast?: number | null;
}

interface FactSku {
  nm?: number;
  art?: string;
  sku?: string;
  name?: string;
  metrics: FactMetric[];
}

interface FactPayload {
  period?: { label: string; period_type: string }[];
  skus?: FactSku[];
  error?: string;
}

interface FactRow {
  row: SalesPlanRow;
  orders: (number | null)[];
  ads: (number | null)[];
  gross: (number | null)[];
}

const number = (value: number) => Math.round(value || 0).toLocaleString("ru-RU");
const money = (value: number) => `${number(value)} ₽`;
const sumValues = (values: (number | null)[]) => values.reduce<number>((sum, value) => sum + Number(value ?? 0), 0);

function metric(sku: FactSku, fields: string[]) {
  return sku.metrics.find((item) => fields.includes(item.field));
}

function alignDaily(payload: FactPayload, source: (number | null)[] | undefined, monthKey: string, days: number) {
  const values: (number | null)[] = Array.from({ length: days }, () => null);
  for (let index = 0; index < (payload.period?.length ?? 0); index++) {
    const [day, month] = String(payload.period?.[index]?.label ?? "").split(".");
    if (month !== monthKey) continue;
    const dayIndex = Number(day) - 1;
    if (dayIndex >= 0 && dayIndex < days) values[dayIndex] = source?.[index] ?? null;
  }
  return values;
}

export function SalesPlanFactView({ marketplace, cabinetId, monthKey, approvedPlan }: { marketplace: SalesPlanMarketplace; cabinetId: string; monthKey: string; approvedPlan: SalesPlanDocument | null }) {
  const [data, setData] = useState<FactPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const days = approvedPlan ? daysInSalesPlanMonth(approvedPlan.year, monthKey) : 0;

  const load = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    if (!approvedPlan || !cabinetId) return;
    const controller = new AbortController();
    const month = Number(monthKey);
    const lastDay = daysInSalesPlanMonth(approvedPlan.year, monthKey);
    const from = `${approvedPlan.year}-${monthKey}-01`;
    const to = `${approvedPlan.year}-${monthKey}-${String(lastDay).padStart(2, "0")}`;
    const url = marketplace === "wb"
      ? `/api/rnp/${encodeURIComponent(cabinetId)}/table?date_from=${from}&date_to=${to}`
      : `/api/ozon/rnp?cabinet=${encodeURIComponent(cabinetId)}&year=${approvedPlan.year}&month=${month}`;
    setLoading(true);
    setError(null);
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as FactPayload;
        if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then(setData)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить факт"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [approvedPlan, cabinetId, marketplace, monthKey, reloadKey]);

  const rows = useMemo<FactRow[]>(() => {
    if (!approvedPlan) return [];
    const byId = new Map<string, FactSku>();
    for (const sku of data?.skus ?? []) {
      if (sku.nm != null) byId.set(String(sku.nm), sku);
      if (sku.sku) byId.set(String(sku.sku), sku);
      if (sku.art) byId.set(sku.art.toLocaleLowerCase("ru-RU"), sku);
    }
    return approvedPlan.rows.map((row) => {
      const sku = byId.get(row.externalId) ?? byId.get(row.variant.toLocaleLowerCase("ru-RU"));
      return {
        row,
        orders: alignDaily(data ?? {}, metric(sku ?? { metrics: [] }, ["orders_count", "orders"])?.daily, monthKey, days),
        ads: alignDaily(data ?? {}, metric(sku ?? { metrics: [] }, ["ad_spent", "ad"])?.daily, monthKey, days),
        gross: alignDaily(data ?? {}, metric(sku ?? { metrics: [] }, ["orders_sum", "revenue"])?.daily, monthKey, days),
      };
    });
  }, [approvedPlan, data, days, monthKey]);

  if (!approvedPlan) {
    return (
      <div className="grid min-h-[420px] place-items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 text-center">
        <div className="max-w-md">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-500"><TrendingUp className="h-6 w-6" /></div>
          <h2 className="mt-4 text-lg font-bold text-slate-900">Нет утверждённого плана</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">План‑факт появляется только после согласования и утверждения версии для выбранного кабинета.</p>
        </div>
      </div>
    );
  }

  const planSummary = calculateSalesPlanSummary(approvedPlan, [monthKey]);
  const approvedMonthState = getSalesPlanMonthState(approvedPlan, monthKey);
  const factOrders = rows.reduce((sum, item) => sum + sumValues(item.orders), 0);
  const knownDays = Math.max(0, ...rows.map((item) => item.orders.reduce<number>((last, value, index) => value != null ? index + 1 : last, 0)));
  const forecast = knownDays > 0 ? Math.round((factOrders / knownDays) * days) : 0;
  const execution = planSummary.orders > 0 ? (factOrders / planSummary.orders) * 100 : 0;

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]" aria-label="Сводка план факт">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-sm font-bold text-slate-900">План · факт · прогноз заказов</h2><p className="mt-1 text-xs text-slate-500">Утверждённый план v{approvedMonthState.version} · {salesPlanMonthLabel(approvedPlan.year, monthKey)} · факт из {marketplace === "wb" ? "Wildberries" : "Ozon"}</p></div>
          <button type="button" onClick={load} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 sm:min-h-9"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} /> Обновить факт</button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="План месяца" value={`${number(planSummary.orders)} шт.`} detail={`${approvedPlan.rows.length} цветовых вариаций`} tone="amber" />
          <Kpi label="Факт месяца" value={`${number(factOrders)} шт.`} detail={knownDays ? `данные по ${knownDays} день` : "нет закрытых дней"} />
          <Kpi label="Прогноз месяца" value={`${number(forecast)} шт.`} detail="оперативная оценка по темпу" tone="violet" />
          <Kpi label="Выполнение плана" value={`${execution.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`} detail={`${number(factOrders - planSummary.orders)} шт. к плану`} tone={execution >= 90 ? "green" : "red"} />
        </div>
      </section>

      {error ? <ActionableError message={error} label="План-факт" onRetry={load} /> : null}
      {loading && !data ? <div className="flex min-h-72 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /> Загружаем фактические заказы…</div> : (
        <div className="max-w-full overflow-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-max min-w-full border-separate border-spacing-0 text-[10px] leading-4 text-slate-700">
            <thead><tr className="h-10 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              <th className="sticky left-0 top-0 z-30 w-[205px] min-w-[205px] border-b border-r border-slate-200 bg-slate-50 px-3 text-left shadow-[6px_0_10px_rgba(15,23,42,0.05)]">Цвет · факт / план</th>
              {Array.from({ length: days }, (_, day) => <th key={day} className="sticky top-0 z-20 w-14 min-w-14 border-b border-r border-slate-200 bg-slate-50 px-1 text-center"><span className="block text-slate-600">{String(day + 1).padStart(2, "0")}</span><span className="text-[9px] font-medium normal-case text-slate-400">день</span></th>)}
              <th className="sticky top-0 z-20 w-[88px] min-w-[88px] border-b border-r border-slate-200 bg-slate-50 px-2 text-right">Заказы</th><th className="sticky top-0 z-20 w-[78px] min-w-[78px] border-b border-r border-slate-200 bg-slate-50 px-2 text-right">Выполн.</th><th className="sticky top-0 z-20 w-[118px] min-w-[118px] border-b border-r border-slate-200 bg-slate-50 px-2 text-right">Реклама ф/п</th><th className="sticky top-0 z-20 w-[96px] min-w-[96px] border-b border-slate-200 bg-slate-50 px-2 text-right">ДРР ф/п</th>
            </tr></thead>
            <tbody>{rows.map((item) => <FactTableRow key={item.row.id} item={item} monthKey={monthKey} days={days} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FactTableRow({ item, monthKey, days }: { item: FactRow; monthKey: string; days: number }) {
  const plan = calculateSalesPlanRowMonth(item.row, monthKey);
  const factOrders = sumValues(item.orders);
  const knownOrders = item.orders.some((value) => value != null);
  const factAds = item.ads.some((value) => value != null) ? sumValues(item.ads) : null;
  const factGross = item.gross.some((value) => value != null) ? sumValues(item.gross) : null;
  const factDrr = factAds != null && factGross != null && factGross > 0 ? (factAds / factGross) * 100 : null;
  const execution = plan.orders > 0 && knownOrders ? (factOrders / plan.orders) * 100 : null;
  return (
    <tr className="h-12 hover:bg-slate-50/70">
      <td className="sticky left-0 z-10 w-[205px] min-w-[205px] border-b border-r border-slate-200 bg-white px-3 shadow-[6px_0_10px_rgba(15,23,42,0.04)]"><span className="block truncate font-semibold text-slate-800" title={`${item.row.model} · ${item.row.color}`}>{item.row.model} · {item.row.color}</span><span className="block truncate text-[10px] text-slate-400" title={item.row.variant}>{item.row.variant}</span></td>
      {Array.from({ length: days }, (_, day) => {
        const fact = item.orders[day];
        const planned = item.row.months[monthKey]?.[day] ?? 0;
        const delta = fact == null ? null : fact - planned;
        const tone = delta == null || delta === 0 ? "bg-white" : delta > 0 ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800";
        const title = fact == null ? `План: ${number(planned)} шт.` : `Факт: ${number(fact)} шт. · План: ${number(planned)} шт.`;
        return <td key={day} title={title} className={`w-14 min-w-14 border-b border-r border-slate-200 px-1 text-center tabular-nums ${tone}`}><span className="block whitespace-nowrap font-semibold">{fact == null ? "—" : number(fact)} / {number(planned)}</span><span className="block text-[9px] opacity-70">{delta == null ? "" : delta > 0 ? `+${number(delta)}` : number(delta)}</span></td>;
      })}
      <td className="border-b border-r border-slate-200 px-2 text-right font-semibold tabular-nums">{knownOrders ? number(factOrders) : "—"} / {number(plan.orders)}</td>
      <td className="border-b border-r border-slate-200 px-2 text-right font-semibold tabular-nums">{execution == null ? "—" : `${execution.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`}</td>
      <td className="border-b border-r border-slate-200 px-2 text-right tabular-nums">{factAds == null ? "—" : money(factAds)} / {money(plan.ads)}</td>
      <td className="border-b border-slate-200 px-2 text-right tabular-nums">{factDrr == null ? "—" : `${factDrr.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`} / {plan.drr.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%</td>
    </tr>
  );
}

function Kpi({ label, value, detail, tone = "slate" }: { label: string; value: string; detail: string; tone?: "slate" | "amber" | "violet" | "green" | "red" }) {
  const styles = { slate: "border-slate-200 bg-white text-slate-900", amber: "border-amber-200 bg-amber-50 text-amber-950", violet: "border-violet-200 bg-violet-50 text-violet-900", green: "border-emerald-200 bg-emerald-50 text-emerald-900", red: "border-rose-200 bg-rose-50 text-rose-900" }[tone];
  return <div className={`rounded-xl border p-4 ${styles}`}><div className="text-[10px] font-bold uppercase tracking-wide opacity-60">{label}</div><div className="mt-1 text-xl font-bold tabular-nums">{value}</div><div className="mt-1 text-[11px] opacity-60">{detail}</div></div>;
}
