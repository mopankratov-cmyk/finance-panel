"use client";

import { Boxes, Loader2, PackageCheck, RefreshCw, Search, ShieldCheck, Truck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { ReceivingTab } from "@/components/supplies/ReceivingTab";
import { StockCatalogTab } from "@/components/supplies/StockCatalogTab";
import { MoySkladSourceTab } from "@/components/supplies/MoySkladSourceTab";
import type { StockCatalogRow, SupplyRow, WarehouseSummary } from "@/app/api/supplies/route";
import { WbEmptyState, WbErrorState, WbModuleHeader } from "./WbModuleHeader";
import { useWbCabinet } from "./WbCabinetContext";
import { WbPurchaseOrdersTab } from "./WbPurchaseOrdersTab";
import { WbSupplyDistributionPlanner, type DistributionSkuInput, type DistributionWarehouseInput } from "./WbSupplyDistributionPlanner";

type Tab = "orders" | "distribution" | "reorder" | "stock" | "receiving" | "source";
type Horizon = 30 | 45 | 60;

interface SuppliesResponse {
  data: { skus: SupplyRow[]; warehouses: WarehouseSummary[]; catalog: StockCatalogRow[] } | null;
  error: string | null;
  warehouses: DistributionWarehouseInput[];
  skus: DistributionSkuInput[];
  totals: { wb_stock: number; available: number; qty: number[] };
  threshold: number;
  pallet_liters?: number;
  vol_known?: number;
  vol_total?: number;
}

const format = (value: number) => Math.round(value).toLocaleString("ru-RU");

export function WbSuppliesPage() {
  const { activeCabinet, cabinetId, canWrite, cabinets, ready, loading: cabinetsLoading, error: cabinetsError } = useWbCabinet();
  const [tab, setTab] = useState<Tab>("orders");
  const [data, setData] = useState<SuppliesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [minBatch, setMinBatch] = useState(30);
  const [horizon, setHorizon] = useState<Horizon>(45);
  const [retryKey, setRetryKey] = useState(0);
  const requestId = useRef(0);
  const elapsed = useElapsedSeconds(loading);

  const load = useCallback(() => {
    if (!ready || cabinetsLoading) return undefined;
    if (cabinets.length === 0) {
      setLoading(false);
      setError(cabinetsError || "Подключите хотя бы один активный WB-кабинет в настройках");
      return undefined;
    }
    const controller = new AbortController();
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    fetch(`/api/supplies?cabinet=${encodeURIComponent(cabinetId || "all")}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as SuppliesResponse;
        if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then((body) => { if (current === requestId.current) setData(body); })
      .catch((cause: unknown) => { if (current === requestId.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить поставки"); })
      .finally(() => { if (current === requestId.current) setLoading(false); });
    return controller;
  }, [cabinetId, cabinets.length, cabinetsError, cabinetsLoading, ready]);

  useEffect(() => {
    const controller = load();
    return () => controller?.abort();
  }, [load, retryKey]);

  const reorderRows = useMemo(() => {
    const needKey = `need${horizon}` as "need30" | "need45" | "need60";
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return (data?.data?.skus ?? []).map((row) => ({ ...row, need: minBatch > 0 ? Math.ceil(row[needKey] / minBatch) * minBatch : row[needKey] })).filter((row) => row.need > 0 && (!needle || `${row.nmId} ${row.article}`.toLocaleLowerCase("ru-RU").includes(needle))).sort((a, b) => b.need - a.need);
  }, [data?.data?.skus, horizon, minBatch, query]);

  const tabs: [Tab, string][] = [["orders", "Заказы фабрике"], ["distribution", "Распределение"], ["reorder", "К поставке"], ["stock", "Остатки"], ["receiving", "Приёмка"], ["source", "Источник"]];

  return (
    <div className="min-h-[calc(100vh-54px)] bg-[#f6f7f9] pb-16 md:pb-5">
      <WbModuleHeader
        icon={Truck}
        title="Поставки"
        description={data ? `${data.skus.length} SKU · ${data.warehouses.length} складов · мин. партия ${minBatch} шт` : "Потребность, склады, ограничения и приёмка"}
        actions={
          <>
            <button type="button" onClick={() => setRetryKey((value) => value + 1)} disabled={loading} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-[11px] font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-60 sm:min-h-8">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Boxes className="h-3.5 w-3.5" />} Загрузить остатки WB</button>
            <button type="button" onClick={() => setTab("source")} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-500 px-3 text-[11px] font-semibold text-white shadow-sm hover:bg-violet-600 sm:min-h-8"><PackageCheck className="h-3.5 w-3.5" /> Источник готовой тары</button>
            <button type="button" onClick={() => setTab("distribution")} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-[11px] font-semibold text-white shadow-sm hover:bg-amber-600 sm:min-h-8"><ShieldCheck className="h-3.5 w-3.5" /> Ограничения складов</button>
          </>
        }
      />

      <div className="space-y-3 px-2 py-3 sm:px-6">
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 xl:flex-row xl:items-center">
          <div className={`min-w-0 flex-1 flex-col gap-2 sm:flex-row ${tab === "reorder" ? "flex" : "hidden"}`}>
            <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-violet-400 sm:max-w-sm sm:min-h-9"><Search className="h-3.5 w-3.5 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="артикул или ШК" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label>
            <label className="flex min-h-11 items-center gap-2 text-xs text-slate-500 sm:min-h-9">Мин. партия<input type="number" min={0} step={10} value={minBatch} onChange={(event) => setMinBatch(Math.max(0, Number(event.target.value) || 0))} className="h-9 w-20 rounded-lg border border-slate-200 px-2 text-right text-xs tabular-nums outline-none focus:border-violet-400" />шт</label>
            {tab === "reorder" ? <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">{([30, 45, 60] as const).map((value) => <button key={value} type="button" onClick={() => setHorizon(value)} className={`min-h-10 rounded-md px-3 text-[10px] font-semibold sm:min-h-8 ${horizon === value ? "bg-white text-violet-700 shadow-sm" : "text-slate-500"}`}>{value} дней</button>)}</div> : null}
          </div>
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-slate-100 p-0.5">{tabs.map(([value, label]) => <button key={value} type="button" onClick={() => setTab(value)} className={`min-h-10 shrink-0 rounded-md px-3 text-[10px] font-semibold sm:min-h-8 ${tab === value ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{label}</button>)}</div>
        </div>

        {loading ? <div className="rounded-xl border border-slate-200 bg-white p-3"><LoadingBanner seconds={elapsed} hint={`поставки · ${activeCabinet?.name ?? "все кабинеты"}`} /><SkeletonTableRows rows={10} cols={10} /></div> : error ? <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} /> : !data?.data ? <WbEmptyState>Данные поставок ещё не синхронизированы.</WbEmptyState> : tab === "orders" ? (canWrite ? <WbPurchaseOrdersTab skus={data.data.skus} cabinetId={cabinetId} canWrite={canWrite} /> : <WbEmptyState>Заказы фабрике ведутся по одному реальному кабинету. Выберите кабинет в верхней панели.</WbEmptyState>) : tab === "distribution" ? <WbSupplyDistributionPlanner cabinetId={cabinetId} cabinetName={activeCabinet?.name ?? "all"} canWrite={canWrite} recommendedWarehouses={data.warehouses} skus={data.skus} defaultMinBatch={data.threshold ?? 30} defaultPalletLiters={data.pallet_liters ?? 1230} volumeKnown={data.vol_known ?? 0} volumeTotal={data.vol_total ?? data.skus.length} /> : tab === "reorder" ? (
          reorderRows.length === 0 ? <WbEmptyState>Дозаказывать нечего — остатков хватает на выбранный горизонт.</WbEmptyState> : <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="min-w-[760px] w-full border-collapse text-[10px]"><thead><tr className="h-9 bg-slate-50 text-slate-500"><th className="px-3 text-left">Артикул</th><th className="px-3 text-right">Заказы/день</th><th className="px-3 text-right">Остаток</th><th className="px-3 text-right">В пути</th><th className="px-3 text-right">Хватит дней</th><th className="px-3 text-right">К поставке ({horizon}д)</th></tr></thead><tbody>{reorderRows.map((row) => <tr key={row.nmId} className="h-10 border-t border-slate-100"><td className="px-3"><div className="font-semibold text-violet-700">{row.article || row.nmId}</div><div className="text-[9px] text-slate-400">nm {row.nmId}</div></td><td className="px-3 text-right tabular-nums">{row.avgDaily.toFixed(1)}</td><td className="px-3 text-right tabular-nums">{format(row.stock)}</td><td className="px-3 text-right tabular-nums">{format(row.inWay)}</td><td className={`px-3 text-right tabular-nums ${row.daysLeft != null && row.daysLeft <= 14 ? "font-semibold text-rose-600" : ""}`}>{row.daysLeft ?? "∞"}</td><td className="px-3 text-right font-semibold tabular-nums text-violet-700">{format(row.need)}</td></tr>)}</tbody></table></div>
        ) : tab === "stock" ? <StockCatalogTab rows={data.data.catalog} /> : tab === "receiving" ? (canWrite ? <ReceivingTab skus={data.data.skus} cabId={cabinetId} warehouses={data.data.warehouses} /> : <WbEmptyState>Приёмка ведётся по одному реальному кабинету. Выберите кабинет в верхней панели.</WbEmptyState>) : <MoySkladSourceTab />}
      </div>
    </div>
  );
}
