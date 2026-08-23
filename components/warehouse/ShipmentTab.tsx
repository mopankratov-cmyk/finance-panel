"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import type { StockBalancesResponse } from "@/app/api/warehouse/balances/route";
import type { WarehouseRow } from "@/app/api/warehouse/warehouses/route";
import type { LegalEntityRow } from "@/lib/warehouse/entityAccess";

interface CabinetOption {
  id: string;
  name: string;
  relation: "own" | "agent";
}

/** Ключ ячейки ввода: одна позиция может уехать в несколько кабинетов сразу. */
const cellKey = (productId: string, cabinetId: string) => `${productId}:${cabinetId}`;

export function ShipmentTab({
  entityId,
  entity,
  warehouses,
  refreshKey,
  onShipped,
}: {
  entityId: string;
  entity: LegalEntityRow | null;
  warehouses: WarehouseRow[];
  refreshKey: number;
  onShipped: () => void;
}) {
  const [balances, setBalances] = useState<StockBalancesResponse | null>(null);
  const [cabinets, setCabinets] = useState<CabinetOption[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>(warehouses[0]?.id ?? "");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!warehouseId && warehouses.length > 0) setWarehouseId(warehouses[0].id);
  }, [warehouses, warehouseId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [balancesRes, cabinetsRes] = await Promise.all([
        fetch(`/api/warehouse/balances?entity=${entityId}`, { cache: "no-store" }),
        fetch("/api/cabinets", { cache: "no-store" }),
      ]);
      const balancesJson = await balancesRes.json();
      if (!balancesRes.ok) throw new Error(balancesJson.error || "Не удалось загрузить остатки");
      setBalances(balancesJson.data);

      const cabinetsJson = await cabinetsRes.json();
      const known: { id: string; name: string }[] = cabinetsJson.data ?? cabinetsJson ?? [];
      const linked = entity?.cabinets ?? [];
      setCabinets(linked.map((link) => ({
        id: link.cabinetId,
        name: known.find((row) => row.id === link.cabinetId)?.name ?? "кабинет",
        relation: link.relation,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [entityId, entity]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const rows = useMemo(
    () => (balances?.rows ?? []).filter((row) => row.warehouseId === warehouseId && row.qty > 0),
    [balances, warehouseId],
  );

  const totals = useMemo(() => {
    let qty = 0;
    let positions = 0;
    for (const [key, raw] of Object.entries(amounts)) {
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) continue;
      qty += value;
      positions += 1;
      void key;
    }
    return { qty, positions };
  }, [amounts]);

  const overshoot = useMemo(() => {
    const used = new Map<string, number>();
    for (const [key, raw] of Object.entries(amounts)) {
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) continue;
      const productId = key.split(":")[0];
      used.set(productId, (used.get(productId) ?? 0) + value);
    }
    return rows.filter((row) => (used.get(row.productId) ?? 0) > row.qty).map((row) => row.productId);
  }, [amounts, rows]);

  const ship = async () => {
    const lines = Object.entries(amounts)
      .map(([key, raw]) => {
        const [productId, cabinetId] = key.split(":");
        return { productId, cabinetId, qty: Number(raw) };
      })
      .filter((line) => Number.isFinite(line.qty) && line.qty > 0);

    if (lines.length === 0) { setError("Укажите количества"); return; }
    setSaving(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/warehouse/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, warehouseId, note, lines }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось отгрузить");
      setDone(`Отгружено ${formatNumber(json.data.qty)} шт на ${formatNumber(Math.round(json.data.amount))} ₽`);
      setAmounts({});
      setNote("");
      await load();
      onShipped();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отгрузить");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Загружаю остатки…</div>;

  if (cabinets.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        У юрлица «{entity?.name}» нет связанных кабинетов — отгружать некуда. Свяжите кабинет с юрлицом,
        и он появится здесь колонкой.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {done && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{done}</div>}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <span className="text-sm text-slate-500">Отгружаем со склада</span>
        <select
          value={warehouseId}
          onChange={(e) => { setWarehouseId(e.target.value); setAmounts({}); }}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
        >
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}{warehouse.kind === "fulfillment" ? " · ФФ" : ""}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Комментарий к отгрузке"
          className="min-w-48 flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-300"
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">На складе пусто</p>
          <p className="mt-1 text-sm text-slate-400">Отгружать нечего: сначала проведите приёмку.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 text-left font-medium">Артикул</th>
                  <th className="px-4 py-3 text-right font-medium">На складе</th>
                  {cabinets.map((cabinet) => (
                    <th key={cabinet.id} className="px-4 py-3 text-right font-medium">
                      {cabinet.name}
                      {cabinet.relation === "agent" && (
                        <span className="ml-1 rounded bg-slate-200 px-1 py-0.5 text-[10px] normal-case text-slate-600">агент</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const tooMuch = overshoot.includes(row.productId);
                  return (
                    <tr key={row.productId} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-900">{row.article}</div>
                        <div className="text-xs text-slate-400">{row.unitCost.toFixed(2)} ₽/шт</div>
                      </td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${tooMuch ? "text-red-600" : "text-slate-900"}`}>
                        {formatNumber(row.qty)}
                      </td>
                      {cabinets.map((cabinet) => (
                        <td key={cabinet.id} className="px-4 py-2.5 text-right">
                          <input
                            inputMode="numeric"
                            value={amounts[cellKey(row.productId, cabinet.id)] ?? ""}
                            onChange={(e) => setAmounts((prev) => ({
                              ...prev,
                              [cellKey(row.productId, cabinet.id)]: e.target.value.replace(/[^\d]/g, ""),
                            }))}
                            placeholder="0"
                            className={`w-20 rounded-lg border px-2 py-1 text-right text-sm ${
                              tooMuch ? "border-red-300 bg-red-50" : "border-slate-200"
                            }`}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-sm text-slate-600">
              К отгрузке <b className="text-slate-900">{formatNumber(totals.qty)}</b> шт
              <span className="text-slate-400"> · {totals.positions} строк</span>
              {overshoot.length > 0 && (
                <span className="ml-2 text-red-600">больше, чем есть на складе — исправьте выделенные</span>
              )}
            </div>
            <button
              onClick={() => void ship()}
              disabled={saving || totals.qty === 0 || overshoot.length > 0}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? "Отгружаю…" : "Отгрузить"}
            </button>
          </div>
        </>
      )}

      <p className="text-xs text-slate-400">
        Товар списывается со склада сразу: дальше он живёт в остатках маркетплейса, которые приходят из его API.
        Списание идёт по средневзвешенной себестоимости склада на момент отгрузки.
      </p>
    </div>
  );
}
