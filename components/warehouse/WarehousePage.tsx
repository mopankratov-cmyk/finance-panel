"use client";

import { Boxes, Building2, ClipboardCheck, RefreshCw, ScrollText, Truck, Warehouse as WarehouseIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BalancesTab } from "@/components/warehouse/BalancesTab";
import { MovesTab } from "@/components/warehouse/MovesTab";
import { ReceiptsTab } from "@/components/warehouse/ReceiptsTab";
import { ShipmentTab } from "@/components/warehouse/ShipmentTab";
import { WarehousesTab } from "@/components/warehouse/WarehousesTab";
import type { LegalEntityRow } from "@/lib/warehouse/entityAccess";
import type { WarehouseRow } from "@/app/api/warehouse/warehouses/route";

type Tab = "balances" | "receipts" | "shipment" | "moves" | "warehouses";

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "balances", label: "Остатки", icon: Boxes },
  { key: "receipts", label: "Приёмка", icon: ClipboardCheck },
  { key: "shipment", label: "Отгрузка", icon: Truck },
  { key: "moves", label: "Движения", icon: ScrollText },
  { key: "warehouses", label: "Склады", icon: WarehouseIcon },
];

const STORAGE_KEY = "warehouse:entity";

export function WarehousePage() {
  const [tab, setTab] = useState<Tab>("balances");
  const [entities, setEntities] = useState<LegalEntityRow[]>([]);
  const [entityId, setEntityId] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Отдельный флаг: пока справочник юрлиц не прочитан, «нет юрлиц» — неправда,
  // а просто ещё не знаем. Без него экран мигает пустым состоянием.
  const [entitiesLoading, setEntitiesLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const entity = useMemo(() => entities.find((row) => row.id === entityId) ?? null, [entities, entityId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/warehouse/entities", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Не удалось загрузить юрлица");
        if (cancelled) return;
        const rows: LegalEntityRow[] = json.data ?? [];
        setEntities(rows);
        const saved = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
        const preferred = rows.find((row) => row.id === saved) ?? rows.find((row) => row.cabinets.length > 0) ?? rows[0];
        setEntityId(preferred?.id ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить юрлица");
      } finally {
        if (!cancelled) setEntitiesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadWarehouses = useCallback(async () => {
    if (!entityId) { setWarehouses([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/warehouse/warehouses", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить склады");
      setWarehouses(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить склады");
      setWarehouses([]);
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void loadWarehouses(); }, [loadWarehouses, refreshKey]);

  const pickEntity = (id: string) => {
    setEntityId(id);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
  };

  const refresh = () => setRefreshKey((key) => key + 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Склад</h1>
          <p className="mt-1 text-sm text-slate-400">
            Товар принадлежит юрлицу и лежит на его складах — маркетплейс об этом остатке не знает
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <Building2 className="h-4 w-4 text-slate-400" />
            <select
              value={entityId ?? ""}
              onChange={(e) => pickEntity(e.target.value)}
              className="bg-transparent text-sm font-medium text-slate-700 outline-none"
            >
              {entities.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={refresh}
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Обновить
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              tab === key ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {entitiesLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          Загружаю юрлица…
        </div>
      ) : !entityId ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          {entities.length === 0 ? "Нет доступных юрлиц" : "Выберите юрлицо"}
        </div>
      ) : loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          Загружаю склады…
        </div>
      ) : warehouses.length === 0 && tab !== "warehouses" ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <p className="text-sm font-medium text-amber-900">Сначала заведите склад</p>
          <p className="mt-1 text-sm text-amber-800">
            У юрлица «{entity?.name}» нет ни одного склада, приходовать некуда. Заведите его на вкладке «Склады» —
            свой, если товар лежит у вас, или склад фулфилмента.
          </p>
          <button
            onClick={() => setTab("warehouses")}
            className="mt-3 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
          >
            Перейти к складам
          </button>
        </div>
      ) : tab === "balances" ? (
        <BalancesTab entityId={entityId} refreshKey={refreshKey} />
      ) : tab === "receipts" ? (
        <ReceiptsTab entityId={entityId} entity={entity} warehouses={warehouses} refreshKey={refreshKey} onPosted={refresh} />
      ) : tab === "shipment" ? (
        <ShipmentTab entityId={entityId} entity={entity} warehouses={warehouses} refreshKey={refreshKey} onShipped={refresh} />
      ) : tab === "moves" ? (
        <MovesTab entityId={entityId} refreshKey={refreshKey} />
      ) : (
        <WarehousesTab entityId={entityId} entity={entity} warehouses={warehouses} onChanged={refresh} />
      )}
    </div>
  );
}
