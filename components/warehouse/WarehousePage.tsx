"use client";

import { Activity, ArrowLeftRight, Boxes, Building2, ClipboardCheck, FileText, QrCode, PackageX, Package, RefreshCw, ScrollText, Truck, Warehouse as WarehouseIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BalancesTab } from "@/components/warehouse/BalancesTab";
import { DocsTab } from "@/components/warehouse/DocsTab";
import { EventsTab } from "@/components/warehouse/EventsTab";
import { KizTab } from "@/components/warehouse/KizTab";
import { MovementTab } from "@/components/warehouse/MovementTab";
import { MovesTab } from "@/components/warehouse/MovesTab";
import { ReceiptsTab } from "@/components/warehouse/ReceiptsTab";
import { DefectsTab } from "@/components/warehouse/DefectsTab";
import { ProductsTab } from "@/components/warehouse/ProductsTab";
import { ShipmentTab } from "@/components/warehouse/ShipmentTab";
import { WarehousesTab } from "@/components/warehouse/WarehousesTab";
import { TodoBell } from "@/components/warehouse/TodoBell";
import { WarehouseShell, type ShellTab } from "@/components/warehouse/WarehouseShell";
import type { LegalEntityRow } from "@/lib/warehouse/entityAccess";
import { canManageStock } from "@/lib/warehouse/operatorScope";
import type { WarehouseRow } from "@/app/api/warehouse/warehouses/route";

type Tab = "balances" | "receipts" | "shipment" | "movement" | "defects" | "events" | "products" | "kiz" | "docs" | "moves" | "warehouses";

/** Порядок — рабочий день склада: сначала то, что делают руками, потом то, чем
 *  сверяются, и в конце то, что настраивают раз в месяц. */
const TABS: ShellTab<Tab>[] = [
  { key: "receipts", label: "Приёмка", icon: ClipboardCheck, group: "Работа" },
  { key: "shipment", label: "Отгрузка", icon: Truck, group: "Работа" },
  { key: "movement", label: "Перемещение", icon: ArrowLeftRight, group: "Работа" },
  { key: "defects", label: "Брак", icon: PackageX, group: "Работа" },
  { key: "balances", label: "Остатки", icon: Boxes, group: "Учёт" },
  { key: "events", label: "События", icon: Activity, group: "Учёт" },
  { key: "kiz", label: "Маркировка", icon: QrCode, group: "Учёт" },
  { key: "docs", label: "Документы", icon: FileText, group: "Учёт" },
  { key: "moves", label: "Движения", icon: ScrollText, group: "Учёт" },
  { key: "products", label: "Товары", icon: Package, group: "Справочники" },
  { key: "warehouses", label: "Склады", icon: WarehouseIcon, group: "Справочники" },
];

/** Оператор склада приходит работать руками, а не сверять журналы: ему видны
 *  вкладки, куда он что-то вводит, плюс остатки — чтобы знать, что на полке.
 *  Справочники, документы и вывод кодов из оборота — не его работа. */
const OPERATOR_TABS = new Set<Tab>(["receipts", "shipment", "movement", "defects", "balances"]);

/** Внешний селлер ведёт свой склад целиком, но контур маркировки не его: коды
 *  Честного Знака мы заказываем и выводим своими токенами, и его юрлица там
 *  нет. Вкладку прячем, иначе он увидит экран, который ответит отказом. */
