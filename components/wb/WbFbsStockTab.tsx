"use client";

import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalyticsTable, type Column } from "@/components/analytics/AnalyticsTable";
import { LoadingBanner, SkeletonTableRows, useElapsedSeconds } from "@/components/ui/LoadingState";
import type { FbsStockResponse, FbsStockRow } from "@/app/api/supplies/fbs-stock/route";
import { WbEmptyState, WbErrorState } from "./WbModuleHeader";

const fmt = (value: number) => value.toLocaleString("ru-RU");

// Порог подсветки — соглашение этого экрана, а не признак от WB: остаток
// в 3 штуки и меньше видно сразу, чтобы размер не кончился незаметно.
// Подпись под таблицей объясняет это вслух, чтобы цвет не читался как факт WB.
const LOW_STOCK_THRESHOLD = 3;

const columns: Column<FbsStockRow>[] = [
  { key: "barcode", label: "Баркод", render: (row) => <span className="font-mono text-[11px] text-slate-600">{row.barcode}</span>, csv: (row) => row.barcode },
  {
    key: "article",
    label: "Артикул",
    render: (row) => (
      <div>
        <div className="font-semibold text-violet-700">{row.article || row.nmId}</div>
        <div className="text-[11px] tabular-nums text-slate-400">nm {row.nmId}</div>
      </div>
    ),
    csv: (row) => row.article || String(row.nmId),
  },
  { key: "size", label: "Размер", render: (row) => <span className="text-slate-600">{row.size || "—"}</span>, csv: (row) => row.size },
  { key: "brand", label: "Бренд", render: (row) => <span className="text-slate-600">{row.brand || "—"}</span>, csv: (row) => row.brand },
  {
    key: "amount",
    label: "Остаток",
    align: "right",
    sortable: true,
    render: (row) => <span className={`tabular-nums font-semibold ${row.amount <= LOW_STOCK_THRESHOLD ? "text-rose-600" : "text-slate-700"}`}>{fmt(row.amount)}</span>,
    csv: (row) => String(row.amount),
  },
];

