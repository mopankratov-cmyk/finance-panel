"use client";

import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Target,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
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

type RowKind = "section" | "subsection" | "metric" | "total" | "muted" | "final";

interface MatrixRow {
  label: string;
  kind: RowKind;
  normKey?: string;
  values?: (month: number) => number | null;
}

const MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const DEFAULT_NORMS: Record<string, number> = {
  buyout: 80,
  payout: 53,
  cost: 20,
  commission: 38.5,
  fulfillment: 1,
  logistics: 1,
  acceptance: 0,
  other: 3,
  vat: 3,
  ads: 6,
  promotion: 0,
  barter: 0,
  storage: 0.5,
  defects: 0.5,
  materials: 0.5,
};

const SKU_ROW_HEIGHT = 35;
const CURRENT_YEAR = 2026;

const fmt = (value: number | null) => {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 0.5) return "—";
  return Math.round(value).toLocaleString("ru-RU");
};

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

  const norm = (key: string) => {
    const value = Number(plan?.norms[key]);
    return Number.isFinite(value) ? value : DEFAULT_NORMS[key] ?? 0;
  };

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

  const setNorm = (key: string, raw: string) => {
    if (!plan || !canEdit) return;
    touch({ ...plan, norms: { ...plan.norms, [key]: Number(raw) || 0 } });
  };

  const setSkuOrder = (article: string, month: number, raw: string) => {
    if (!plan || !canEdit) return;
    const months = [...(plan.sku_orders[article] ?? Array.from({ length: 12 }, () => 0))];
    months[month] = Number(raw) || 0;
    touch({ ...plan, sku_orders: { ...plan.sku_orders, [article]: months } });
  };

  const matrixRows = useMemo<MatrixRow[]>(() => {
    if (!plan) return [];
    const revenue = (month: number) => plan.orders[month] * norm("buyout") / 100;
    const expense = (key: string, month: number) => -revenue(month) * norm(key) / 100;
    const marginal = (month: number) => revenue(month) + ["cost", "commission", "fulfillment", "logistics", "acceptance", "other", "vat"].reduce((sum, key) => sum + expense(key, month), 0);
    const gross = (month: number) => marginal(month) + ["ads", "promotion", "barter"].reduce((sum, key) => sum + expense(key, month), 0);
    const operating = (month: number) => gross(month) + ["storage", "defects", "materials"].reduce((sum, key) => sum + expense(key, month), 0);

    return [
      { label: "ВЫРУЧКА", kind: "section" },
      { label: "Выручка (выкуп)", kind: "metric", normKey: "buyout", values: revenue },
      { label: "К перечислению на счёт", kind: "metric", normKey: "payout", values: (month) => revenue(month) * norm("payout") / 100 },
      { label: "ПЕРЕМЕННЫЕ РАСХОДЫ (% ОТ ВЫРУЧКИ)", kind: "subsection" },
      { label: "Себестоимость WB", kind: "metric", normKey: "cost", values: (month) => expense("cost", month) },
      { label: "Комиссия WB", kind: "metric", normKey: "commission", values: (month) => expense("commission", month) },
      { label: "Фулфилмент", kind: "metric", normKey: "fulfillment", values: (month) => expense("fulfillment", month) },
      { label: "Логистика до МП", kind: "metric", normKey: "logistics", values: (month) => expense("logistics", month) },
      { label: "Платная приёмка", kind: "metric", normKey: "acceptance", values: (month) => expense("acceptance", month) },
      { label: "Прочие WB", kind: "metric", normKey: "other", values: (month) => expense("other", month) },
      { label: "НДС", kind: "metric", normKey: "vat", values: (month) => expense("vat", month) },
      { label: "Маржинальная прибыль", kind: "total", values: marginal },
      { label: "Рент. по маржинальной", kind: "muted", values: (month) => revenue(month) > 0 ? marginal(month) / revenue(month) * 100 : null },
      { label: "ОБЩЕПРОИЗВОДСТВЕННЫЕ", kind: "subsection" },
      { label: "Реклама внутренняя", kind: "metric", normKey: "ads", values: (month) => expense("ads", month) },
      { label: "Продвижение", kind: "metric", normKey: "promotion", values: (month) => expense("promotion", month) },
      { label: "Бартеры и раздачи", kind: "metric", normKey: "barter", values: (month) => expense("barter", month) },
      { label: "Валовая прибыль WB", kind: "total", values: gross },
      { label: "Хранение", kind: "metric", normKey: "storage", values: (month) => expense("storage", month) },
      { label: "Списание брака", kind: "metric", normKey: "defects", values: (month) => expense("defects", month) },
      { label: "Расходные материалы", kind: "metric", normKey: "materials", values: (month) => expense("materials", month) },
      { label: "Операционная прибыль WB", kind: "final", values: operating },
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

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
        title={`Планирование — ОПиУ ${year}`}
        description="Жёлтые ячейки редактируемые: заказы по месяцам и нормативы. Остальное считается автоматически."
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
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="overflow-x-auto overscroll-x-contain">
              <table className="w-full min-w-[1540px] border-collapse text-[12px] leading-4 text-slate-700">
                <thead>
                  <tr className="h-9 bg-slate-50 text-[11px] font-semibold text-slate-500">
                    <th className="sticky left-0 z-30 w-[235px] min-w-[235px] border-b border-r border-slate-200 bg-slate-50 px-3 text-left">Статья</th>
                    <th className="sticky left-[235px] z-30 w-[100px] min-w-[100px] border-b border-r border-slate-200 bg-slate-50 px-2 text-right">Норматив</th>
                    {MONTHS.map((month) => <th key={month} className="min-w-[100px] border-b border-r border-slate-200 px-2 text-right last:border-r-0">{month}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr className="h-[34px] bg-white">
                    <td className="sticky left-0 z-20 border-b border-r border-slate-200 bg-white px-3 font-medium">Заказы (₽)</td>
                    <td className="sticky left-[235px] z-20 border-b border-r border-slate-200 bg-white" />
                    {plan.orders.map((value, month) => (
                      <td key={month} className="border-b border-r border-slate-200 bg-[#fffdf6] px-2 last:border-r-0">
                        <input
                          type="number"
                          min={0}
                          value={value || 0}
                          onChange={(event) => setOrder(month, event.target.value)}
                          disabled={!canEdit}
                          aria-label={`Заказы, ${MONTHS[month]}`}
                          className="h-10 w-full rounded-lg border border-[#f1e8d8] bg-white px-2 text-right text-[12px] font-semibold tabular-nums text-[#8d341f] outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 sm:h-7"
                        />
                      </td>
                    ))}
                  </tr>
                  <tr className="h-8 bg-indigo-50 text-indigo-700">
                    <td className="sticky left-0 z-20 border-b border-r border-indigo-100 bg-indigo-50 px-3 font-semibold">
                      <button type="button" onClick={() => setSkuOpen((value) => !value)} className="flex min-h-8 w-full items-center gap-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${skuOpen ? "rotate-180" : ""}`} />
                        SKU план ({skus?.count ?? 0})
                      </button>
                    </td>
                    <td className="sticky left-[235px] z-20 border-b border-r border-indigo-100 bg-indigo-50" />
                    {MONTHS.map((month) => <td key={month} className="border-b border-r border-indigo-100 px-2 text-right last:border-r-0">—</td>)}
                  </tr>
                  {matrixRows.map((row) => {
                    const section = row.kind === "section";
                    const subsection = row.kind === "subsection";
                    const total = row.kind === "total" || row.kind === "final";
                    const muted = row.kind === "muted";
                    const background = section ? "bg-[#54dfcf]" : subsection ? "bg-slate-100" : total ? "bg-[#c9f7ef]" : muted ? "bg-[#f4fafb]" : "bg-white";
                    return (
                      <tr key={row.label} className={`h-[31px] ${background}`}>
                        <td className={`sticky left-0 z-20 border-b border-r border-slate-200 px-3 ${background} ${section || total ? "font-bold text-teal-900" : subsection ? "text-[10px] font-semibold uppercase text-slate-500" : muted ? "text-[10px] text-slate-400" : "font-medium"}`}>{row.label}</td>
                        <td className={`sticky left-[235px] z-20 border-b border-r border-slate-200 px-2 text-right ${background}`}>
                          {row.normKey ? (
                            <label className="inline-flex h-10 items-center rounded-lg border border-slate-200 bg-white pl-2 shadow-sm focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100 sm:h-7">
                              <input type="number" min={0} step="0.1" value={norm(row.normKey)} onChange={(event) => setNorm(row.normKey!, event.target.value)} disabled={!canEdit} aria-label={`${row.label}, норматив`} className="w-11 bg-transparent text-right text-[11px] tabular-nums text-[#8d341f] outline-none disabled:text-slate-400" />
                              <span className="px-1.5 text-[10px] text-slate-400">%</span>
                            </label>
                          ) : null}
                        </td>
                        {MONTHS.map((month, index) => {
                          const value = row.values?.(index) ?? null;
                          const tone = muted ? "text-slate-400" : total ? "font-bold text-teal-800" : value != null && value < 0 ? "text-rose-500" : "text-slate-600";
                          return <td key={month} className={`border-b border-r border-slate-200 px-2 text-right tabular-nums last:border-r-0 ${tone}`}>{muted && value != null ? `${Math.round(value * 10) / 10}%` : fmt(value)}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {skuOpen ? (
              <div className="border-t border-indigo-100 bg-indigo-50/40 p-2">
                <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-slate-500">
                  <span>План заказов по артикулам</span>
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
        )}
      </div>
    </div>
  );
}
