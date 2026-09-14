"use client";

import {
  CalendarClock,
  Factory,
  FileWarning,
  History,
  Loader2,
  PackagePlus,
  Plus,
  ReceiptRussianRuble,
  Save,
  Ship,
  Trash2,
  Truck,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SupplyRow } from "@/app/api/supplies/route";
import { SlidePanel } from "@/components/ui/SlidePanel";
import { LoadingBanner, useElapsedSeconds } from "@/components/ui/LoadingState";
import type { PurchaseOrderView } from "@/lib/purchases/db";
import {
  addDays,
  diffPurchaseOrderRevision,
  PURCHASE_CURRENCIES,
  PURCHASE_ORDER_STATUSES,
  purchaseOrderTotals,
  type OrderRevisionChange,
  type PurchaseOrderInput,
  type PurchaseOrderStatus,
} from "@/lib/purchases/order";
import type { SupplierView } from "@/lib/purchases/suppliers";
import { SHIPMENT_STATUSES, type ShipmentStatus } from "@/lib/purchases/shipments";
import type { SupplierShipmentView } from "@/lib/purchases/shipmentsDb";
import { DISCREPANCY_RESOLUTIONS, type DiscrepancyResolution } from "@/lib/purchases/discrepancyActs";
import type { DiscrepancyActView } from "@/lib/purchases/discrepancyActsDb";
import { WbEmptyState, WbErrorState } from "./WbModuleHeader";

interface Props {
  skus: SupplyRow[];
  cabinetId: string;
  canWrite: boolean;
}

type EditableOrder = PurchaseOrderInput & { receiptBatchId?: string | null };
type SaveState = "idle" | "saving" | "saved" | "error";

interface OrdersResponse {
  meta?: { warnings?: string[] };
  data: { orders?: PurchaseOrderView[]; order?: PurchaseOrderView } | null;
  error: string | null;
}

interface HistoryEntry {
  id: number;
  action: string;
  actor: string | null;
  createdAt: string;
  before: unknown;
  after: unknown;
}

interface DiscrepancySummary {
  batchId: string | null;
  counted: boolean;
  expectedQty: number;
  receivedQty: number;
  defectQty: number;
  short: number;
  over: number;
  act: DiscrepancyActView | null;
}

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: "Черновик",
  placed: "Размещён",
  production: "В производстве",
  transit: "В пути",
  received: "Принят",
  cancelled: "Отменён",
};

const STATUS_STYLES: Record<PurchaseOrderStatus, string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-600",
  placed: "border-blue-200 bg-blue-50 text-blue-700",
  production: "border-amber-200 bg-amber-50 text-amber-700",
  transit: "border-violet-200 bg-violet-50 text-violet-700",
  received: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-700",
};

const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  planned: "Готовится",
  shipped: "Отгружена",
  customs: "На таможне",
  arrived: "Прибыла",
  received: "Принята",
  cancelled: "Отменена",
};

const SHIPMENT_STATUS_STYLES: Record<ShipmentStatus, string> = {
  planned: "border-slate-200 bg-slate-50 text-slate-600",
  shipped: "border-blue-200 bg-blue-50 text-blue-700",
  customs: "border-amber-200 bg-amber-50 text-amber-700",
  arrived: "border-violet-200 bg-violet-50 text-violet-700",
  received: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-700",
};

const RESOLUTION_LABELS: Record<DiscrepancyResolution, string> = {
  wait_restock: "Ждать допоставку",
  reduce_debt: "Уменьшить долг",
  refund: "Запросить возврат денег",
  accept_replacement: "Принять замену",
  claim: "Оформить претензию",
};

const formatMoney = (value: number, currency = "RUB") => new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency,
  maximumFractionDigits: currency === "RUB" ? 0 : 2,
}).format(value || 0);

const today = () => new Date().toISOString().slice(0, 10);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const revisionDate = (value: string) => {
  if (!ISO_DATE_RE.test(value)) return value || "—";
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("ru-RU");
};

function describeRevisionChange(change: OrderRevisionChange): string {
  if (change.kind === "itemAdded") return `+ ${change.article || change.nmId}: добавлена позиция, ${change.quantity} шт × ${change.unitPrice}`;
  if (change.kind === "itemRemoved") return `− ${change.article || change.nmId}: позиция удалена`;
  if (change.kind === "itemChanged") {
    const parts: string[] = [];
    if (change.quantityBefore !== change.quantityAfter) parts.push(`количество ${change.quantityBefore} → ${change.quantityAfter}`);
    if (change.unitPriceBefore !== change.unitPriceAfter) parts.push(`цена ${change.unitPriceBefore} → ${change.unitPriceAfter}`);
    if (change.articleBefore !== change.articleAfter) parts.push(`артикул ${change.articleBefore || "—"} → ${change.articleAfter || "—"}`);
    if (change.nameBefore !== change.nameAfter) parts.push("название изменено");
    return `${change.article || change.nmId}: ${parts.join(", ")}`;
  }
  switch (change.field) {
    case "orderNumber": return `Номер: ${change.before || "—"} → ${change.after || "—"}`;
    case "supplier": return `Поставщик: ${change.before || "—"} → ${change.after || "—"}`;
    case "orderDate": return `Дата заказа: ${revisionDate(change.before)} → ${revisionDate(change.after)}`;
    case "productionDays": return `Срок производства: ${change.before} → ${change.after} дн.`;
    case "expectedReadyDate": return `Готовность: ${revisionDate(change.before)} → ${revisionDate(change.after)}`;
    case "currency": return `Валюта: ${change.before} → ${change.after}`;
    case "exchangeRate": return `Курс: ${change.before} → ${change.after}`;
    case "status": return `Статус: ${STATUS_LABELS[change.before as PurchaseOrderStatus] ?? change.before} → ${STATUS_LABELS[change.after as PurchaseOrderStatus] ?? change.after}`;
    case "note": return "Комментарий изменён";
    default: return "";
  }
}

