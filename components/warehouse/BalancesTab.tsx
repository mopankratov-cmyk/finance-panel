"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import type { StockBalancesResponse } from "@/app/api/warehouse/balances/route";
import { WbProductImage } from "@/components/wb/WbProductImage";
import { variantLabel } from "@/lib/warehouse/variantLabel";
import type { FbsSalesResult } from "@/app/api/warehouse/fbs-sales/route";

const money = (value: number) => `${formatNumber(Math.round(value))} ₽`;

export function BalancesTab({ entityId, refreshKey }: { entityId: string; refreshKey: number }) {
  const [data, setData] = useState<StockBalancesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [sales, setSales] = useState<FbsSalesResult | null>(null);
  const [salesError, setSalesError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/balances?entity=${entityId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить остатки");
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить остатки");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  // Продажи FBS — единственное движение, которое приходит не от человека, а от
  // маркетплейса: товар лежит на фулфилменте и уезжает оттуда покупателю без
  // нашего участия. Пока их не списать, остаток на ФФ не уменьшается никогда.
  const syncSales = async () => {
    setSyncing(true);
    setSalesError(null);
    setSales(null);
    try {
      const res = await fetch("/api/warehouse/fbs-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось списать продажи");
      setSales(json.data as FbsSalesResult);
      await load();
    } catch (e) {
      setSalesError(e instanceof Error ? e.message : "Не удалось списать продажи");
    } finally {
      setSyncing(false);
    }
  };

  const salesPanel = (
    <>
      {salesError && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{salesError}</div>}
      {sales && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {sales.warehouses.map((row) => (
            <p key={row.warehouseId}>
              <span className="font-medium">{row.warehouseName}</span>: списано {formatNumber(row.written)}
              {row.skipped > 0 ? `, уже были списаны ${formatNumber(row.skipped)}` : ""}
              {row.negative > 0 ? `, из них ${formatNumber(row.negative)} при нехватке остатка` : ""}
            </p>
          ))}
          <p className="mt-1 text-xs text-emerald-700">
            Прочитано заказов FBS: {formatNumber(sales.scanned)}
            {sales.otherEntity > 0 ? ` · ${formatNumber(sales.otherEntity)} чужих юрлиц` : ""}
          </p>
          {sales.unresolved.length > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              Не опознан размер: {sales.unresolved.map((row) => `${row.article} (${row.count})`).join(", ")}.
              Импортируйте размеры из карточек WB на вкладке «Товары».
            </p>
          )}
        </div>
      )}
    </>
  );

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Считаю остаток по движениям…</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  if (data.rows.length === 0) {
    return (
      <div className="space-y-4">
        {salesPanel}
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">Остатка пока нет</p>
          <p className="mt-1 text-sm text-slate-400">
            Остаток появляется, когда приёмка проведена на склад: до этого товар только числится приехавшим.
          </p>
          <button
            onClick={() => void syncSales()}
            disabled={syncing}
            className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {syncing ? "Списываю продажи…" : "Списать продажи FBS"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          Остаток свёрнут из движений регистра: приёмки, отгрузки, перемещения, списания и продажи FBS.
        </p>
        <button
          onClick={() => void syncSales()}
          disabled={syncing}
          title="Вычесть из остатка продажи со склада продавца. Включается по складу и дате на вкладке «Склады»."
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Списываю продажи…" : "Списать продажи FBS"}
        </button>
      </div>

      {salesPanel}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Всего в остатке</p>
          <p className="text-xl font-bold text-slate-900">{formatNumber(data.totals.qty)}</p>
          <p className="mt-1 text-xs text-slate-400">{data.totals.skuCount} позиций · все склады, включая ФФ и «в пути»</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Деньги в товаре</p>
          <p className="text-xl font-bold text-violet-700">{money(data.totals.amount)}</p>
          <p className="mt-1 text-xs text-slate-400">по себестоимости приёмок</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-xs text-slate-400">По складам</p>
          <div className="space-y-1">
            {data.warehouses.filter((w) => w.qty !== 0).map((w) => (
              <div key={w.id} className="flex justify-between text-sm">
                <span className="truncate text-slate-600">{w.name}</span>
                <span className="font-medium text-slate-900">{formatNumber(w.qty)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 text-left font-medium"></th>
              <th className="px-4 py-3 text-left font-medium">Артикул</th>
              <th className="px-4 py-3 text-left font-medium">Размер</th>
              <th className="px-4 py-3 text-left font-medium">nmID</th>
              <th className="px-4 py-3 text-left font-medium">Склад</th>
              <th className="px-4 py-3 text-right font-medium">Остаток</th>
              <th className="px-4 py-3 text-right font-medium">Себес., ₽/шт</th>
              <th className="px-4 py-3 text-right font-medium">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={`${row.warehouseId}-${row.variantId}`} className="border-b border-slate-100 last:border-0">
                <td className="py-2 pl-4 pr-0">
                  <WbProductImage
                    nm={row.nmId ?? undefined}
                    src={row.photoUrl ?? undefined}
                    alt={row.article}
                    className="h-10 w-10 rounded-lg border border-slate-100 bg-slate-50 object-cover"
                  />
                </td>
                <td className="px-4 py-2.5 font-medium text-slate-900">{row.article || "—"}</td>
                <td className="px-4 py-2.5 text-slate-600">
                  {row.sizeLabel
                    ? <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">{row.sizeLabel}</span>
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-2.5 text-slate-500">{row.nmId}</td>
                <td className="px-4 py-2.5 text-slate-600">
                  {row.warehouseName}
                  {row.warehouseKind === "fulfillment" && (
                    <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">ФФ</span>
                  )}
                  {row.warehouseKind === "transit" && (
                    <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">в пути</span>
                  )}
                </td>
                <td className={`px-4 py-2.5 text-right font-semibold ${row.qty < 0 ? "text-red-600" : "text-slate-900"}`}>
                  {formatNumber(row.qty)}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-600">
                  {row.unitCost > 0 ? row.unitCost.toFixed(2) : <span className="text-slate-300">нет</span>}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-700">{money(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Остаток — сумма движений регистра, а не отдельно хранимое число. Себестоимость — взвешенное среднее
        по проведённым приёмкам. Остаток маркетплейса живёт отдельно: он в разделе «Закупки».
      </p>
    </div>
  );
}