export function WbFbsStockTab({ cabinetId, cabinetName }: { cabinetId: string; cabinetName?: string }) {
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<FbsStockResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const requestId = useRef(0);
  const elapsed = useElapsedSeconds(loading);
  const singleCabinet = Boolean(cabinetId) && cabinetId !== "all" && !cabinetId.startsWith("group:");

  const load = useCallback(() => {
    if (!singleCabinet) {
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    const warehouseQuery = warehouseId === null ? "" : `&warehouse=${warehouseId}`;
    fetch(`/api/supplies/fbs-stock?cabinet=${encodeURIComponent(cabinetId)}${warehouseQuery}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as FbsStockResponse;
        if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
        return body;
      })
      .then((body) => { if (current === requestId.current) setData(body); })
      .catch((cause: unknown) => { if (current === requestId.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить остатки FBS"); })
      .finally(() => { if (current === requestId.current) setLoading(false); });
    return controller;
  }, [cabinetId, singleCabinet, warehouseId]);

  useEffect(() => {
    const controller = load();
    return () => controller?.abort();
  }, [load, retryKey]);

  const rows = useMemo(() => {
    const all = data?.data?.rows ?? [];
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    if (!needle) return all;
    return all.filter((row) => `${row.barcode} ${row.article} ${row.nmId} ${row.brand} ${row.size}`.toLocaleLowerCase("ru-RU").includes(needle));
  }, [data?.data?.rows, query]);

  if (!singleCabinet) {
    return <WbEmptyState>Остатки своего склада читаются по одному реальному кабинету. Выберите кабинет в верхней панели.</WbEmptyState>;
  }
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <LoadingBanner seconds={elapsed} hint={`остатки FBS · ${cabinetName ?? "кабинет"}`} />
        <SkeletonTableRows rows={8} cols={5} />
      </div>
    );
  }
  if (error) return <WbErrorState message={error} onRetry={() => setRetryKey((value) => value + 1)} />;
  if (!data?.data) return <WbEmptyState>Остатков на своём складе нет.</WbEmptyState>;

  const { warehouses, totalAmount, skuChecked, zeroSkus, warehouseName, catalogReady } = data.data;
  const warnings = data.meta.warnings;
  // Время среза: вкладка остаётся смонтированной при переключении, поэтому
  // без этой строки старые данные выглядели бы только что загруженными.
  const snapshotAt = data.meta.generatedAt ? new Date(data.meta.generatedAt).toLocaleString("ru-RU") : null;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="text-sm font-semibold text-slate-800">Остатки на вашем складе (FBS)</div>
        {snapshotAt ? <div className="mt-0.5 text-[11px] text-slate-400">Данные на {snapshotAt}</div> : null}
        <div className="mt-0.5 text-[11px] text-slate-500">
          WB отдаёт остаток склада продавца только по списку баркодов — баркоды берутся из карточек кабинета. Позиции с нулём в таблицу не попадают.
        </div>
        <div className="mt-2 flex flex-col gap-2 xl:flex-row xl:items-center">
          <label className="flex min-h-11 items-center gap-2 text-[11px] text-slate-500 lg:min-h-9">
            Склад
            {/* Показываем склад, который реально ответил WB, а не локальный выбор:
                при неизвестном id роут берёт первый склад и говорит об этом
                предупреждением — молчаливой подмены здесь быть не должно. */}
            <select
              value={data.data.warehouseId ?? ""}
              onChange={(event) => setWarehouseId(Number(event.target.value) || null)}
              className="min-h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-violet-400"
            >
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
              ))}
            </select>
          </label>
          <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-violet-400 sm:max-w-sm lg:min-h-9">
            <Search className="h-3.5 w-3.5 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="баркод, артикул или бренд" className="min-w-0 flex-1 bg-transparent text-xs outline-none" />
          </label>
        </div>
      </div>

      {warnings.length ? (
        <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          {warnings.map((warning) => <li key={warning}>· {warning}</li>)}
        </ul>
      ) : null}

      {!catalogReady ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-[13px] text-slate-600">
          <div className="font-semibold text-slate-700">Справочник баркодов кабинета ещё не собран</div>
          <div className="mt-1">
            WB отдаёт остаток своего склада только по списку баркодов. Список собирается фоновым обходом карточек кабинета —
            пока его нет, показывать таблицу нечестно: пустая выглядела бы как «на складе ничего нет».
          </div>
          <button
            type="button"
            onClick={() => setRetryKey((value) => value + 1)}
            className="mt-3 min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:border-violet-300 hover:text-violet-700"
          >
            Проверить снова
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">Склад</div>
              <div className="mt-1 truncate text-sm font-semibold text-slate-700" title={warehouseName}>{warehouseName || "—"}</div>
              <div className="mt-0.5 text-[11px] text-slate-400">складов в кабинете: {fmt(warehouses.length)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">Единиц на складе</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-slate-700">{fmt(totalAmount)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">Баркодов с остатком</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-violet-700">{fmt(data.data.rows.length)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-[11px] text-slate-500">Спрошено баркодов</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-slate-700">{fmt(skuChecked)}</div>
              <div className="mt-0.5 text-[11px] text-slate-400">из них с нулём: {fmt(zeroSkus)}</div>
            </div>
          </div>

          <AnalyticsTable
            columns={columns}
            data={rows}
            filename={`wb-fbs-stock-${cabinetName ?? cabinetId}-${new Date().toISOString().slice(0, 10)}.csv`}
            emptyMessage="На этом складе остатков нет."
          />

          <div className="text-[11px] text-slate-400">
            Красным подсвечен остаток {LOW_STOCK_THRESHOLD} шт и меньше — это порог самого экрана для быстрого поиска
            заканчивающихся размеров, WB такого признака не отдаёт.
          </div>
        </>
      )}
    </div>
  );
}
