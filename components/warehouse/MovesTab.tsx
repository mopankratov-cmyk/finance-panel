"use client";

import { useCallback, useEffect, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import type { StockMoveRow } from "@/app/api/warehouse/moves/route";
import { WbProductImage } from "@/components/wb/WbProductImage";

const KIND_LABEL: Record<StockMoveRow["kind"], string> = {
  receipt: "приёмка",
  shipment: "отгрузка",
  writeoff: "списание",
  return: "возврат",
  adjustment: "корректировка",
  transfer: "перемещение",
};

const stamp = (value: string) =>
  new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

export function MovesTab({ entityId, refreshKey }: { entityId: string; refreshKey: number }) {
  const [rows, setRows] = useState<StockMoveRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/moves?entity=${entityId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить движения");
      setRows(json.data?.rows ?? []);
      setTruncated(Boolean(json.data?.truncated));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить движения");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Загружаю журнал…</div>;
  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm font-medium text-slate-700">Журнал пуст</p>
        <p className="mt-1 text-sm text-slate-400">Первая запись появится, когда проведёте приёмку.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 text-left font-medium">Когда</th>
              <th className="px-4 py-3 text-left font-medium">Что</th>
              <th className="px-4 py-3 text-left font-medium"></th>
              <th className="px-4 py-3 text-left font-medium">Артикул</th>
              <th className="px-4 py-3 text-left font-medium">Склад</th>
              <th className="px-4 py-3 text-right font-medium">Кол-во</th>
              <th className="px-4 py-3 text-right font-medium">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2.5 text-slate-500">{stamp(row.occurredAt)}</td>
                <td className="px-4 py-2.5 text-slate-700">{KIND_LABEL[row.kind]}</td>
                <td className="py-2 pl-4 pr-0">
                  <WbProductImage
                    nm={row.nmId ?? undefined}
                    alt={row.article}
                    className="h-9 w-9 rounded-lg border border-slate-100 bg-slate-50 object-cover"
                  />
                </td>
                <td className="px-4 py-2.5 font-medium text-slate-900">{row.article || row.nmId}</td>
                <td className="px-4 py-2.5 text-slate-600">{row.warehouseName}</td>
                <td className={`px-4 py-2.5 text-right font-semibold ${row.qty > 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {row.qty > 0 ? "+" : ""}{formatNumber(row.qty)}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-600">
                  {row.amount === 0 ? <span className="text-slate-300">—</span> : `${formatNumber(Math.round(row.amount))} ₽`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && (
        <p className="text-xs text-amber-600">
          Показаны последние 200 движений — журнал длиннее. Фильтры по SKU и складу добавим, когда журнал вырастет.
        </p>
      )}
      <p className="text-xs text-slate-400">
        Записи не редактируются и не удаляются: ошибку исправляют обратным движением, иначе остаток перестаёт
        быть суммой журнала.
      </p>
    </div>
  );
}
