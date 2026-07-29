"use client";

import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Target,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { summarizeOperationalPlanning } from "@/lib/planning/operational";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";

interface PlanningBlock {
  orders: number[];
  norms: Record<string, unknown>;
  sku_orders: Record<string, number[]>;
  error?: string;
}

interface PlanningSku {
  art: string;
  name: string;
  cat: string;
  wb_stock: number;
}

interface SkusData {
  skus: PlanningSku[];
  count: number;
  wb_stock_date?: string | null;
  error?: string;
}

const MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const SKU_ROW_HEIGHT = 35;
const CURRENT_YEAR = 2026;
const number = (value: number) => Math.round(value || 0).toLocaleString("ru-RU");
const money = (value: number) => `${number(value)} ₽`;

export function WbPlanningPage() {
  const { activeCabinet, cabinetId, cabinets, canUseAll, ready, loading: cabinetsLoading, error: cabinetsError } = useWbCabinet();
  const [year, setYear] = useState(CURRENT_YEAR);
  const [plan, setPlan] = useState<PlanningBlock | null>(null);
  const [skus, setSkus] = useState<SkusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [skuOpen, setSkuOpen] = useState(false);
  const [skuWindow, setSkuWindow] = useState({ start: 0, end: 14 });
  const revision = useRef(0);
  const requestId = useRef(0);
  const elapsed = useElapsedSeconds(loading);
  const canEdit = cabinetId !== "all" || canUseAll;

  useEffect(() => {
    if (!ready || cabinetsLoading) return;
    if (cabinets.length === 0) {
      setLoading(false);
      setError(cabinetsError || "Подключите хотя бы один активный WB-кабинет в настройках");
      return;
    }

    const controller = new AbortController();
    const current = ++requestId.current;
    const params = new URLSearchParams({ year: String(year), cabinet: cabinetId || "all" });
    setLoading(true);
    setError(null);
    setSaveError(null);
    setSaved(false);
    setDirty(false);

    Promise.all([
      fetch(`/api/planning/pl?${params.toString()}`, { cache: "no-store", signal: controller.signal }),
      fetch(`/api/planning/skus?cabinet=${encodeURIComponent(cabinetId || "all")}`, { cache: "no-store", signal: controller.signal }),
    ])
      .then(async ([planResponse, skusResponse]) => {
        const planBody = (await planResponse.json()) as PlanningBlock;
        const skusBody = (await skusResponse.json()) as SkusData;
        if (!planResponse.ok) throw new Error(planBody.error || `Ошибка ${planResponse.status}`);
        if (!skusResponse.ok) throw new Error(skusBody.error || `Ошибка ${skusResponse.status}`);
        return [planBody, skusBody] as const;
      })
      .then(([planBody, skusBody]) => {
        if (current !== requestId.current) return;
        setPlan(planBody);
        setSkus(skusBody);
        setSkuOpen(false);
        setSkuWindow({ start: 0, end: Math.min(14, skusBody.skus.length) });
      })
      .catch((cause: unknown) => {
        if (current === requestId.current && !controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Не удалось загрузить планирование");
        }
      })
      .finally(() => {
        if (current === requestId.current) setLoading(false);
      });

    return () => controller.abort();
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, ready, retryKey, year]);

  useEffect(() => {
    if (!dirty || !plan || !canEdit) return;
    const savedRevision = revision.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSaving(true);
      setSaveError(null);
      fetch(`/api/planning/pl?cabinet=${encodeURIComponent(cabinetId || "all")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, orders: plan.orders, norms: plan.norms, sku_orders: plan.sku_orders }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const body = (await response.json()) as { ok?: boolean; error?: string };
          if (!response.ok || !body.ok) throw new Error(body.error || `Ошибка ${response.status}`);
        })
        .then(() => {
          if (revision.current === savedRevision) {
            setDirty(false);
            setSaved(true);
          }
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) setSaveError(cause instanceof Error ? cause.message : "Не удалось сохранить план");
        })
        .finally(() => {
          if (!controller.signal.aborted) setSaving(false);
        });
    }, 700);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cabinetId, canEdit, dirty, plan, year]);

  const touch = (next: PlanningBlock) => {
    revision.current += 1;
    setPlan(next);
    setDirty(true);
    setSaved(false);
  };

  const setOrder = (month: number, raw: string) => {
    if (!plan || !canEdit) return;
    const orders = [...plan.orders];
    orders[month] = Number(raw) || 0;
    touch({ ...plan, orders });
  };

  const setSkuOrder = (article: string, month: number, raw: string) => {
    if (!plan || !canEdit) return;
    const months = [...(plan.sku_orders[article] ?? Array.from({ length: 12 }, () => 0))];
    months[month] = Number(raw) || 0;
    touch({ ...plan, sku_orders: { ...plan.sku_orders, [article]: months } });
  };

  const operational = useMemo(() => {
    return summarizeOperationalPlanning({
      orders: plan?.orders ?? [],
      skuOrders: plan?.sku_orders ?? {},
      stocks: (skus?.skus ?? []).map((sku) => sku.wb_stock),
    });
  }, [plan?.orders, plan?.sku_orders, skus?.skus]);

  const updateSkuWindow = (element: HTMLDivElement) => {
    const first = Math.floor(element.scrollTop / SKU_ROW_HEIGHT);
    const visible = Math.ceil(element.clientHeight / SKU_ROW_HEIGHT);
    const start = Math.max(0, first - 4);
    const end = Math.min(skus?.skus.length ?? 0, first + visible + 5);
    setSkuWindow((current) => current.start === start && current.end === end ? current : { start, end });
  };

  const headerActions = (
    <>
      <div className="flex h-11 items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm sm:h-8">
        <button type="button" onClick={() => setYear((value) => value - 1)} aria-label="Предыдущий год" className="grid h-10 w-10 place-items-center rounded-md text-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:h-7 sm:w-7"><ChevronLeft className="h-3.5 w-3.5" /></button>
        <span className="min-w-12 px-1 text-center text-xs font-bold tabular-nums text-slate-700">{year}</span>
        <button type="button" onClick={() => setYear((value) => value + 1)} aria-label="Следующий год" className="grid h-10 w-10 place-items-center rounded-md text-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:h-7 sm:w-7"><ChevronRight className="h-3.5 w-3.5" /></button>
      </div>
      <span aria-live="polite" className={`inline-flex h-11 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium sm:h-8 ${saveError ? "border-rose-200 bg-rose-50 text-rose-600" : "border-slate-200 bg-white text-slate-500"}`}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <CheckCircle2 className={`h-3.5 w-3.5 ${saved ? "text-emerald-500" : "text-slate-300"}`} />}
        {saving ? "Сохраняем…" : saveError ? "Ошибка сохранения" : dirty ? "Есть изменения" : saved ? "Сохранено" : "Автосохранение"}
      </span>
    </>
  );

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
      <WbModuleHeader
        icon={Target}
        title={`План продаж и закупки WB · ${year}`}
        description="Операционный план заказов и потребности по SKU. Финансовый ОПиУ ведётся отдельно."
        actions={headerActions}
      />

      <div className="px-2 py-3 sm:px-6">
        {saveError ? <div role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{saveError}. Изменения остались на экране — повторная попытка произойдёт после следующего редактирования.</div> : null}
        {loading ? (
          <>
            <LoadingBanner seconds={elapsed} hint="план и остатки WB" />
            <SkeletonTableRows rows={12} cols={8} />
          </>
        ) : error ? (
          <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} />
        ) : !plan ? (
          <WbEmptyState>Нет данных планирования.</WbEmptyState>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">План заказов за год</div><div className="mt-2 text-xl font-bold tabular-nums text-slate-800">{money(operational.annualOrders)}</div></div>
              <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Потребность SKU за год</div><div className="mt-2 text-xl font-bold tabular-nums text-slate-800">{number(operational.annualSkuUnits)} шт.</div></div>
              <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">SKU с планом</div><div className="mt-2 text-xl font-bold tabular-nums text-slate-800">{number(operational.plannedSku)} из {number(skus?.count ?? 0)}</div></div>
              <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Остаток WB сейчас</div><div className="mt-2 text-xl font-bold tabular-nums text-slate-800">{number(operational.stock)} шт.</div><div className="mt-1 text-[10px] text-slate-400">на {skus?.wb_stock_date || "—"}</div></div>
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-900 sm:flex-row sm:items-center sm:justify-between">
              <span><b>Это операционный план:</b> объём заказов, потребность по артикулам и текущие остатки. Маржа, налоги, расходы и прибыль здесь не рассчитываются.</span>
              <Link href="/pnl" className="shrink-0 font-semibold text-sky-700 underline underline-offset-2">Открыть финансовый ОПиУ</Link>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[1450px] border-collapse text-[12px] leading-4 text-slate-700">
                <thead>
                  <tr className="h-9 bg-slate-50 text-[11px] font-semibold text-slate-500">
                    <th className="sticky left-0 z-30 w-[235px] min-w-[235px] border-b border-r border-slate-200 bg-slate-50 px-3 text-left">Операционный показатель</th>
                    {MONTHS.map((month) => <th key={month} className="min-w-[100px] border-b border-r border-slate-200 px-2 text-right last:border-r-0">{month}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr className="h-[34px] bg-white">
                    <td className="sticky left-0 z-20 border-b border-r border-slate-200 bg-white px-3 font-medium">План заказов, ₽</td>
                    {plan.orders.map((value, month) => (
                      <td key={month} className="border-b border-r border-slate-200 bg-[#fffdf6] px-2 last:border-r-0">
                        <input
                          type="number"
                          min={0}
                          value={value || 0}
                          onChange={(event) => setOrder(month, event.target.value)}
                          disabled={!canEdit}
                          aria-label={`План заказов, ${MONTHS[month]}`}
                          className="h-10 w-full rounded-lg border border-[#f1e8d8] bg-white px-2 text-right text-[12px] font-semibold tabular-nums text-[#8d341f] outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 sm:h-7"
                        />
                      </td>
                    ))}
                  </tr>
                  <tr className="h-8 bg-white text-slate-600">
                    <td className="sticky left-0 z-20 border-b border-r border-slate-200 bg-white px-3 font-medium">Потребность по SKU, шт.</td>
                    {operational.skuUnitsByMonth.map((value, month) => <td key={MONTHS[month]} className="border-b border-r border-slate-200 px-2 text-right font-semibold tabular-nums last:border-r-0">{value ? number(value) : "—"}</td>)}
                  </tr>
                  <tr className="h-8 bg-white text-slate-500">
                    <td className="sticky left-0 z-20 border-b border-r border-slate-200 bg-white px-3 font-medium">SKU с планом</td>
                    {operational.activeSkuByMonth.map((value, month) => <td key={MONTHS[month]} className="border-b border-r border-slate-200 px-2 text-right tabular-nums last:border-r-0">{value ? number(value) : "—"}</td>)}
                  </tr>
                  <tr className="h-9 bg-indigo-50 text-indigo-700">
                    <td className="sticky left-0 z-20 border-b border-r border-indigo-100 bg-indigo-50 px-3 font-semibold">
                      <button type="button" onClick={() => setSkuOpen((value) => !value)} className="flex min-h-8 w-full items-center gap-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${skuOpen ? "rotate-180" : ""}`} />
                        Детализация по SKU ({skus?.count ?? 0})
                      </button>
                    </td>
                    {MONTHS.map((month, index) => <td key={month} className="border-b border-r border-indigo-100 px-2 text-right font-semibold tabular-nums last:border-r-0">{operational.skuUnitsByMonth[index] ? number(operational.skuUnitsByMonth[index]) : "—"}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>

            {skuOpen ? (
              <div className="border-t border-indigo-100 bg-indigo-50/40 p-2">
                <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-slate-500">
                  <span>Потребность по артикулам, шт.</span>
                  <span>{activeCabinet?.name ?? "Все кабинеты"} · остатки на {skus?.wb_stock_date || "—"}</span>
                </div>
                <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-200 bg-white" onScroll={(event) => updateSkuWindow(event.currentTarget)}>
                  <table className="w-full min-w-[1540px] border-collapse text-[11px] text-slate-600">
                    <thead className="sticky top-0 z-20 bg-slate-50">
                      <tr className="h-8">
                        <th className="sticky left-0 z-30 w-[235px] min-w-[235px] border-b border-r border-slate-200 bg-slate-50 px-3 text-left">SKU / остаток</th>
                        <th className="sticky left-[235px] z-30 w-[100px] min-w-[100px] border-b border-r border-slate-200 bg-slate-50 px-2 text-right">Категория</th>
                        {MONTHS.map((month) => <th key={month} className="min-w-[100px] border-b border-r border-slate-200 px-2 text-right">{month}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {skuWindow.start > 0 ? <tr aria-hidden="true" style={{ height: skuWindow.start * SKU_ROW_HEIGHT }}><td colSpan={14} /></tr> : null}
                      {(skus?.skus ?? []).slice(skuWindow.start, skuWindow.end).map((sku) => (
                        <tr key={sku.art} className="h-[35px] hover:bg-violet-50/30">
                          <td className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-3"><span className="font-semibold text-slate-700">{sku.art}</span><span className="ml-2 text-[10px] text-slate-400">остаток {sku.wb_stock.toLocaleString("ru-RU")}</span></td>
                          <td className="sticky left-[235px] z-10 max-w-[100px] truncate border-b border-r border-slate-100 bg-white px-2 text-right text-[10px] text-slate-400">{sku.cat}</td>
                          {MONTHS.map((month, index) => (
                            <td key={month} className="border-b border-r border-slate-100 bg-[#fffdf6] px-1.5">
                              <input type="number" min={0} value={plan.sku_orders[sku.art]?.[index] ?? 0} onChange={(event) => setSkuOrder(sku.art, index, event.target.value)} disabled={!canEdit} aria-label={`${sku.art}, ${month}`} className="h-10 w-full rounded-md border border-transparent bg-transparent px-1.5 text-right tabular-nums outline-none hover:border-[#f1e8d8] focus:border-violet-400 focus:bg-white sm:h-7" />
                            </td>
                          ))}
                        </tr>
                      ))}
                      {skuWindow.end < (skus?.skus.length ?? 0) ? <tr aria-hidden="true" style={{ height: ((skus?.skus.length ?? 0) - skuWindow.end) * SKU_ROW_HEIGHT }}><td colSpan={14} /></tr> : null}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
