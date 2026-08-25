"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatNumber } from "@/lib/analytics/format";
import type { StockBalancesResponse } from "@/app/api/warehouse/balances/route";
import type { WarehouseRow } from "@/app/api/warehouse/warehouses/route";
import { warehouseKindSuffix } from "@/lib/warehouse/warehouseKind";
import type { LegalEntityRow } from "@/lib/warehouse/entityAccess";
import { WbProductImage } from "@/components/wb/WbProductImage";
import { variantLabel } from "@/lib/warehouse/variantLabel";
import { MARKETPLACE_LABEL } from "@/lib/warehouse/cabinetChannels";
import { newDocKey } from "@/lib/warehouse/docKey";
import { useDraft } from "@/lib/warehouse/useDraft";
import { DraftNotice } from "@/components/warehouse/DraftNotice";

interface CabinetOption {
  id: string;
  name: string;
  relation: "own" | "agent";
  marketplace: "wb" | "ozon";
}

/** Ключ ячейки ввода: одна позиция может уехать в несколько кабинетов сразу. */
const cellKey = (variantId: string, cabinetId: string) => `${variantId}:${cabinetId}`;

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
      const balancesRes = await fetch(`/api/warehouse/balances?entity=${entityId}`, { cache: "no-store" });
      const balancesJson = await balancesRes.json();
      if (!balancesRes.ok) throw new Error(balancesJson.error || "Не удалось загрузить остатки");
      setBalances(balancesJson.data);

      // Имена кабинетов приходят вместе с юрлицом — кабинетный API оператору склада закрыт.
      setCabinets((entity?.cabinets ?? []).map((link) => ({
        id: link.cabinetId,
        name: link.cabinetName,
        relation: link.relation,
        marketplace: link.marketplace,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить данные");
    } finally {
      setLoading(false);
    }
  }, [entityId, entity]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  // Ключ появляется, когда остатки уже пришли: до этого форма пустая не потому,
  // что её очистили, а потому что ей нечего показывать.
  const draftKey = loading || !warehouseId ? null : `warehouse:ship:${entityId}:${warehouseId}`;
  const draftValue = useMemo(() => ({ amounts, note }), [amounts, note]);
  const { restoredAt, forget } = useDraft(
    draftKey,
    draftValue,
    useCallback((value: { amounts: Record<string, string>; note: string }) =>
      Object.values(value.amounts).every((raw) => !raw) && !value.note, []),
    useCallback((value: { amounts: Record<string, string>; note: string }) => {
      setAmounts(value.amounts ?? {});
      setNote(value.note ?? "");
    }, []),
  );

  const startOver = () => { setAmounts({}); setNote(""); forget(); };

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
      const variantId = key.split(":")[0];
      used.set(variantId, (used.get(variantId) ?? 0) + value);
    }
    return rows.filter((row) => (used.get(row.variantId) ?? 0) > row.qty).map((row) => row.variantId);
  }, [amounts, rows]);

  const ship = async () => {
    const lines = Object.entries(amounts)
      .map(([key, raw]) => {
        const [variantId, cabinetId] = key.split(":");
        return { variantId, cabinetId, qty: Number(raw) };
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
        body: JSON.stringify({ entityId, warehouseId, note, lines, docKey: newDocKey() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось отгрузить");
      setDone(`Отгружено ${formatNumber(json.data.qty)} шт на ${formatNumber(Math.round(json.data.amount))} ₽`);
      setAmounts({});
      setNote("");
      forget();
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
      <DraftNotice at={restoredAt} onForget={startOver} />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <span className="text-sm text-slate-500">Отгружаем со склада</span>
        <select
          value={warehouseId}
          onChange={(e) => { setWarehouseId(e.target.value); setAmounts({}); }}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
        >
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}{warehouseKindSuffix(warehouse.kind)}
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
                      {/* Маркетплейс виден в шапке колонки: у кабинетов бывают похожие
                          имена, а отгрузка не туда — это товар, уехавший не на ту площадку. */}
                      <span className={`ml-1 rounded px-1 py-0.5 text-[10px] normal-case ${
                        cabinet.marketplace === "ozon" ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700"
                      }`}>{MARKETPLACE_LABEL[cabinet.marketplace]}</span>
                      {cabinet.relation === "agent" && (
                        <span className="ml-1 rounded bg-slate-200 px-1 py-0.5 text-[10px] normal-case text-slate-600">агент</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const tooMuch = overshoot.includes(row.variantId);
                  return (
                    <tr key={row.variantId} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <WbProductImage
                            nm={row.nmId ?? undefined}
                            src={row.photoUrl ?? undefined}
                            alt={row.article}
                            className="h-10 w-10 shrink-0 rounded-lg border border-slate-100 bg-slate-50 object-cover"
                          />
                          <div>
                        <div className="font-medium text-slate-900">{variantLabel(row.article, row.sizeLabel)}</div>
                        <div className="text-xs text-slate-400">{row.unitCost.toFixed(2)} ₽/шт</div>
                          </div>
                        </div>
                      </td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${tooMuch ? "text-red-600" : "text-slate-900"}`}>
                        {formatNumber(row.qty)}
                      </td>
                      {cabinets.map((cabinet) => (
                        <td key={cabinet.id} className="px-4 py-2.5 text-right">
                          <input
                            inputMode="numeric"
                            value={amounts[cellKey(row.variantId, cabinet.id)] ?? ""}
                            onChange={(e) => setAmounts((prev) => ({
                              ...prev,
                              [cellKey(row.variantId, cabinet.id)]: e.target.value.replace(/[^\d]/g, ""),
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
    </div>
  );
}
