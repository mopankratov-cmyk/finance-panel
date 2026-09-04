"use client";

import { Printer, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import type { StockDocRow, StockDocsResponse } from "@/app/api/warehouse/docs/route";

const KIND_LABEL: Record<StockDocRow["kind"], string> = {
  shipment: "Отгрузка",
  transfer: "Перемещение",
  writeoff: "Списание",
  return: "Возврат",
  receipt: "Приёмка",
  adjustment: "Коррекция прихода",
};

const stamp = (value: string) =>
  new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

export function DocsTab({ entityId, refreshKey, onChanged }: { entityId: string; refreshKey: number; onChanged: () => void }) {
  const [data, setData] = useState<StockDocsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/docs?entity=${entityId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить документы");
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить документы");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const reverse = async (row: StockDocRow) => {
    // Спрашиваем подтверждение: сторно пишет в регистр новые движения, и отменить
    // само сторно можно будет только ещё одним сторно.
    if (!window.confirm(`Отменить ${row.number}? Товар вернётся в остаток, документ останется в журнале с пометкой.`)) return;
    setBusy(row.id);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/warehouse/docs/${row.id}/reverse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось сторнировать");
      setDone(`${formatNumber(json.data.qty)} шт вернулись в остаток · ${json.data.number} отменяет ${json.data.reverses}`);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сторнировать");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Загружаю документы…</div>;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {done && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{done}</div>}

      {!data || data.rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">Документов пока нет</p>
          <p className="mt-1 text-sm text-slate-400">Номер появляется при первом же проведении.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 text-left font-medium">Номер</th>
                <th className="px-4 py-3 text-left font-medium">Что</th>
                <th className="px-4 py-3 text-left font-medium">Когда</th>
                <th className="px-4 py-3 text-left font-medium">Склад</th>
                <th className="px-4 py-3 text-right font-medium">Позиций</th>
                <th className="px-4 py-3 text-right font-medium">Кол-во</th>
                <th className="px-4 py-3 text-right font-medium">Сумма</th>
                <th className="px-4 py-3 text-left font-medium">Кто</th>
                <th className="px-4 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id} className={`border-b border-slate-100 last:border-0 ${row.status === "reversed" ? "bg-slate-50/60" : ""}`}>
                  <td className="px-4 py-2.5 font-medium text-slate-900">
                    {row.number}
                    {row.reversesNumber && (
                      <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">отменяет {row.reversesNumber}</span>
                    )}
                    {row.reversedByNumber && (
                      <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">отменён {row.reversedByNumber}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{KIND_LABEL[row.kind]}</td>
                  <td className="px-4 py-2.5 text-slate-500">{stamp(row.occurredAt)}</td>
                  <td className="px-4 py-2.5 text-slate-600">
                    {row.warehouseName ?? "—"}
                    {row.targetWarehouseName && <span className="text-slate-400"> → {row.targetWarehouseName}</span>}
                    {row.cabinetName && <span className="text-slate-400"> → {row.cabinetName}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-600">{row.lines || "—"}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-slate-900">{formatNumber(row.qty)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600">
                    {row.amount ? `${formatNumber(Math.round(row.amount))} ₽` : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{row.createdBy ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <a
                      href={`/warehouse/print/${row.id}`}
                      target="_blank"
                      rel="noreferrer"
                      title="Печатная форма: бумага под подпись для фулфилмента"
                      className="mr-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-violet-600"
                    >
                      <Printer className="h-3.5 w-3.5" /> Печать
                    </a>
                    {row.status === "posted" && !row.reversedByNumber && (
                      <button
                        onClick={() => void reverse(row)}
                        disabled={busy === row.id}
                        title="Вернуть товар в остаток и пометить документ отменённым"
                        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {busy === row.id ? "Отменяю…" : "Отменить"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.truncated && (
        <p className="text-xs text-amber-600">Показаны последние 100 документов — журнал длиннее.</p>
      )}
    </div>
  );
}
