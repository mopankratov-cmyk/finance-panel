"use client";

import {
  CalendarClock,
  Factory,
  History,
  Loader2,
  PackagePlus,
  Plus,
  ReceiptRussianRuble,
  Save,
  Ship,
  Trash2,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SupplyRow } from "@/app/api/supplies/route";
import { SlidePanel } from "@/components/ui/SlidePanel";
import { LoadingBanner, useElapsedSeconds } from "@/components/ui/LoadingState";
import type { PurchaseOrderView } from "@/lib/purchases/db";
import {
  addDays,
  PURCHASE_CURRENCIES,
  PURCHASE_ORDER_STATUSES,
  purchaseOrderTotals,
  type PurchaseOrderInput,
  type PurchaseOrderStatus,
} from "@/lib/purchases/order";
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

const formatMoney = (value: number, currency = "RUB") => new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency,
  maximumFractionDigits: currency === "RUB" ? 0 : 2,
}).format(value || 0);

const today = () => new Date().toISOString().slice(0, 10);

function createDraft(cabinetId: string): EditableOrder {
  const orderDate = today();
  return {
    cabinetId,
    orderNumber: `Z-${orderDate.slice(0, 4)}-${String(Date.now()).slice(-5)}`,
    supplier: "",
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
  const requestId = useRef(0);
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

  const startNew = () => {
    version.current += 1;
    setForm(createDraft(cabinetId));
    setDirty(true);
    setSaveState("idle");
    setSaveError(null);
    setHistory(null);
    setPickerNm("");
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

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Factory className="h-4 w-4 text-violet-600" /> Заказы фабрике</div>
          <p className="mt-1 text-[11px] text-slate-500">Производство, оплаты, логистика и передача в приёмку в одном документе.</p>
        </div>
        <button type="button" onClick={startNew} disabled={!canWrite} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-50 sm:min-h-9"><Plus className="h-4 w-4" /> Новый заказ</button>
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
              <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Поставщик<input value={form.supplier} onChange={(event) => mutate((current) => ({ ...current, supplier: event.target.value }))} placeholder="Название фабрики" className={inputClass} /></label>
              <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Дата заказа<input type="date" value={form.orderDate} onChange={(event) => mutate((current) => ({ ...current, orderDate: event.target.value, expectedReadyDate: addDays(event.target.value, current.productionDays) }))} className={inputClass} /></label>
              <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Срок производства, дней<input type="number" min={0} max={365} value={form.productionDays} onChange={(event) => mutate((current) => ({ ...current, productionDays: Number(event.target.value), expectedReadyDate: addDays(current.orderDate, Number(event.target.value)) }))} className={inputClass} /></label>
              <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Ожидаемая готовность<input type="date" readOnly value={form.expectedReadyDate} className={`${inputClass} bg-slate-50 text-slate-500`} /></label>
              <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Валюта<select value={form.currency} onChange={(event) => mutate((current) => ({ ...current, currency: event.target.value as PurchaseOrderInput["currency"] }))} className={inputClass}>{PURCHASE_CURRENCIES.map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Курс к рублю<input type="number" min={0.0001} step={0.01} value={form.exchangeRate} onChange={(event) => mutate((current) => ({ ...current, exchangeRate: Number(event.target.value) }))} className={inputClass} /></label>
              <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Статус<select value={form.status} onChange={(event) => mutate((current) => ({ ...current, status: event.target.value as PurchaseOrderStatus }))} className={inputClass}>{PURCHASE_ORDER_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}</select></label>
            </div>
          </EditorSection>

          <EditorSection icon={Factory} title={`Товары · ${form.items.length}`} action={<div className="flex gap-2"><select value={pickerNm} onChange={(event) => setPickerNm(event.target.value)} className="h-9 max-w-56 rounded-lg border border-slate-200 bg-white px-2 text-[10px] outline-none focus:border-violet-400"><option value="">Выберите SKU</option>{availableSkus.map((sku) => <option key={sku.nmId} value={sku.nmId}>{sku.article || sku.nmId} · нужно {sku.need45}</option>)}</select><button type="button" onClick={addItem} disabled={!pickerNm} className={smallButton}><Plus className="h-3.5 w-3.5" /> Добавить</button></div>}>
            {form.items.length === 0 ? <div className="py-7 text-center text-xs text-slate-400">Добавьте товары из текущего кабинета. Для Optima список уже ограничен NORVIA и RIOBOX.</div> : <div className="overflow-x-auto"><table className="min-w-[760px] w-full text-[10px]"><thead><tr className="border-b border-slate-200 text-slate-400"><th className="pb-2 text-left">Товар</th><th className="pb-2 text-right">Количество</th><th className="pb-2 text-right">Цена, {form.currency}</th><th className="pb-2 text-right">Сумма</th><th className="w-10" /></tr></thead><tbody>{form.items.map((item, index) => <tr key={item.nmId} className="border-b border-slate-100"><td className="py-2 pr-3"><div className="font-semibold text-slate-700">{item.article || item.nmId}</div><div className="text-[9px] text-slate-400">nm {item.nmId}</div></td><td className="py-2 pl-3"><input aria-label={`Количество ${item.article || item.nmId}`} type="number" min={1} value={item.quantity} onChange={(event) => mutate((current) => ({ ...current, items: current.items.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: Number(event.target.value) } : row) }))} className={`${inputClass} ml-auto w-28 text-right tabular-nums`} /></td><td className="py-2 pl-3"><input aria-label={`Цена ${item.article || item.nmId}`} type="number" min={0} step={0.01} value={item.unitPrice} onChange={(event) => mutate((current) => ({ ...current, items: current.items.map((row, rowIndex) => rowIndex === index ? { ...row, unitPrice: Number(event.target.value) } : row) }))} className={`${inputClass} ml-auto w-32 text-right tabular-nums`} /></td><td className="py-2 pl-3 text-right font-semibold tabular-nums text-slate-700">{formatMoney(item.quantity * item.unitPrice, form.currency)}</td><td className="py-2 pl-2"><button type="button" onClick={() => mutate((current) => ({ ...current, items: current.items.filter((_, rowIndex) => rowIndex !== index) }))} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Удалить позицию"><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div>}
          </EditorSection>

          <div className="grid gap-3 xl:grid-cols-2">
            <EditorSection icon={WalletCards} title="Этапы оплаты" action={<button type="button" onClick={() => mutate((current) => ({ ...current, paymentStages: [...current.paymentStages, { title: "Новый этап", percent: 0, amount: 0, dueDate: null, paidAt: null, status: "planned" }] }))} className={smallButton}><Plus className="h-3.5 w-3.5" /> Этап</button>}>
              <div className="space-y-2">{form.paymentStages.map((stage, index) => <div key={index} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2"><div className="grid grid-cols-[minmax(0,1fr)_76px_104px_38px] gap-2"><input aria-label="Название этапа оплаты" value={stage.title} onChange={(event) => mutate((current) => ({ ...current, paymentStages: current.paymentStages.map((row, rowIndex) => rowIndex === index ? { ...row, title: event.target.value } : row) }))} className={inputClass} /><input aria-label="Процент оплаты" type="number" min={0} max={100} value={stage.percent} onChange={(event) => mutate((current) => ({ ...current, paymentStages: current.paymentStages.map((row, rowIndex) => rowIndex === index ? { ...row, percent: Number(event.target.value) } : row) }))} className={`${inputClass} text-right`} /><input aria-label="Сумма оплаты" type="number" min={0} value={stage.amount} onChange={(event) => mutate((current) => ({ ...current, paymentStages: current.paymentStages.map((row, rowIndex) => rowIndex === index ? { ...row, amount: Number(event.target.value) } : row) }))} className={`${inputClass} text-right`} /><button type="button" onClick={() => mutate((current) => ({ ...current, paymentStages: current.paymentStages.filter((_, rowIndex) => rowIndex !== index) }))} className="rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Удалить этап оплаты"><Trash2 className="mx-auto h-4 w-4" /></button></div><div className="mt-2 grid grid-cols-2 gap-2"><label className="space-y-1 text-[9px] text-slate-400">Срок оплаты<input aria-label="Срок оплаты" type="date" value={stage.dueDate ?? ""} onChange={(event) => mutate((current) => ({ ...current, paymentStages: current.paymentStages.map((row, rowIndex) => rowIndex === index ? { ...row, dueDate: event.target.value || null } : row) }))} className={inputClass} /></label><label className="space-y-1 text-[9px] text-slate-400">Статус<select aria-label="Статус оплаты" value={stage.status} onChange={(event) => mutate((current) => ({ ...current, paymentStages: current.paymentStages.map((row, rowIndex) => rowIndex === index ? { ...row, status: event.target.value as typeof row.status, paidAt: event.target.value === "paid" ? new Date().toISOString() : null } : row) }))} className={inputClass}><option value="planned">Запланирован</option><option value="paid">Оплачен</option><option value="cancelled">Отменён</option></select></label></div></div>)}</div>
              <div className="mt-3 flex justify-between border-t border-slate-100 pt-3 text-[10px]"><span className="text-slate-400">Распределено</span><span className="font-bold text-slate-700">{form.paymentStages.filter((stage) => stage.status !== "cancelled").reduce((sum, stage) => sum + stage.percent, 0)}%</span></div>
            </EditorSection>

            <EditorSection icon={Ship} title="Логистика" action={<button type="button" onClick={() => mutate((current) => ({ ...current, logisticsStages: [...current.logisticsStages, { title: "Карго", provider: "", dueDate: null, completedAt: null, cost: 0, status: "planned" }] }))} className={smallButton}><Plus className="h-3.5 w-3.5" /> Этап</button>}>
              {form.logisticsStages.length === 0 ? <div className="py-4 text-center text-[11px] text-slate-400">Этапы логистики не добавлены.</div> : <div className="space-y-2">{form.logisticsStages.map((stage, index) => <div key={index} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2"><div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_104px_38px] gap-2"><input aria-label="Название этапа логистики" value={stage.title} onChange={(event) => mutate((current) => ({ ...current, logisticsStages: current.logisticsStages.map((row, rowIndex) => rowIndex === index ? { ...row, title: event.target.value } : row) }))} className={inputClass} /><input aria-label="Перевозчик" value={stage.provider} onChange={(event) => mutate((current) => ({ ...current, logisticsStages: current.logisticsStages.map((row, rowIndex) => rowIndex === index ? { ...row, provider: event.target.value } : row) }))} placeholder="Перевозчик" className={inputClass} /><input aria-label="Стоимость логистики" type="number" min={0} value={stage.cost} onChange={(event) => mutate((current) => ({ ...current, logisticsStages: current.logisticsStages.map((row, rowIndex) => rowIndex === index ? { ...row, cost: Number(event.target.value) } : row) }))} className={`${inputClass} text-right`} /><button type="button" onClick={() => mutate((current) => ({ ...current, logisticsStages: current.logisticsStages.filter((_, rowIndex) => rowIndex !== index) }))} className="rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Удалить этап логистики"><Trash2 className="mx-auto h-4 w-4" /></button></div><div className="mt-2 grid grid-cols-2 gap-2"><label className="space-y-1 text-[9px] text-slate-400">Плановая дата<input aria-label="Плановая дата логистики" type="date" value={stage.dueDate ?? ""} onChange={(event) => mutate((current) => ({ ...current, logisticsStages: current.logisticsStages.map((row, rowIndex) => rowIndex === index ? { ...row, dueDate: event.target.value || null } : row) }))} className={inputClass} /></label><label className="space-y-1 text-[9px] text-slate-400">Статус<select aria-label="Статус логистики" value={stage.status} onChange={(event) => mutate((current) => ({ ...current, logisticsStages: current.logisticsStages.map((row, rowIndex) => rowIndex === index ? { ...row, status: event.target.value as typeof row.status, completedAt: event.target.value === "done" ? new Date().toISOString() : null } : row) }))} className={inputClass}><option value="planned">Запланирован</option><option value="in_progress">В работе</option><option value="done">Завершён</option><option value="cancelled">Отменён</option></select></label></div></div>)}</div>}
            </EditorSection>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
            <EditorSection icon={ReceiptRussianRuble} title="Дополнительные расходы" action={<button type="button" onClick={() => mutate((current) => ({ ...current, expenses: [...current.expenses, { title: "Новый расход", amount: 0, currency: "RUB" }] }))} className={smallButton}><Plus className="h-3.5 w-3.5" /> Расход</button>}>
              {form.expenses.length === 0 ? <div className="py-4 text-center text-[11px] text-slate-400">Дополнительных расходов нет.</div> : <div className="space-y-2">{form.expenses.map((expense, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_120px_80px_38px] gap-2"><input aria-label="Название расхода" value={expense.title} onChange={(event) => mutate((current) => ({ ...current, expenses: current.expenses.map((row, rowIndex) => rowIndex === index ? { ...row, title: event.target.value } : row) }))} className={inputClass} /><input aria-label="Сумма расхода" type="number" min={0} value={expense.amount} onChange={(event) => mutate((current) => ({ ...current, expenses: current.expenses.map((row, rowIndex) => rowIndex === index ? { ...row, amount: Number(event.target.value) } : row) }))} className={`${inputClass} text-right`} /><select aria-label="Валюта расхода" value={expense.currency} onChange={(event) => mutate((current) => ({ ...current, expenses: current.expenses.map((row, rowIndex) => rowIndex === index ? { ...row, currency: event.target.value as PurchaseOrderInput["currency"] } : row) }))} className={inputClass}>{[...new Set(["RUB", form.currency])].map((value) => <option key={value}>{value}</option>)}</select><button type="button" onClick={() => mutate((current) => ({ ...current, expenses: current.expenses.filter((_, rowIndex) => rowIndex !== index) }))} className="rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Удалить расход"><Trash2 className="mx-auto h-4 w-4" /></button></div>)}</div>}
              <label className="mt-3 block space-y-1.5 text-[10px] font-medium text-slate-500">Комментарий<textarea value={form.note} onChange={(event) => mutate((current) => ({ ...current, note: event.target.value }))} rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /></label>
            </EditorSection>

            <section className="rounded-xl bg-slate-900 p-4 text-white shadow-lg"><div className="text-xs font-semibold">Итог заказа</div><div className="mt-4 space-y-2 text-[11px]"><div className="flex justify-between text-slate-300"><span>Товар</span><span>{formatMoney(totals?.goodsRub ?? 0)}</span></div><div className="flex justify-between text-slate-300"><span>Логистика</span><span>{formatMoney(totals?.logisticsRub ?? 0)}</span></div><div className="flex justify-between text-slate-300"><span>Расходы</span><span>{formatMoney(totals?.expensesRub ?? 0)}</span></div><div className="flex justify-between border-t border-slate-700 pt-3 text-base font-bold"><span>Итого</span><span>{formatMoney(totals?.totalRub ?? 0)}</span></div><div className="flex justify-between text-[10px] text-slate-400"><span>{totals?.quantity.toLocaleString("ru-RU") ?? 0} шт</span><span>{formatMoney(totals?.goodsCurrency ?? 0, form.currency)}</span></div></div></section>
          </div>

          {history ? <EditorSection icon={History} title="История изменений"><div className="space-y-2">{history.length === 0 ? <div className="text-[11px] text-slate-400">История пока пуста.</div> : history.map((entry) => <div key={entry.id} className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-[10px]"><span className="font-semibold text-slate-700">{entry.action === "created" ? "Создан" : entry.action === "receiving_created" ? "Передан в приёмку" : entry.action === "received" ? "Принят полностью" : "Изменён"}</span><span className="text-slate-400">{entry.actor || "система"}</span><span className="ml-auto tabular-nums text-slate-400">{new Date(entry.createdAt).toLocaleString("ru-RU")}</span></div>)}</div></EditorSection> : null}
        </div> : null}
      </SlidePanel>
    </div>
  );
}