function createDraft(cabinetId: string): EditableOrder {
  const orderDate = today();
  return {
    cabinetId,
    orderNumber: `Z-${orderDate.slice(0, 4)}-${String(Date.now()).slice(-5)}`,
    supplier: "",
    supplierId: null,
    orderDate,
    productionDays: 30,
    expectedReadyDate: addDays(orderDate, 30),
    currency: "CNY",
    exchangeRate: 12.5,
    status: "draft",
    note: "",
    idempotencyKey: crypto.randomUUID(),
    items: [],
    paymentStages: [{ title: "Оплата фабрике", percent: 100, amount: 0, dueDate: null, paidAt: null, status: "planned" }],
    logisticsStages: [],
    expenses: [],
  };
}

function EditorSection({ icon, title, action, children }: { icon: typeof Factory; title: string; action?: ReactNode; children: ReactNode }) {
  const Icon = icon;
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex min-h-11 items-center gap-2 border-b border-slate-100 px-3 sm:px-4">
        <Icon className="h-4 w-4 text-violet-600" />
        <h3 className="text-xs font-semibold text-slate-800">{title}</h3>
        <div className="ml-auto">{action}</div>
      </div>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}

const inputClass = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100";
const smallButton = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 hover:border-violet-300 hover:text-violet-700 disabled:cursor-not-allowed disabled:opacity-50";

