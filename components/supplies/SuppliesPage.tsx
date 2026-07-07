"use client";

import { RefreshCw, Warehouse } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnalyticsTable, type Column } from "@/components/analytics/AnalyticsTable";
import { formatNumber } from "@/lib/analytics/format";
import { CabinetSwitcher } from "@/components/CabinetSwitcher";
import { useActiveCabinet } from "@/lib/useActiveCabinet";
import { LoadingBanner, SkeletonKpiRow, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import { StockCatalogTab } from "@/components/supplies/StockCatalogTab";
import { ReceivingTab } from "@/components/supplies/ReceivingTab";
import { MoySkladSourceTab } from "@/components/supplies/MoySkladSourceTab";
import { Tour, TourReplayButton, type TourStep } from "@/components/ui/Tour";
import type { SupplyRow, WarehouseSummary, StockCatalogRow } from "@/app/api/supplies/route";

type Tab = "reorder" | "stock" | "receiving" | "source";

type Horizon = 30 | 45 | 60;

function daysColor(d: number | null): string {
  if (d === null) return "text-slate-400";
  if (d <= 14) return "text-red-600";
  if (d <= 30) return "text-amber-500";
  return "text-emerald-600";
}

export function SuppliesPage() {
  const [tab, setTab] = useState<Tab>("reorder");
  const [skus, setSkus] = useState<SupplyRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseSummary[]>([]);
  const [catalog, setCatalog] = useState<StockCatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<Horizon>(45);
  const [minBatch, setMinBatch] = useState<number>(0);
  const [cabId, setCabId, cabReady] = useActiveCabinet("wb");
  const elapsed = useElapsedSeconds(loading);

  const load = useCallback(async () => {
    if (!cabReady) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/supplies${cabId ? `?cabinet=${cabId}` : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) setError(json.error);
      else {
        setSkus(json.data?.skus ?? []);
        setWarehouses(json.data?.warehouses ?? []);
        setCatalog(json.data?.catalog ?? []);
      }
    } catch {
      setError("Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [cabId, cabReady]);

  useEffect(() => {
    load();
  }, [load]);

  const needKey = `need${horizon}` as const;
  const rows = useMemo(() => {
    // показываем только то, что нужно заказывать, с учётом мин. партии
    return skus
      .map((r) => ({ ...r, need: Math[minBatch > 0 ? "ceil" : "round"](r[needKey] / (minBatch || 1)) * (minBatch || 1) }))
      .filter((r) => r.need > 0)
      .sort((a, b) => b.need - a.need);
  }, [skus, needKey, minBatch]);

  type Row = SupplyRow & { need: number };

  const totalNeed = rows.reduce((s, r) => s + r.need, 0);
  const totalStock = warehouses.reduce((s, w) => s + w.quantity, 0);
  const totalInWay = warehouses.reduce((s, w) => s + w.inWay, 0);

  const columns: Column<Row>[] = [
    { key: "article", label: "Артикул", render: (r) => (
      <div>
        <p className="font-medium text-slate-900">{r.article || "—"}</p>
        <p className="text-xs text-slate-400">{r.nmId}</p>
      </div>
    ), csv: (r) => r.article || String(r.nmId) },
    { key: "avgDaily", label: "Заказы/день", align: "right", render: (r) => r.avgDaily.toFixed(1), csv: (r) => r.avgDaily.toFixed(2) },
    { key: "stock", label: "Остаток", align: "right", render: (r) => formatNumber(r.stock), csv: (r) => String(r.stock) },
    { key: "inWay", label: "В пути", align: "right", render: (r) => formatNumber(r.inWay), csv: (r) => String(r.inWay) },
    { key: "daysLeft", label: "Хватит дней", align: "right", render: (r) => (
      <span className={daysColor(r.daysLeft)}>{r.daysLeft ?? "∞"}</span>
    ), csv: (r) => (r.daysLeft != null ? String(r.daysLeft) : "") },
    { key: "need", label: `К поставке (${horizon}д)`, align: "right", render: (r) => (
      <span className="font-semibold text-violet-700">{formatNumber(r.need)}</span>
    ), csv: (r) => String(r.need) },
  ];

  const tourSteps: TourStep[] = [
    { selector: '[data-tour="supplies-tabs"]', title: "4 раздела Закупок", text: "«К поставке» — сколько дозаказать по темпу продаж, «Остатки» — полный каталог по складам, «Приёмка» — учёт поступивших партий, «Источник» — подключение МойСклад." },
    { selector: '[data-tour="supplies-cabinet"]', title: "Кабинет", text: "Переключай юрлицо здесь — вся вкладка пересчитается под него. Можно выбрать и объединённую группу кабинетов, если она создана на /cabinets." },
    ...(tab === "reorder" ? [{ selector: '[data-tour="supplies-kpi"]', title: "Сводка", text: "Быстрый обзор: сколько всего на складах, что нужно дозаказать и куда." }] : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Закупки</h1>
          <p className="text-sm text-slate-400 mt-1">Потребность к поставке по темпу заказов</p>
        </div>
        <div className="flex items-center gap-2">
        <TourReplayButton tourId="supplies" />
        <div data-tour="supplies-cabinet">
          <CabinetSwitcher mp="wb" accent="violet" onChange={setCabId} />
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Обновить
        </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {/* Таб-бар */}
      <div data-tour="supplies-tabs" className="flex gap-1 rounded-lg bg-slate-100 p-1 w-fit">
        {([["reorder", "К поставке"], ["stock", "Остатки"], ["receiving", "Приёмка"], ["source", "Источник"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              tab === key ? "bg-white text-slate-900 shadow-sm font-medium" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <>
          <SkeletonKpiRow count={4} />
          <LoadingBanner seconds={elapsed} hint="остатки WB по складам" />
          <SkeletonTableRows rows={8} cols={6} />
        </>
      ) : tab === "reorder" ? (
        <>
          {/* Сводка по складам */}
          <div data-tour="supplies-kpi" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-400">Всего на складах</p>
              <p className="text-xl font-bold text-slate-900">{formatNumber(totalStock)}</p>
              <p className="text-xs text-slate-400 mt-1">+{formatNumber(totalInWay)} в пути</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-400">К поставке ({horizon} дн)</p>
              <p className="text-xl font-bold text-violet-700">{formatNumber(totalNeed)}</p>
              <p className="text-xs text-slate-400 mt-1">{rows.length} SKU нужно дозаказать</p>
            </div>
            <div className="col-span-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-2 flex items-center gap-1.5 text-xs text-slate-400">
                <Warehouse className="h-3.5 w-3.5" /> Топ складов
              </p>
              <div className="space-y-1">
                {warehouses.slice(0, 4).map((w) => (
                  <div key={w.warehouse} className="flex justify-between text-sm">
                    <span className="text-slate-600 truncate">{w.warehouse}</span>
                    <span className="text-slate-900 font-medium">{formatNumber(w.quantity)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Управление */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1 w-fit">
              {([30, 45, 60] as const).map((h) => (
                <button
                  key={h}
                  onClick={() => setHorizon(h)}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    horizon === h ? "bg-white text-slate-900 shadow-sm font-medium" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {h} дней
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              Мин. партия
              <input
                type="number"
                min={0}
                value={minBatch}
                onChange={(e) => setMinBatch(Number(e.target.value))}
                className="w-20 rounded border border-slate-200 px-2 py-1 text-sm"
              />
            </label>
          </div>

          <AnalyticsTable
            columns={columns}
            data={rows}
            filename="supplies.csv"
            emptyMessage="Дозаказывать нечего — остатков хватает на выбранный горизонт."
          />
        </>
      ) : tab === "stock" ? (
        <StockCatalogTab rows={catalog} />
      ) : tab === "receiving" ? (
        <ReceivingTab skus={skus} cabId={cabId} warehouses={warehouses} />
      ) : (
        <MoySkladSourceTab />
      )}

      <Tour tourId="supplies" steps={tourSteps} />
    </div>
  );
}
