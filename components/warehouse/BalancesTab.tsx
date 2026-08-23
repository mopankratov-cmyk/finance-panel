"use client";

import { useCallback, useEffect, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import type { StockBalancesResponse } from "@/app/api/warehouse/balances/route";

const money = (value: number) => `${formatNumber(Math.round(value))} ₽`;

export function BalancesTab({ entityId, refreshKey }: { entityId: string; refreshKey: number }) {
  const [data, setData] = useState<StockBalancesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Считаю остаток по движениям…</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return null;

  if (data.rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm font-medium text-slate-700">Остатка пока нет</p>
        <p className="mt-1 text-sm text-slate-400">
          Остаток появляется, когда приёмка проведена на склад: до этого товар только числится приехавшим.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-400">Всего на своих складах</p>
          <p className="text-xl font-bold text-slate-900">{formatNumber(data.totals.qty)}</p>
          <p className="mt-1 text-xs text-slate-400">{data.totals.skuCount} SKU</p>
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
              <th className="px-4 py-3 text-left font-medium">Артикул</th>
              <th className="px-4 py-3 text-left font-medium">nmID</th>
              <th className="px-4 py-3 text-left font-medium">Склад</th>
              <th className="px-4 py-3 text-right font-medium">Остаток</th>
              <th className="px-4 py-3 text-right font-medium">Себес., ₽/шт</th>
              <th className="px-4 py-3 text-right font-medium">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={`${row.warehouseId}-${row.nmId}`} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2.5 font-medium text-slate-900">{row.article || "—"}</td>
                <td className="px-4 py-2.5 text-slate-500">{row.nmId}</td>
                <td className="px-4 py-2.5 text-slate-600">
                  {row.warehouseName}
                  {row.warehouseKind === "fulfillment" && (
                    <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">ФФ</span>
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
