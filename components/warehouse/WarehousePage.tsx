"use client";

import { ArrowLeftRight, Boxes, Building2, ClipboardCheck, FileText, QrCode, PackageX, Package, RefreshCw, ScrollText, Truck, Warehouse as WarehouseIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BalancesTab } from "@/components/warehouse/BalancesTab";
import { DocsTab } from "@/components/warehouse/DocsTab";
import { KizTab } from "@/components/warehouse/KizTab";
import { MovementTab } from "@/components/warehouse/MovementTab";
import { MovesTab } from "@/components/warehouse/MovesTab";
import { ReceiptsTab } from "@/components/warehouse/ReceiptsTab";
import { DefectsTab } from "@/components/warehouse/DefectsTab";
import { ProductsTab } from "@/components/warehouse/ProductsTab";
import { ShipmentTab } from "@/components/warehouse/ShipmentTab";
import { WarehousesTab } from "@/components/warehouse/WarehousesTab";
import { WarehouseShell } from "@/components/warehouse/WarehouseShell";
import type { LegalEntityRow } from "@/lib/warehouse/entityAccess";
import type { WarehouseRow } from "@/app/api/warehouse/warehouses/route";

type Tab = "balances" | "receipts" | "shipment" | "movement" | "defects" | "products" | "kiz" | "docs" | "moves" | "warehouses";

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "balances", label: "Остатки", icon: Boxes },
  { key: "receipts", label: "Приёмка", icon: ClipboardCheck },
  { key: "shipment", label: "Отгрузка", icon: Truck },
  { key: "movement", label: "Перемещение", icon: ArrowLeftRight },
  { key: "defects", label: "Брак", icon: PackageX },
  { key: "products", label: "Товары", icon: Package },
  { key: "kiz", label: "Маркировка", icon: QrCode },
  { key: "docs", label: "Документы", icon: FileText },
  { key: "moves", label: "Движения", icon: ScrollText },
  { key: "warehouses", label: "Склады", icon: WarehouseIcon },
];

const STORAGE_KEY = "warehouse:entity";
const TAB_KEYS = new Set(TABS.map((item) => item.key));

/** Что открыто — часть адреса, а не памяти вкладки: `F5` возвращает на то же
 *  место, а ссылку можно кинуть коллеге и попасть туда же, где стоял сам. */
function readAddress(): { tab: Tab | null; entity: string | null } {
  if (typeof window === "undefined") return { tab: null, entity: null };
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  return {
    tab: tab && TAB_KEYS.has(tab as Tab) ? (tab as Tab) : null,
    entity: params.get("entity"),
  };
}

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
  // Пока адрес не прочитан, писать в него нечего: иначе первый же рендер
  // затрёт `?tab=` значением по умолчанию.
  const addressRead = useRef(false);

  const entity = useMemo(() => entities.find((row) => row.id === entityId) ?? null, [entities, entityId]);

  const loadWarehouses = useCallback(async () => {
    // Склады общие, но настройки пары «юрлицо + склад» — нет: дату, с которой
    // продажи FBS списывают склад, каждое юрлицо выставляет себе само.
    setLoading(true);
    setError(null);
    try {
      const query = entityId ? `?entity=${encodeURIComponent(entityId)}` : "";
      const res = await fetch(`/api/warehouse/warehouses${query}`, { cache: "no-store" });
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

  // Юрлица читаются один раз, склады — на каждую смену юрлица: у них разные
  // причины меняться, и сливать их в один эффект значило бы перечитывать
  // справочник юрлиц при каждом переключении и сбрасывать выбор.
  useEffect(() => { void loadWarehouses(); }, [loadWarehouses]);

  // Адрес читается отдельно от справочника: упал справочник юрлиц — вкладка
  // всё равно та, что в ссылке.
  useEffect(() => {
    const address = readAddress();
    if (address.tab) setTab(address.tab);
    addressRead.current = true;
  }, []);

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
        const address = readAddress();
        const saved = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
        // Адрес важнее последнего выбора: по ссылке человек ждёт именно то юрлицо,
        // которое в ней записано, а не то, с которым сидел вчера.
        const preferred =
          rows.find((row) => row.id === address.entity)
          ?? rows.find((row) => row.id === saved)
          ?? rows.find((row) => row.cabinets.length > 0)
          ?? rows[0];
        setEntityId(preferred?.id ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить юрлица");
      } finally {
        if (!cancelled) setEntitiesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { if (refreshKey > 0) void loadWarehouses(); }, [loadWarehouses, refreshKey]);

  useEffect(() => {
    if (!addressRead.current || !entityId) return;
    const url = `${window.location.pathname}?tab=${tab}&entity=${encodeURIComponent(entityId)}`;
    if (url !== window.location.pathname + window.location.search) window.history.replaceState(null, "", url);
  }, [tab, entityId]);

  const pickEntity = (id: string) => {
    setEntityId(id);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
  };

  const refresh = () => setRefreshKey((key) => key + 1);

  const toolbar = (
    <div className="ml-auto flex items-center gap-2">
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
  );

  return (
    <WarehouseShell
      title="Склад"
      subtitle="Товары, приёмка, остатки"
      tabs={TABS}
      active={tab}
      onSelect={setTab}
      toolbar={toolbar}
    >
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

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
      ) : warehouses.length === 0 && tab !== "warehouses" && tab !== "products" ? (
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
      ) : tab === "movement" ? (
        <MovementTab entityId={entityId} entity={entity} warehouses={warehouses} refreshKey={refreshKey} onChanged={refresh} />
      ) : tab === "defects" ? (
        <DefectsTab entityId={entityId} warehouses={warehouses} refreshKey={refreshKey} onChanged={refresh} />
      ) : tab === "products" ? (
        <ProductsTab entityId={entityId} entities={entities} refreshKey={refreshKey} />
      ) : tab === "kiz" ? (
        <KizTab refreshKey={refreshKey} />
      ) : tab === "docs" ? (
        <DocsTab entityId={entityId} refreshKey={refreshKey} onChanged={refresh} />
      ) : tab === "moves" ? (
        <MovesTab entityId={entityId} refreshKey={refreshKey} />
      ) : (
        <WarehousesTab entityId={entityId} entity={entity} warehouses={warehouses} onChanged={refresh} />
      )}
    </WarehouseShell>
  );
}
