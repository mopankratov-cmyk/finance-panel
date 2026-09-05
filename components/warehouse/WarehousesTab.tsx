"use client";

import { useState } from "react";
import type { WarehouseRow } from "@/app/api/warehouse/warehouses/route";
import type { LegalEntityRow } from "@/lib/warehouse/entityAccess";
import { parseWarehouseKind, warehouseKindLabel, type WarehouseKind } from "@/lib/warehouse/warehouseKind";

export function WarehousesTab({
  entityId,
  entity,
  warehouses,
  onChanged,
}: {
  entityId: string;
  entity: LegalEntityRow | null;
  warehouses: WarehouseRow[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<WarehouseKind>("own");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; kind: WarehouseKind } | null>(null);

  const patch = async (id: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      const res = await fetch(`/api/warehouse/warehouses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось изменить склад");
      setEditing(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить склад");
    }
  };

  const create = async () => {
    if (!name.trim()) { setError("Укажите название склада"); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/warehouse/warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), kind }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось создать склад");
      setName("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать склад");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-900">Новый склад</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
            placeholder="Например: Уссурийск"
            className="min-w-56 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-300"
          />
          <select
            value={kind}
            onChange={(e) => setKind(parseWarehouseKind(e.target.value))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
          >
            <option value="own">свой склад</option>
            <option value="fulfillment">фулфилмент</option>
            <option value="transit">в пути</option>
          </select>
          <button
            onClick={() => void create()}
            disabled={saving}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {saving ? "Создаю…" : "Создать"}
          </button>
        </div>
      </div>

      {warehouses.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          Складов пока нет
        </div>
      ) : (
        // Реестр складов читают строкой за строкой, а не сравнивают колонки:
        // на телефоне он рассыпается в карточки, и поле «списывать с» с
        // кнопками перестаёт жить за правым краем экрана.
        <div className="table-cards scroll-x md:rounded-xl md:border md:border-slate-200 md:bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3 text-left font-medium">Название</th>
                <th className="px-4 py-3 text-left font-medium">Тип</th>
                <th className="px-4 py-3 text-left font-medium">Состояние</th>
                <th className="px-4 py-3 text-left font-medium">Продажи FBS списывать с</th>
                <th className="px-4 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {warehouses.map((warehouse) => {
                const isEditing = editing?.id === warehouse.id;
                return (
                  <tr key={warehouse.id} className="border-b border-slate-100 last:border-0">
                    <td data-cell="title" className="px-4 py-2.5 font-medium text-slate-900">
                      {isEditing ? (
                        <input
                          value={editing.name}
                          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Enter") void patch(warehouse.id, { name: editing.name, kind: editing.kind }); }}
                          className="min-h-11 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm lg:min-h-0"
                        />
                      ) : warehouse.name}
                    </td>
                    <td data-label="Тип" className="px-4 py-2.5 text-slate-600">
                      {isEditing ? (
                        <select
                          value={editing.kind}
                          onChange={(e) => setEditing({ ...editing, kind: parseWarehouseKind(e.target.value) })}
                          className="min-h-11 rounded-lg border border-slate-200 px-2 py-1 text-sm lg:min-h-0"
                        >
                          <option value="own">свой склад</option>
                          <option value="fulfillment">фулфилмент</option>
                          <option value="transit">в пути</option>
                        </select>
                      ) : warehouseKindLabel(warehouse.kind)}
                    </td>
                    <td data-label="Состояние" className="px-4 py-2.5">
                      {warehouse.isActive
                        ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">активен</span>
                        : <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">в архиве</span>}
                    </td>
                    <td data-label="Продажи FBS списывать с" className="px-4 py-2.5">
                      {/* Дата — обещание, что остатку склада с этого дня можно верить.
                          Пока её нет, продажи не вычитаются: иначе остаток ушёл бы
                          в минус на всю историю торговли. */}
                      <input
                        type="date"
                        value={warehouse.fbsSalesSince ? warehouse.fbsSalesSince.slice(0, 10) : ""}
                        onChange={(e) => void patch(warehouse.id, {
                          entityId,
                          fbsSalesSince: e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : null,
                        })}
                        className="min-h-11 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 lg:min-h-0"
                      />
                      {warehouse.fbsSyncedAt && (
                        <span className="ml-2 text-[10px] text-slate-400">
                          сверено {new Date(warehouse.fbsSyncedAt).toLocaleDateString("ru-RU")}
                        </span>
                      )}
                    </td>
                    <td data-cell="actions" className="px-4 py-2.5 text-right">
                      {isEditing ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            onClick={() => void patch(warehouse.id, { name: editing.name, kind: editing.kind })}
                            className="inline-flex min-h-11 items-center rounded-lg bg-violet-600 px-3 text-xs font-medium text-white lg:min-h-0 lg:py-1"
                          >
                            Сохранить
                          </button>
                          <button onClick={() => setEditing(null)} className="inline-flex min-h-11 items-center px-2 text-xs text-slate-500 lg:min-h-0 lg:px-0">
                            Отмена
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-3">
                          <button
                            onClick={() => setEditing({ id: warehouse.id, name: warehouse.name, kind: warehouse.kind })}
                            className="inline-flex min-h-11 items-center px-2 text-xs text-violet-600 hover:underline lg:min-h-0 lg:px-0"
                          >
                            Изменить
                          </button>
                          <button
                            onClick={() => void patch(warehouse.id, { isActive: !warehouse.isActive })}
                            className="inline-flex min-h-11 items-center px-2 text-xs text-slate-500 hover:underline lg:min-h-0 lg:px-0"
                          >
                            {warehouse.isActive ? "В архив" : "Вернуть"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