export function WbPurchaseOrdersTab({ skus, cabinetId, canWrite }: Props) {
  const [orders, setOrders] = useState<PurchaseOrderView[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierView[]>([]);
  const [loading, setLoading] = useState(true);
  const elapsed = useElapsedSeconds(loading);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<EditableOrder | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pickerNm, setPickerNm] = useState("");
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [shipments, setShipments] = useState<SupplierShipmentView[]>([]);
  const [shipmentDraft, setShipmentDraft] = useState<{ carrier: string; route: string; eta: string; quantities: Record<number, string> } | null>(null);
  const [shipmentSaving, setShipmentSaving] = useState(false);
  const [shipmentError, setShipmentError] = useState<string | null>(null);
  const [discrepancy, setDiscrepancy] = useState<DiscrepancySummary | null>(null);
  const [discrepancyLoading, setDiscrepancyLoading] = useState(false);
  const [discrepancySaving, setDiscrepancySaving] = useState(false);
  const [discrepancyError, setDiscrepancyError] = useState<string | null>(null);
  const [discrepancyNote, setDiscrepancyNote] = useState("");
  const requestId = useRef(0);
  const shipmentRequestId = useRef(0);
  const discrepancyRequestId = useRef(0);
  const version = useRef(0);
  const savingRef = useRef(false);

  const loadOrders = useCallback(async () => {
    if (!cabinetId || cabinetId === "all") {
      setOrders([]);
      setLoading(false);
      setLoadError("Выберите один реальный кабинет");
      return;
    }
    const current = ++requestId.current;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/purchase-orders?cabinet=${encodeURIComponent(cabinetId)}`, { cache: "no-store" });
      const body = await response.json() as OrdersResponse;
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      if (current !== requestId.current) return;
      setOrders(body.data?.orders ?? []);
      setWarnings(body.meta?.warnings ?? []);
    } catch (error) {
      if (current === requestId.current) setLoadError(error instanceof Error ? error.message : "Не удалось загрузить заказы");
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [cabinetId]);

  useEffect(() => { void loadOrders(); }, [loadOrders]);
  useEffect(() => {
    setOpen(false);
    setForm(null);
    setDirty(false);
  }, [cabinetId]);

  // Справочник поставщиков общий на компанию, кабинет тут ни при чём —
  // грузим один раз, а не при каждой смене кабинета (как заказы выше).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/suppliers", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { data: { suppliers?: SupplierView[] } | null }) => {
        if (!cancelled) setSuppliers(body.data?.suppliers ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const activeSuppliers = useMemo(() => suppliers.filter((supplier) => supplier.isActive), [suppliers]);
  const supplierByName = useMemo(() => new Map(activeSuppliers.map((supplier) => [supplier.name, supplier])), [activeSuppliers]);

  const loadShipments = useCallback(async (orderId: string) => {
    const current = ++shipmentRequestId.current;
    try {
      const response = await fetch(`/api/purchase-orders/${orderId}/shipments`, { cache: "no-store" });
      const body = await response.json() as { data: { shipments?: SupplierShipmentView[] } | null; error: string | null };
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      if (current === shipmentRequestId.current) setShipments(body.data?.shipments ?? []);
    } catch {
      if (current === shipmentRequestId.current) setShipments([]);
    }
  }, []);

  // Отгрузки — не часть черновика (в отличие от items/paymentStages): это
  // случившийся логистический факт, а не то, что можно набросать и стереть.
  // Поэтому грузим отдельным запросом при открытии сохранённого заказа, а не
  // держим их в form вместе с автосохранением. shipmentRequestId (тот же
  // приём, что requestId у loadOrders) не даёт ответу по прошлому заказу
  // перезаписать список уже открытого другого — иначе смена статуса могла
  // бы уйти не в ту отгрузку.
  useEffect(() => {
    if (!open || !form?.id) { shipmentRequestId.current += 1; setShipments([]); return; }
    void loadShipments(form.id);
  }, [open, form?.id, loadShipments]);

  const loadDiscrepancy = useCallback(async (orderId: string) => {
    const current = ++discrepancyRequestId.current;
    setDiscrepancyLoading(true);
    try {
      const response = await fetch(`/api/purchase-orders/${orderId}/discrepancy`, { cache: "no-store" });
      const body = await response.json() as { data: DiscrepancySummary | null; error: string | null };
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      if (current === discrepancyRequestId.current) {
        setDiscrepancy(body.data);
        setDiscrepancyNote(body.data?.act?.note ?? "");
      }
    } catch (error) {
      if (current === discrepancyRequestId.current) setDiscrepancyError(error instanceof Error ? error.message : "Не удалось загрузить расхождения");
    } finally {
      if (current === discrepancyRequestId.current) setDiscrepancyLoading(false);
    }
  }, []);

  // Расхождение есть, только если приёмка вообще создана — до этого спрашивать
  // /discrepancy бессмысленно (у заказа ещё нет receiptBatchId). discrepancySaving
  // сбрасываем тут же на каждую смену заказа (а не только когда у нового заказа
  // ещё нет receiptBatchId) — иначе кнопки решения на только что открытом заказе
  // B остаются заблокированы, пока не долетит забытый запрос от заказа A.
  useEffect(() => {
    discrepancyRequestId.current += 1;
    setDiscrepancySaving(false);
    if (!open || !form?.id || !form.receiptBatchId) { setDiscrepancy(null); setDiscrepancyError(null); return; }
    void loadDiscrepancy(form.id);
  }, [open, form?.id, form?.receiptBatchId, loadDiscrepancy]);

  const submitDiscrepancyResolution = async (resolution: DiscrepancyResolution) => {
    if (!form?.id || discrepancySaving) return;
    setDiscrepancySaving(true);
    setDiscrepancyError(null);
    try {
      const response = await fetch(`/api/purchase-orders/${form.id}/discrepancy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution, status: "open", note: discrepancyNote }),
      });
      const body = await response.json() as { data: unknown; error: string | null };
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      await loadDiscrepancy(form.id);
    } catch (error) {
      setDiscrepancyError(error instanceof Error ? error.message : "Не удалось сохранить решение");
    } finally {
      setDiscrepancySaving(false);
    }
  };

  const patchDiscrepancyAct = async (patch: { status?: "open" | "resolved"; resolution?: DiscrepancyResolution; note?: string }) => {
    if (!form?.id || !discrepancy?.act || discrepancySaving) return;
    setDiscrepancySaving(true);
    setDiscrepancyError(null);
    try {
      // Шлём только то, что реально меняется — не весь акт целиком: иначе
      // устаревший локальный снимок (вкладка не перечитала после чужого
      // PATCH) мог бы прислать старый status и молча переоткрыть уже
      // решённый кем-то другим акт при простом сохранении комментария.
      const response = await fetch(`/api/discrepancy-acts/${discrepancy.act.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await response.json() as { data: unknown; error: string | null };
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      await loadDiscrepancy(form.id);
    } catch (error) {
      setDiscrepancyError(error instanceof Error ? error.message : "Не удалось обновить акт");
    } finally {
      setDiscrepancySaving(false);
    }
  };

  const mutate = useCallback((change: (current: EditableOrder) => EditableOrder) => {
    version.current += 1;
    setForm((current) => current ? change(current) : current);
    setDirty(true);
    setSaveError(null);
    setSaveState("idle");
  }, []);

  const saveOrder = useCallback(async (snapshot: EditableOrder) => {
    if (savingRef.current || !canWrite) return;
    savingRef.current = true;
    const startVersion = version.current;
    setSaveState("saving");
    setSaveError(null);
    try {
      const response = await fetch(snapshot.id ? `/api/purchase-orders/${snapshot.id}` : "/api/purchase-orders", {
        method: snapshot.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });
      const body = await response.json() as OrdersResponse;
      const saved = body.data?.order;
      if (!response.ok || body.error || !saved) throw new Error(body.error || `Ошибка ${response.status}`);

      setOrders((current) => [saved, ...current.filter((order) => order.id !== saved.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      setForm((current) => {
        if (!current) return current;
        if (startVersion === version.current) return saved;
        return { ...current, id: saved.id, receiptBatchId: saved.receiptBatchId };
      });
      if (startVersion === version.current) setDirty(false);
      setSavedAt(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }));
      setSaveState("saved");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Не удалось сохранить заказ");
      setSaveState("error");
    } finally {
      savingRef.current = false;
    }
  }, [canWrite]);

  useEffect(() => {
    if (!open || !form || !dirty || savingRef.current || saveState === "error") return;
    const timer = window.setTimeout(() => { void saveOrder(form); }, 900);
    return () => window.clearTimeout(timer);
  }, [dirty, form, open, saveOrder, saveState]);

  const totals = useMemo(() => form ? purchaseOrderTotals(form) : null, [form]);
  const availableSkus = useMemo(() => skus.filter((sku) => !form?.items.some((item) => item.nmId === sku.nmId)), [form?.items, skus]);
  const historyChanges = useMemo(() => {
    const map = new Map<number, OrderRevisionChange[]>();
    for (const entry of history ?? []) {
      if (entry.action === "updated") map.set(entry.id, diffPurchaseOrderRevision(entry.before, entry.after));
    }
    return map;
  }, [history]);

  const startNew = () => {
    version.current += 1;
    setForm(createDraft(cabinetId));
    setDirty(true);
    setSaveState("idle");
    setSaveError(null);
    setHistory(null);
    setPickerNm("");
    setShipmentDraft(null);
    setShipmentError(null);
    setDiscrepancyError(null);
    setOpen(true);
  };

  const editOrder = (order: PurchaseOrderView) => {
    version.current += 1;
    setForm(order);
    setDirty(false);
    setSaveState("idle");
    setSaveError(null);
    setSavedAt(null);
    setHistory(null);
    setPickerNm("");
    setShipmentDraft(null);
    setShipmentError(null);
    setDiscrepancyError(null);
    setOpen(true);
  };

  const closeEditor = () => {
    if (dirty && saveState === "error" && !window.confirm("Заказ не сохранён. Всё равно закрыть?")) return;
    setOpen(false);
  };

  const addItem = () => {
    const sku = skus.find((row) => String(row.nmId) === pickerNm);
    if (!sku) return;
    mutate((current) => ({ ...current, items: [...current.items, { nmId: sku.nmId, article: sku.article, name: "", quantity: Math.max(1, sku.need45), unitPrice: 0 }] }));
    setPickerNm("");
  };

  const loadHistory = async () => {
    if (!form?.id) return;
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/purchase-orders/${form.id}/history`, { cache: "no-store" });
      const body = await response.json() as { data: { history: HistoryEntry[] } | null; error: string | null };
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      setHistory(body.data?.history ?? []);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Не удалось загрузить историю");
    } finally {
      setHistoryLoading(false);
    }
  };

  const sendToReceiving = async () => {
    if (!form?.id || dirty || receiving) return;
    setReceiving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/purchase-orders/${form.id}/receiving`, { method: "POST" });
      const body = await response.json() as { data: { batchId: string } | null; error: string | null };
      if (!response.ok || body.error || !body.data) throw new Error(body.error || `Ошибка ${response.status}`);
      setForm((current) => current ? { ...current, status: "transit", receiptBatchId: body.data?.batchId ?? null } : current);
      await loadOrders();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Не удалось создать приёмку");
    } finally {
      setReceiving(false);
    }
  };

  const startShipmentDraft = () => {
    if (!form) return;
    setShipmentError(null);
    setShipmentDraft({ carrier: "", route: "", eta: "", quantities: Object.fromEntries(form.items.map((item) => [item.nmId, ""])) });
  };

  const submitShipmentDraft = async () => {
    if (!form?.id || !shipmentDraft || shipmentSaving) return;
    const items = form.items
      .map((item) => ({ nmId: item.nmId, article: item.article, quantity: Number(shipmentDraft.quantities[item.nmId] || 0) }))
      .filter((item) => item.quantity > 0);
    if (items.length === 0) { setShipmentError("Укажите количество хотя бы по одной позиции"); return; }
    setShipmentSaving(true);
    setShipmentError(null);
    try {
      const response = await fetch(`/api/purchase-orders/${form.id}/shipments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: form.id, carrier: shipmentDraft.carrier, route: shipmentDraft.route, status: "planned", eta: shipmentDraft.eta || null, items }),
      });
      const body = await response.json() as { data: unknown; error: string | null };
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      await loadShipments(form.id);
      setShipmentDraft(null);
    } catch (error) {
      setShipmentError(error instanceof Error ? error.message : "Не удалось создать отгрузку");
    } finally {
      setShipmentSaving(false);
    }
  };

  const patchShipmentStatus = async (shipment: SupplierShipmentView, status: ShipmentStatus) => {
    if (!form?.id) return;
    const timestampPatch =
      status === "shipped" ? { shippedAt: new Date().toISOString() }
      : status === "arrived" ? { arrivedAt: new Date().toISOString() }
      : status === "received" ? { receivedAt: new Date().toISOString() }
      : {};
    try {
      const response = await fetch(`/api/supplier-shipments/${shipment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...shipment, status, ...timestampPatch }),
      });
      const body = await response.json() as { data: unknown; error: string | null };
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      await loadShipments(form.id);
    } catch (error) {
      setShipmentError(error instanceof Error ? error.message : "Не удалось обновить статус отгрузки");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Factory className="h-4 w-4 text-violet-600" /> Заказы фабрике</div>
          <p className="mt-1 text-[11px] text-slate-500">Производство, оплаты, логистика и передача в приёмку в одном документе.</p>
        </div>
        <button type="button" onClick={startNew} disabled={!canWrite} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-50 lg:min-h-9"><Plus className="h-4 w-4" /> Новый заказ</button>
      </div>

      {warnings.map((warning) => <div key={warning} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">{warning}</div>)}
      {/* Тот же индикатор, что и на остальных вкладках раздела: одинаковая
          формулировка и счётчик секунд вместо собственного спиннера. */}
      {loading ? <LoadingBanner seconds={elapsed} hint="заказы фабрике" /> : loadError ? <WbErrorState message={loadError} onRetry={() => void loadOrders()} /> : orders.length === 0 ? <WbEmptyState>Заказов фабрике пока нет. Создайте первый — черновик сохранится автоматически.</WbEmptyState> : (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {orders.map((order) => <button key={order.id} type="button" onClick={() => editOrder(order)} className="group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md">
            <div className="flex items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><Factory className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-bold text-slate-800">{order.orderNumber}</span><span className={`ml-auto shrink-0 rounded-full border px-2 py-1 text-[9px] font-semibold ${STATUS_STYLES[order.status]}`}>{STATUS_LABELS[order.status]}</span></div><div className="mt-0.5 truncate text-[11px] text-slate-500">{order.supplier || "Поставщик не указан"}</div></div></div>
            <div className="mt-4 grid grid-cols-3 gap-2"><div><div className="text-[9px] uppercase tracking-wide text-slate-400">Готовность</div><div className="mt-1 text-[11px] font-semibold text-slate-700">{new Date(`${order.expectedReadyDate}T12:00:00`).toLocaleDateString("ru-RU")}</div></div><div><div className="text-[9px] uppercase tracking-wide text-slate-400">Позиции</div><div className="mt-1 text-[11px] font-semibold text-slate-700">{order.items.length} · {order.totals.quantity.toLocaleString("ru-RU")} шт</div></div><div className="text-right"><div className="text-[9px] uppercase tracking-wide text-slate-400">Итого</div><div className="mt-1 text-[11px] font-bold text-violet-700">{formatMoney(order.totals.totalRub)}</div></div></div>
            {order.receiptBatchId ? <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-3 text-[10px] font-medium text-emerald-700"><PackagePlus className="h-3.5 w-3.5" /> Передан в приёмку</div> : null}
          </button>)}
        </div>
      )}

      <SlidePanel
        open={open}
        onClose={closeEditor}
        fixedWidth={1280}
        title={form?.orderNumber ?? "Заказ фабрике"}
        header={form ? <div className="flex min-w-0 flex-1 flex-col gap-3 pr-2 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><Factory className="h-5 w-5 shrink-0 text-violet-600" /><h2 className="truncate text-base font-bold text-slate-900">{form.orderNumber}</h2><span className={`rounded-full border px-2 py-1 text-[9px] font-semibold ${STATUS_STYLES[form.status]}`}>{STATUS_LABELS[form.status]}</span></div><div className="mt-1 text-[10px] text-slate-400">{saveState === "saving" ? "Сохраняю изменения…" : saveState === "error" ? "Есть несохранённые изменения" : savedAt ? `Сохранено в ${savedAt}` : form.id ? "Автосохранение включено" : "Новый черновик"}</div></div>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void loadHistory()} disabled={!form.id || historyLoading} className={smallButton}>{historyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />} История</button><button type="button" onClick={() => void sendToReceiving()} disabled={!form.id || dirty || receiving || Boolean(form.receiptBatchId) || ["draft", "cancelled", "received"].includes(form.status)} className={smallButton}>{receiving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackagePlus className="h-3.5 w-3.5" />} {form.receiptBatchId ? "Приёмка создана" : "Передать в приёмку"}</button><button type="button" onClick={() => void saveOrder(form)} disabled={!dirty || saveState === "saving"} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{saveState === "saving" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Сохранить</button></div>
        </div> : undefined}
      >
        {form ? <div className="space-y-3 bg-[#f7f8fa] p-0.5">
          {saveError ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{saveError}</div> : null}
          <EditorSection icon={CalendarClock} title="Основные параметры">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Номер заказа<input value={form.orderNumber} onChange={(event) => mutate((current) => ({ ...current, orderNumber: event.target.value }))} className={inputClass} /></label>
              <label className="space-y-1.5 text-[10px] font-medium text-slate-500">
                Поставщик
                <input
                  list="purchase-order-supplier-options"
                  value={form.supplier}
                  onChange={(event) => {
                    const value = event.target.value;
                    const matched = supplierByName.get(value.trim());
                    mutate((current) => ({ ...current, supplier: value, supplierId: matched ? matched.id : null }));
                  }}
                  placeholder="Название фабрики или выбор из справочника"
                  className={inputClass}
                />
                <datalist id="purchase-order-supplier-options">
                  {activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.name} />)}
                </datalist>
                {form.supplierId ? <span className="block text-[9px] font-normal text-emerald-600">Привязан к справочнику</span> : null}
              </label>
              <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Дата заказа<input type="date" value={form.orderDate} onChange={(event) => mutate((current) => ({ ...current, orderDate: event.target.value, expectedReadyDate: addDays(event.target.value, current.productionDays) }))} className={inputClass} /></label>
              <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Срок производства, дней<input type="number" min={0} max={365} value={form.productionDays} onChange={(event) => mutate((current) => ({ ...current, productionDays: Number(event.target.value), expectedReadyDate: addDays(current.orderDate, Number(event.target.value)) }))} className={inputClass} /></label>
              <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Ожидаемая готовность<input type="date" readOnly value={form.expectedReadyDate} className={`${inputClass} bg-slate-50 text-slate-500`} /></label>
              <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Валюта<select value={form.currency} onChange={(event) => mutate((current) => ({ ...current, currency: event.target.value as PurchaseOrderInput["currency"] }))} className={inputClass}>{PURCHASE_CURRENCIES.map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Курс к рублю<input type="number" min={0.0001} step={0.01} value={form.exchangeRate} onChange={(event) => mutate((current) => ({ ...current, exchangeRate: Number(event.target.value) }))} className={inputClass} /></label>
              <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Статус<select value={form.status} onChange={(event) => mutate((current) => ({ ...current, status: event.target.value as PurchaseOrderStatus }))} className={inputClass}>{PURCHASE_ORDER_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</select></label>
            </div>
          </EditorSection>

          <EditorSection icon={Factory} title={`Товары · ${form.items.length}`} action={<div className="flex gap-2"><select value={pickerNm} onChange={(event) => setPickerNm(event.target.value)} className="h-9 max-w-56 rounded-lg border border-slate-200 bg-white px-2 text-[10px] outline-none focus:border-violet-400"><option value="">Выберите SKU</option>{availableSkus.map((sku) => <option key={sku.nmId} value={sku.nmId}>{sku.article || sku.nmId} · нужно {sku.need45}</option>)}</select><button type="button" onClick={addItem} disabled={!pickerNm} className={smallButton}><Plus className="h-3.5 w-3.5" /> Добавить</button></div>}>
            {form.items.length === 0 ? <div className="py-7 text-center text-xs text-slate-400">Добавьте товары из текущего кабинета. Для Optima список уже ограничен NORVIA и RIOBOX.</div> : <div className="scroll-x"><table className="min-w-[760px] w-full text-[10px]"><thead><tr className="border-b border-slate-200 text-slate-400"><th className="pb-2 text-left">Товар</th><th className="pb-2 text-right">Количество</th><th className="pb-2 text-right">Цена, {form.currency}</th><th className="pb-2 text-right">Сумма</th><th className="w-10" /></tr></thead><tbody>{form.items.map((item, index) => <tr key={item.nmId} className="border-b border-slate-100"><td className="py-2 pr-3"><div className="font-semibold text-slate-700">{item.article || item.nmId}</div><div className="text-[9px] text-slate-400">nm {item.nmId}</div></td><td className="py-2 pl-3"><input aria-label={`Количество ${item.article || item.nmId}`} type="number" min={1} value={item.quantity} onChange={(event) => mutate((current) => ({ ...current, items: current.items.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: Number(event.target.value) } : row) }))} className={`${inputClass} ml-auto w-28 text-right tabular-nums`} /></td><td className="py-2 pl-3"><input aria-label={`Цена ${item.article || item.nmId}`} type="number" min={0} step={0.01} value={item.unitPrice} onChange={(event) => mutate((current) => ({ ...current, items: current.items.map((row, rowIndex) => rowIndex === index ? { ...row, unitPrice: Number(event.target.value) } : row) }))} className={`${inputClass} ml-auto w-32 text-right tabular-nums`} /></td><td className="py-2 pl-3 text-right font-semibold tabular-nums text-slate-700">{formatMoney(item.quantity * item.unitPrice, form.currency)}</td><td className="py-2 pl-2"><button type="button" onClick={() => mutate((current) => ({ ...current, items: current.items.filter((_, rowIndex) => rowIndex !== index) }))} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Удалить позицию"><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div>}
          </EditorSection>

          <div className="grid gap-3 xl:grid-cols-2">
            <EditorSection icon={WalletCards} title="Этапы оплаты" action={<button type="button" onClick={() => mutate((current) => ({ ...current, paymentStages: [...current.paymentStages, { title: "Новый этап", percent: 0, amount: 0, dueDate: null, paidAt: null, status: "planned" }] }))} className={smallButton}><Plus className="h-3.5 w-3.5" /> Этап</button>}>
              <div className="space-y-2">{form.paymentStages.map((stage, index) => <div key={index} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2"><div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_76px_104px_38px]"><input aria-label="Название этапа оплаты" value={stage.title} onChange={(event) => mutate((current) => ({ ...current, paymentStages: current.paymentStages.map((row, rowIndex) => rowIndex === index ? { ...row, title: event.target.value } : row) }))} className={inputClass} /><input aria-label="Процент оплаты" type="number" min={0} max={100} value={stage.percent} onChange={(event) => mutate((current) => ({ ...current, paymentStages: current.paymentStages.map((row, rowIndex) => rowIndex === index ? { ...row, percent: Number(event.target.value) } : row) }))} className={`${inputClass} text-right`} /><input aria-label="Сумма оплаты" type="number" min={0} value={stage.amount} onChange={(event) => mutate((current) => ({ ...current, paymentStages: current.paymentStages.map((row, rowIndex) => rowIndex === index ? { ...row, amount: Number(event.target.value) } : row) }))} className={`${inputClass} text-right`} /><button type="button" onClick={() => mutate((current) => ({ ...current, paymentStages: current.paymentStages.filter((_, rowIndex) => rowIndex !== index) }))} className="flex min-h-11 w-full items-center justify-end rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:min-h-0 sm:w-auto sm:justify-center" aria-label="Удалить этап оплаты"><span className="mr-1.5 text-[10px] font-medium sm:hidden">Удалить</span><Trash2 className="h-4 w-4" /></button></div><div className="mt-2 grid grid-cols-2 gap-2"><label className="space-y-1 text-[9px] text-slate-400">Срок оплаты<input aria-label="Срок оплаты" type="date" value={stage.dueDate ?? ""} onChange={(event) => mutate((current) => ({ ...current, paymentStages: current.paymentStages.map((row, rowIndex) => rowIndex === index ? { ...row, dueDate: event.target.value || null } : row) }))} className={inputClass} /></label><label className="space-y-1 text-[9px] text-slate-400">Статус<select aria-label="Статус оплаты" value={stage.status} onChange={(event) => mutate((current) => ({ ...current, paymentStages: current.paymentStages.map((row, rowIndex) => rowIndex === index ? { ...row, status: event.target.value as typeof row.status, paidAt: event.target.value === "paid" ? new Date().toISOString() : null } : row) }))} className={inputClass}><option value="planned">Запланирован</option><option value="paid">Оплачен</option><option value="cancelled">Отменён</option></select></label></div></div>)}</div>
              <div className="mt-3 flex justify-between border-t border-slate-100 pt-3 text-[10px]"><span className="text-slate-400">Распределено</span><span className="font-bold text-slate-700">{form.paymentStages.filter((stage) => stage.status !== "cancelled").reduce((sum, stage) => sum + stage.percent, 0)}%</span></div>
            </EditorSection>

            <EditorSection icon={Ship} title="Логистика" action={<button type="button" onClick={() => mutate((current) => ({ ...current, logisticsStages: [...current.logisticsStages, { title: "Карго", provider: "", dueDate: null, completedAt: null, cost: 0, status: "planned" }] }))} className={smallButton}><Plus className="h-3.5 w-3.5" /> Этап</button>}>
              {form.logisticsStages.length === 0 ? <div className="py-4 text-center text-[11px] text-slate-400">Этапы логистики не добавлены.</div> : <div className="space-y-2">{form.logisticsStages.map((stage, index) => <div key={index} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2"><div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_104px_38px]"><input aria-label="Название этапа логистики" value={stage.title} onChange={(event) => mutate((current) => ({ ...current, logisticsStages: current.logisticsStages.map((row, rowIndex) => rowIndex === index ? { ...row, title: event.target.value } : row) }))} className={inputClass} /><input aria-label="Перевозчик" value={stage.provider} onChange={(event) => mutate((current) => ({ ...current, logisticsStages: current.logisticsStages.map((row, rowIndex) => rowIndex === index ? { ...row, provider: event.target.value } : row) }))} placeholder="Перевозчик" className={inputClass} /><input aria-label="Стоимость логистики" type="number" min={0} value={stage.cost} onChange={(event) => mutate((current) => ({ ...current, logisticsStages: current.logisticsStages.map((row, rowIndex) => rowIndex === index ? { ...row, cost: Number(event.target.value) } : row) }))} className={`${inputClass} text-right`} /><button type="button" onClick={() => mutate((current) => ({ ...current, logisticsStages: current.logisticsStages.filter((_, rowIndex) => rowIndex !== index) }))} className="flex min-h-11 w-full items-center justify-end rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:min-h-0 sm:w-auto sm:justify-center" aria-label="Удалить этап логистики"><span className="mr-1.5 text-[10px] font-medium sm:hidden">Удалить</span><Trash2 className="h-4 w-4" /></button></div><div className="mt-2 grid grid-cols-2 gap-2"><label className="space-y-1 text-[9px] text-slate-400">Плановая дата<input aria-label="Плановая дата логистики" type="date" value={stage.dueDate ?? ""} onChange={(event) => mutate((current) => ({ ...current, logisticsStages: current.logisticsStages.map((row, rowIndex) => rowIndex === index ? { ...row, dueDate: event.target.value || null } : row) }))} className={inputClass} /></label><label className="space-y-1 text-[9px] text-slate-400">Статус<select aria-label="Статус логистики" value={stage.status} onChange={(event) => mutate((current) => ({ ...current, logisticsStages: current.logisticsStages.map((row, rowIndex) => rowIndex === index ? { ...row, status: event.target.value as typeof row.status, completedAt: event.target.value === "done" ? new Date().toISOString() : null } : row) }))} className={inputClass}><option value="planned">Запланирован</option><option value="in_progress">В работе</option><option value="done">Завершён</option><option value="cancelled">Отменён</option></select></label></div></div>)}</div>}
            </EditorSection>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
            <EditorSection icon={ReceiptRussianRuble} title="Дополнительные расходы" action={<button type="button" onClick={() => mutate((current) => ({ ...current, expenses: [...current.expenses, { title: "Новый расход", amount: 0, currency: "RUB" }] }))} className={smallButton}><Plus className="h-3.5 w-3.5" /> Расход</button>}>
              {form.expenses.length === 0 ? <div className="py-4 text-center text-[11px] text-slate-400">Дополнительных расходов нет.</div> : <div className="space-y-2">{form.expenses.map((expense, index) => <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_120px_80px_38px]"><input aria-label="Название расхода" value={expense.title} onChange={(event) => mutate((current) => ({ ...current, expenses: current.expenses.map((row, rowIndex) => rowIndex === index ? { ...row, title: event.target.value } : row) }))} className={inputClass} /><input aria-label="Сумма расхода" type="number" min={0} value={expense.amount} onChange={(event) => mutate((current) => ({ ...current, expenses: current.expenses.map((row, rowIndex) => rowIndex === index ? { ...row, amount: Number(event.target.value) } : row) }))} className={`${inputClass} text-right`} /><select aria-label="Валюта расхода" value={expense.currency} onChange={(event) => mutate((current) => ({ ...current, expenses: current.expenses.map((row, rowIndex) => rowIndex === index ? { ...row, currency: event.target.value as PurchaseOrderInput["currency"] } : row) }))} className={inputClass}>{[...new Set(["RUB", form.currency])].map((value) => <option key={value}>{value}</option>)}</select><button type="button" onClick={() => mutate((current) => ({ ...current, expenses: current.expenses.filter((_, rowIndex) => rowIndex !== index) }))} className="flex min-h-11 w-full items-center justify-end rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:min-h-0 sm:w-auto sm:justify-center" aria-label="Удалить расход"><span className="mr-1.5 text-[10px] font-medium sm:hidden">Удалить</span><Trash2 className="h-4 w-4" /></button></div>)}</div>}
              <label className="mt-3 block space-y-1.5 text-[10px] font-medium text-slate-500">Комментарий<textarea value={form.note} onChange={(event) => mutate((current) => ({ ...current, note: event.target.value }))} rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /></label>
            </EditorSection>

            <section className="rounded-xl bg-slate-900 p-4 text-white shadow-lg"><div className="text-xs font-semibold">Итог заказа</div><div className="mt-4 space-y-2 text-[11px]"><div className="flex justify-between text-slate-300"><span>Товар</span><span>{formatMoney(totals?.goodsRub ?? 0)}</span></div><div className="flex justify-between text-slate-300"><span>Логистика</span><span>{formatMoney(totals?.logisticsRub ?? 0)}</span></div><div className="flex justify-between text-slate-300"><span>Расходы</span><span>{formatMoney(totals?.expensesRub ?? 0)}</span></div><div className="flex justify-between border-t border-slate-700 pt-3 text-base font-bold"><span>Итого</span><span>{formatMoney(totals?.totalRub ?? 0)}</span></div><div className="flex justify-between text-[10px] text-slate-400"><span>{totals?.quantity.toLocaleString("ru-RU") ?? 0} шт</span><span>{formatMoney(totals?.goodsCurrency ?? 0, form.currency)}</span></div></div></section>
          </div>

          <EditorSection icon={Truck} title={`Отгрузки${shipments.length ? ` · ${shipments.length}` : ""}`} action={<button type="button" onClick={startShipmentDraft} disabled={!form.id || form.items.length === 0 || Boolean(shipmentDraft)} className={smallButton}><Plus className="h-3.5 w-3.5" /> Отгрузка</button>}>
            {shipmentError ? <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{shipmentError}</div> : null}
            {!form.id ? <div className="py-4 text-center text-[11px] text-slate-400">Сначала сохраните заказ.</div> : shipments.length === 0 && !shipmentDraft ? <div className="py-4 text-center text-[11px] text-slate-400">Отгрузок пока нет. Заказ можно доставлять несколькими партиями — каждая своей отгрузкой.</div> : (
              <div className="space-y-2">
                {shipments.map((shipment) => {
                  const quantity = shipment.items.reduce((sum, item) => sum + item.quantity, 0);
                  const overdue = shipment.eta && !["arrived", "received", "cancelled"].includes(shipment.status) && shipment.eta < today();
                  return <div key={shipment.id} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2 text-[10px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-700">{shipment.carrier || "Перевозчик не указан"}</span>
                      {shipment.route ? <span className="text-slate-400">{shipment.route}</span> : null}
                      <span className="text-slate-400">{quantity.toLocaleString("ru-RU")} шт</span>
                      {shipment.eta ? <span className={overdue ? "font-semibold text-rose-600" : "text-slate-400"}>{overdue ? "задержка, план " : "план "}{revisionDate(shipment.eta)}</span> : null}
                      <select aria-label="Статус отгрузки" value={shipment.status} onChange={(event) => void patchShipmentStatus(shipment, event.target.value as ShipmentStatus)} className={`ml-auto h-8 rounded-full border px-2 text-[9px] font-semibold ${SHIPMENT_STATUS_STYLES[shipment.status]}`}>
                        {SHIPMENT_STATUSES.map((value) => <option key={value} value={value}>{SHIPMENT_STATUS_LABELS[value]}</option>)}
                      </select>
                    </div>
                  </div>;
                })}
                {shipmentDraft ? <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input aria-label="Перевозчик" value={shipmentDraft.carrier} onChange={(event) => setShipmentDraft((current) => current ? { ...current, carrier: event.target.value } : current)} placeholder="Перевозчик" className={inputClass} />
                    <input aria-label="Маршрут" value={shipmentDraft.route} onChange={(event) => setShipmentDraft((current) => current ? { ...current, route: event.target.value } : current)} placeholder="Маршрут" className={inputClass} />
                    <input aria-label="Плановая дата прибытия" type="date" value={shipmentDraft.eta} onChange={(event) => setShipmentDraft((current) => current ? { ...current, eta: event.target.value } : current)} className={inputClass} />
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {form.items.map((item) => <div key={item.nmId} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-slate-600">{item.article || item.nmId}</span><input aria-label={`Количество в отгрузке ${item.article || item.nmId}`} type="number" min={0} max={item.quantity} value={shipmentDraft.quantities[item.nmId] ?? ""} onChange={(event) => setShipmentDraft((current) => current ? { ...current, quantities: { ...current.quantities, [item.nmId]: event.target.value } } : current)} placeholder="0" className={`${inputClass} w-24 text-right`} /><span className="w-16 shrink-0 text-slate-400">из {item.quantity}</span></div>)}
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" onClick={() => setShipmentDraft(null)} disabled={shipmentSaving} className={smallButton}>Отмена</button>
                    <button type="button" onClick={() => void submitShipmentDraft()} disabled={shipmentSaving} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{shipmentSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Создать</button>
                  </div>
                </div> : null}
              </div>
            )}
          </EditorSection>

          {form.receiptBatchId ? <EditorSection icon={FileWarning} title="Расхождения">
            {discrepancyError ? <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{discrepancyError}</div> : null}
            {discrepancyLoading && !discrepancy ? <div className="py-4 text-center text-[11px] text-slate-400">Загрузка…</div> : !discrepancy ? null : !discrepancy.counted ? (
              <div className="py-4 text-center text-[11px] text-slate-400">Приёмка ещё не пересчитана — расхождение станет видно после пересчёта на складе.</div>
            ) : discrepancy.short === 0 && discrepancy.over === 0 && discrepancy.defectQty === 0 ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-700">Принято точно как заказано — расхождений нет.</div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-4 text-[11px]">
                  {discrepancy.short > 0 ? <div><div className="text-[9px] uppercase tracking-wide text-slate-400">Недовоз</div><div className="font-semibold text-rose-600">−{discrepancy.short.toLocaleString("ru-RU")} шт</div></div> : null}
                  {discrepancy.over > 0 ? <div><div className="text-[9px] uppercase tracking-wide text-slate-400">Излишек</div><div className="font-semibold text-amber-600">+{discrepancy.over.toLocaleString("ru-RU")} шт</div></div> : null}
                  {discrepancy.defectQty > 0 ? <div><div className="text-[9px] uppercase tracking-wide text-slate-400">Брак</div><div className="font-semibold text-rose-600">{discrepancy.defectQty.toLocaleString("ru-RU")} шт</div></div> : null}
                </div>
                {discrepancy.act ? (
                  <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 text-[11px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-700">{RESOLUTION_LABELS[discrepancy.act.resolution]}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold ${discrepancy.act.status === "resolved" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>{discrepancy.act.status === "resolved" ? "Решено" : "Открыт"}</span>
                    </div>
                    <textarea aria-label="Комментарий к акту" value={discrepancyNote} onChange={(event) => setDiscrepancyNote(event.target.value)} placeholder="Комментарий" rows={2} className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" onClick={() => void patchDiscrepancyAct({ note: discrepancyNote })} disabled={discrepancySaving} className={smallButton}>Сохранить комментарий</button>
                      {discrepancy.act.status === "open"
                        ? <button type="button" onClick={() => void patchDiscrepancyAct({ status: "resolved" })} disabled={discrepancySaving} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">Отметить решённым</button>
                        : <button type="button" onClick={() => void patchDiscrepancyAct({ status: "open" })} disabled={discrepancySaving} className={smallButton}>Переоткрыть</button>}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="mb-1.5 text-[10px] font-medium text-slate-500">Решение закупщика</div>
                    <div className="flex flex-wrap gap-2">{DISCREPANCY_RESOLUTIONS.map((resolution) => <button key={resolution} type="button" onClick={() => void submitDiscrepancyResolution(resolution)} disabled={discrepancySaving} className={smallButton}>{RESOLUTION_LABELS[resolution]}</button>)}</div>
                  </div>
                )}
              </div>
            )}
          </EditorSection> : null}

          {history ? <EditorSection icon={History} title="История изменений"><div className="space-y-2">{history.length === 0 ? <div className="text-[11px] text-slate-400">История пока пуста.</div> : history.map((entry) => {
            const changes = historyChanges.get(entry.id) ?? [];
            return <div key={entry.id} className="rounded-lg bg-slate-50 px-3 py-2 text-[10px]">
              <div className="flex items-center gap-3"><span className="font-semibold text-slate-700">{entry.action === "created" ? "Создан" : entry.action === "receiving_created" ? "Передан в приёмку" : entry.action === "received" ? "Принят полностью" : "Изменён"}</span><span className="text-slate-400">{entry.actor || "система"}</span><span className="ml-auto tabular-nums text-slate-400">{new Date(entry.createdAt).toLocaleString("ru-RU")}</span></div>
              {changes.length > 0 ? <ul className="mt-1.5 space-y-0.5 border-t border-slate-200 pt-1.5">{changes.map((change, index) => <li key={index} className="text-slate-500">{describeRevisionChange(change)}</li>)}</ul> : null}
            </div>;
          })}</div></EditorSection> : null}
        </div> : null}
      </SlidePanel>
    </div>
  );
}