const SELLER_HIDDEN_TABS = new Set<Tab>(["kiz"]);
const HOME_TAB: Record<string, Tab> = { warehouse: "receipts" };

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
  const [me, setMe] = useState<{ email: string; role: string } | null>(null);
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
  // Вкладки, на которых человек уже был: их держим смонтированными, чтобы
  // возврат был мгновенным. Набор живёт при текущем юрлице — при смене
  // сбрасывается, иначе на экране остались бы чужие остатки.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set<Tab>());
  // Пока адрес не прочитан, писать в него нечего: иначе первый же рендер
  // затрёт `?tab=` значением по умолчанию.
  const addressRead = useRef(false);
  // Склады уже читались хотя бы раз — дальше обновление идёт без заглушки.
  const warehousesSeen = useRef(false);

  const entity = useMemo(() => entities.find((row) => row.id === entityId) ?? null, [entities, entityId]);

  useEffect(() => { setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab))); }, [tab]);
  // Смена юрлица: всё, что висело смонтированным, относится к прошлому.
  useEffect(() => { setVisited(new Set<Tab>([tab])); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [entityId]);

  const loadWarehouses = useCallback(async () => {
    // Склады общие, но настройки пары «юрлицо + склад» — нет: дату, с которой
    // продажи FBS списывают склад, каждое юрлицо выставляет себе само.
    //
    // Заглушка «Загружаю склады…» показывается только пока складов ещё нет:
    // иначе каждое «Обновить» после проводки размонтировало бы вкладку, и
    // зелёная панель «Отгружено …» пропадала бы, не успев прочитаться.
    setLoading(!warehousesSeen.current);
    setError(null);
    try {
      const query = entityId ? `?entity=${encodeURIComponent(entityId)}` : "";
      const res = await fetch(`/api/warehouse/warehouses${query}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Не удалось загрузить склады");
      setWarehouses(json.data ?? []);
      warehousesSeen.current = true;
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

  // Роль решает, куда человек попадает и что видит. Ссылка на чужую вкладку
  // оператору не откроется: он уедет на свою домашнюю.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        const user = json.user ?? null;
        setMe(user);
        const home = HOME_TAB[user?.role ?? ""];
        if (!home) return;
        setTab((current) => (readAddress().tab && OPERATOR_TABS.has(current) ? current : home));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const tabs = useMemo(() => {
    if (me?.role === "warehouse") return TABS.filter((item) => OPERATOR_TABS.has(item.key));
    if (me?.role === "seller") return TABS.filter((item) => !SELLER_HIDDEN_TABS.has(item.key));
    return TABS;
  }, [me]);
  // Куда человеку вообще можно уйти. Колокольчик отсекает по этому набору дела,
  // ведущие на скрытую от роли вкладку: роут дел про роли не знает и считает
  // всё по юрлицу, а нажатие на такое дело открывало экран, которого нет в меню.
  const visibleTabs = useMemo(() => new Set(tabs.map((item) => item.key)), [tabs]);
  // Кто ставит задания, правит приход и возвращает брак в остаток. Пока роль не
  // прочитана — «нет»: спрятать кнопку на секунду безопаснее, чем показать чужую.
  const canManage = canManageStock(me?.role);

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
    // flex-wrap: в шапке теперь три элемента, а список юрлиц бывает длинным —
    // на узком экране строка должна переноситься, а не уезжать за край.
    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
      {entityId && (
        <TodoBell entityId={entityId} refreshKey={refreshKey} visibleTabs={visibleTabs} onGo={setTab} />
      )}
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
      subtitle="Приёмка, задания, остатки"
      tabs={tabs}
      active={tab}
      onSelect={setTab}
      toolbar={toolbar}
      me={me}
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
      ) : (
        /**
         * Вкладку, на которой человек уже был, НЕ размонтируем — прячем.
         *
         * Раньше каждое переключение поднимало экран с нуля: 3–7 секунд
         * «Загружаю…» на каждый заход, и вместе с компонентом умирало всё
         * состояние — раскрытые модели в остатках, фильтры в журнале,
         * незаконченный ввод. Вернулся на вкладку, где был минуту назад, —
         * жди заново.
         *
         * Теперь первый заход стоит одну загрузку, а все следующие
         * переключения мгновенны. Смена юрлица сбрасывает набор: данные
         * принадлежат юрлицу, и показывать чужие остатки нельзя.
         */
        <>
          {visited.has("balances") && (
            <div className={tab === "balances" ? "" : "hidden"}>
              <BalancesTab entityId={entityId} refreshKey={refreshKey} />
            </div>
          )}
          {visited.has("receipts") && (
            <div className={tab === "receipts" ? "" : "hidden"}>
              <ReceiptsTab entityId={entityId} entity={entity} warehouses={warehouses} refreshKey={refreshKey} canManage={canManage} onPosted={refresh} />
            </div>
          )}
          {visited.has("shipment") && (
            <div className={tab === "shipment" ? "" : "hidden"}>
              <ShipmentTab entityId={entityId} entity={entity} warehouses={warehouses} refreshKey={refreshKey} canManage={canManage} onShipped={refresh} />
            </div>
          )}
          {visited.has("movement") && (
            <div className={tab === "movement" ? "" : "hidden"}>
              <MovementTab entityId={entityId} entity={entity} warehouses={warehouses} refreshKey={refreshKey} onChanged={refresh} />
            </div>
          )}
          {visited.has("defects") && (
            <div className={tab === "defects" ? "" : "hidden"}>
              <DefectsTab entityId={entityId} warehouses={warehouses} refreshKey={refreshKey} canManage={canManage} onChanged={refresh} />
            </div>
          )}
          {visited.has("events") && (
            <div className={tab === "events" ? "" : "hidden"}>
              <EventsTab entityId={entityId} refreshKey={refreshKey} />
            </div>
          )}
          {visited.has("products") && (
            <div className={tab === "products" ? "" : "hidden"}>
              <ProductsTab entityId={entityId} entities={entities} refreshKey={refreshKey} external={me?.role === "seller"} />
            </div>
          )}
          {visited.has("kiz") && (
            <div className={tab === "kiz" ? "" : "hidden"}>
              <KizTab entityId={entityId} refreshKey={refreshKey} />
            </div>
          )}
          {visited.has("docs") && (
            <div className={tab === "docs" ? "" : "hidden"}>
              <DocsTab entityId={entityId} refreshKey={refreshKey} onChanged={refresh} />
            </div>
          )}
          {visited.has("moves") && (
            <div className={tab === "moves" ? "" : "hidden"}>
              <MovesTab entityId={entityId} refreshKey={refreshKey} />
            </div>
          )}
          {visited.has("warehouses") && (
            <div className={tab === "warehouses" ? "" : "hidden"}>
              <WarehousesTab entityId={entityId} entity={entity} warehouses={warehouses} onChanged={refresh} />
            </div>
          )}
        </>
      )}
    </WarehouseShell>
  );
}
