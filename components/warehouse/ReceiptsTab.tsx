"use client";

import { useCallback, useEffect, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import type { ReceiptBatchRow } from "@/app/api/warehouse/receipts/route";
import type { WarehouseRow } from "@/app/api/warehouse/warehouses/route";
import type { LegalEntityRow } from "@/lib/warehouse/entityAccess";

const STATE_LABEL: Record<ReceiptBatchRow["state"], { text: string; className: string }> = {
  expected: { text: "ждём", className: "bg-slate-100 text-slate-600" },
  received: { text: "принято, не в остатке", className: "bg-amber-100 text-amber-800" },
  posted: { text: "в остатке", className: "bg-emerald-100 text-emerald-700" },
};

const date = (value: string | null) => (value ? new Date(value).toLocaleDateString("ru-RU") : "—");

export function ReceiptsTab({
  entityId,
  entity,
  warehouses,
  refreshKey,
  onPosted,
}: {
  entityId: string;
  entity: LegalEntityRow | null;
  warehouses: WarehouseRow[];
  refreshKey: number;
  onPosted: () => void;
}) {
  const [rows, setRows] = useState<ReceiptBatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [target, setTarget] = useState<string>(warehouses[0]?.id ?? "");

  useEffect(() => {
    if (!target && warehouses.length > 0) setTarget(warehouses[0].id);
  }, [warehouses, target]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/receipts?entity=${entityId}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить приёмки");
      setRows(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить приёмки");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const post = async (batchId: string) => {
    if (!target) { setError("Выберите склад, на который приходуем"); return; }
    setBusy(batchId);
    setError(null);
    try {
      const res = await fetch("/api/warehouse/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, batchId, warehouseId: target }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось провести приёмку");
      await load();
      onPosted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось провести приёмку");
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Загружаю приёмки…</div>;

  const pending = rows.filter((row) => row.state === "received");

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <span className="text-sm text-slate-500">Приходуем на склад</span>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
        >
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}{warehouse.kind === "fulfillment" ? " · ФФ" : ""}
            </option>
          ))}
        </select>
        {pending.length > 0 && (
          <span className="text-sm text-amber-700">
            {pending.length} {pending.length === 1 ? "партия ждёт" : "партий ждут"} проведения
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">Приёмок ещё не было</p>
          <p className="mt-1 text-sm text-slate-400">
            {entity && entity.cabinets.filter((link) => link.relation === "own").length === 0
              ? `У юрлица «${entity.name}» нет собственных кабинетов — приёмки заводить не в чем.`
              : "Партии приходят сюда из заказа фабрике — либо заводятся вручную во вкладке «Приёмка» раздела «Закупки»."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 text-left font-medium">Ждали</th>
                <th className="px-4 py-3 text-left font-medium">Состояние</th>
                <th className="px-4 py-3 text-left font-medium">Позиций</th>
                <th className="px-4 py-3 text-right font-medium">Ждали / приняли</th>
                <th className="px-4 py-3 text-right font-medium">Себестоимость</th>
                <th className="px-4 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const state = STATE_LABEL[row.state];
                const short = row.receivedQty < row.expectedQty && row.state !== "expected";
                return (
                  <tr key={row.batchId} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3">
                      <div className="text-slate-900">{date(row.expectedAt)}</div>
                      {row.note && <div className="mt-0.5 max-w-xs truncate text-xs text-slate-400">{row.note}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${state.className}`}>{state.text}</span>
                      {row.postedAt && <div className="mt-0.5 text-xs text-slate-400">{date(row.postedAt)}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.lineCount}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-slate-500">{formatNumber(row.expectedQty)}</span>
                      <span className="mx-1 text-slate-300">/</span>
                      <span className={`font-semibold ${short ? "text-amber-600" : "text-slate-900"}`}>
                        {formatNumber(row.receivedQty)}
                      </span>
                      {short && <div className="text-xs text-amber-600">недовоз {formatNumber(row.expectedQty - row.receivedQty)}</div>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.cost ? (
                        <>
                          <div className="font-medium text-slate-900">{formatNumber(Math.round(row.cost.total))} ₽</div>
                          <div className="text-xs text-slate-400">{row.cost.unit.toFixed(2)} ₽/шт</div>
                          {row.cost.basis === "estimated" && (
                            <div className="mt-0.5 text-xs text-amber-600" title={row.cost.note ?? undefined}>
                              ≈ расчётная
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.state === "received" && (
                        <button
                          onClick={() => void post(row.batchId)}
                          disabled={busy === row.batchId || !target}
                          className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                        >
                          {busy === row.batchId ? "Провожу…" : "Оприходовать"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Себестоимость партии считается из заказа фабрике: товар по цене позиций, курс, логистика и прочие расходы,
        разнесённые по стоимости строк. Пометка «≈ расчётная» означает, что часть данных не нашлась — наведите
        курсор, чтобы увидеть, какая именно.
      </p>
    </div>
  );
}
