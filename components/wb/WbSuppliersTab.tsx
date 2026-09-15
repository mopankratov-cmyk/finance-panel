"use client";

import { Building2, FileText, Loader2, Plus, Save } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { SlidePanel } from "@/components/ui/SlidePanel";
import { LoadingBanner, useElapsedSeconds } from "@/components/ui/LoadingState";
import { PURCHASE_CURRENCIES, type PurchaseCurrency } from "@/lib/purchases/order";
import type { SupplierInput, SupplierView } from "@/lib/purchases/suppliers";
import { OWNERSHIP_TRANSFER_MOMENTS, type OwnershipTransferMoment, type SupplierContractInput, type SupplierContractView } from "@/lib/purchases/supplierContracts";
import type { LegalEntityRow } from "@/lib/warehouse/entityAccess";
import { WbEmptyState, WbErrorState } from "./WbModuleHeader";

const OWNERSHIP_LABEL: Record<OwnershipTransferMoment, string> = {
  after_supplier_shipment: "После отгрузки поставщиком",
  after_carrier: "После передачи перевозчику",
  after_customs: "После таможни",
  after_warehouse_receipt: "После поступления на склад",
  other: "Другое (см. комментарий)",
};

function EditorSection({ icon: Icon, title, action, children }: { icon: typeof Building2; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex min-h-11 items-center gap-2 border-b border-slate-100 px-3">
        <Icon className="h-4 w-4 text-violet-600" />
        <h3 className="text-xs font-semibold text-slate-800">{title}</h3>
        <div className="ml-auto">{action}</div>
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

/**
 * Справочник поставщиков.
 *
 * Общий на компанию — сюда не приходит `cabinetId`: один поставщик шьёт для
 * нескольких юрлиц и кабинетов сразу, и список одинаков для всех. Заказ
 * фабрике (WbPurchaseOrdersTab) читает этот же список для выбора поставщика.
 */

interface Props {
  canWrite: boolean;
}

const EMPTY_FORM: SupplierInput = {
  name: "",
  country: "",
  taxId: "",
  currency: "CNY",
  productionDays: 45,
  minOrderQty: null,
  contactName: "",
  contactPhone: "",
  note: "",
  isActive: true,
};

const inputClass = "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100";

const emptyContractForm = (supplierId: string, legalEntityId: string): SupplierContractInput => ({
  supplierId,
  legalEntityId,
  number: "",
  signedAt: null,
  currency: "CNY",
  prepaymentPercent: null,
  prepaymentTerms: "",
  finalPaymentTerms: "",
  productionDays: null,
  ownershipTransferMoment: "after_customs",
  ownershipTransferNote: "",
  countryOfOrigin: "",
  deliveryTerms: "",
  transportTerms: "",
  customsTerms: "",
  isActive: true,
  note: "",
});

export function WbSuppliersTab({ canWrite }: Props) {
  const [suppliers, setSuppliers] = useState<SupplierView[]>([]);
  const [loading, setLoading] = useState(true);
  const elapsed = useElapsedSeconds(loading);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SupplierInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Договоры (§4.3, §27.11 ТЗ) — пара (поставщик, юрлицо), поэтому нужен
  // список юрлиц. У нового (ещё не сохранённого) поставщика договоров быть
  // не может — секция появляется только для уже сохранённой карточки.
  const [entities, setEntities] = useState<LegalEntityRow[]>([]);
  const [contracts, setContracts] = useState<SupplierContractView[]>([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [contractsError, setContractsError] = useState<string | null>(null);
  const [contractForm, setContractForm] = useState<SupplierContractInput | null>(null);
  const [contractSaving, setContractSaving] = useState(false);
  const [contractSaveError, setContractSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/warehouse/entities", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { data: LegalEntityRow[] | null }) => setEntities(body.data ?? []))
      .catch(() => {});
  }, []);

  const loadContracts = useCallback(async (supplierId: string) => {
    setContractsLoading(true);
    setContractsError(null);
    try {
      const response = await fetch(`/api/supplier-contracts?supplierId=${encodeURIComponent(supplierId)}`, { cache: "no-store" });
      const body = await response.json() as { data: { contracts?: SupplierContractView[] } | null; error: string | null };
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      setContracts(body.data?.contracts ?? []);
    } catch (error) {
      setContractsError(error instanceof Error ? error.message : "Не удалось загрузить договоры");
    } finally {
      setContractsLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/suppliers", { cache: "no-store" });
      const body = await response.json() as { data: { suppliers?: SupplierView[] } | null; error: string | null };
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      setSuppliers(body.data?.suppliers ?? []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Не удалось загрузить поставщиков");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const startNew = () => { setForm({ ...EMPTY_FORM }); setSaveError(null); setContracts([]); setContractForm(null); setOpen(true); };
  const editSupplier = (supplier: SupplierView) => {
    setForm({ ...supplier });
    setSaveError(null);
    setContractForm(null);
    setContractSaveError(null);
    setOpen(true);
    void loadContracts(supplier.id);
  };
  // contractSaving тоже держит панель открытой: иначе закрыть-открыть другого
  // поставщика за время одного round-trip saveContract() гонится с
  // loadContracts() нового поставщика и может переписать список чужими
  // договорами.
  const closeEditor = () => { if (!saving && !contractSaving) { setOpen(false); setForm(null); setContracts([]); setContractForm(null); } };

  const startNewContract = () => {
    if (!form?.id) return;
    setContractSaveError(null);
    setContractForm(emptyContractForm(form.id, entities[0]?.id ?? ""));
  };
  const editContract = (contract: SupplierContractView) => { setContractSaveError(null); setContractForm({ ...contract }); };
  const mutateContract = (updater: (current: SupplierContractInput) => SupplierContractInput) =>
    setContractForm((current) => current ? updater(current) : current);

  const saveContract = async () => {
    if (!contractForm) return;
    setContractSaving(true);
    setContractSaveError(null);
    try {
      const isNew = !contractForm.id;
      const response = await fetch(isNew ? "/api/supplier-contracts" : `/api/supplier-contracts/${contractForm.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contractForm),
      });
      const body = await response.json() as { data: { contract?: SupplierContractView } | null; error: string | null };
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      setContractForm(null);
      await loadContracts(contractForm.supplierId);
    } catch (error) {
      setContractSaveError(error instanceof Error ? error.message : "Не удалось сохранить договор");
    } finally {
      setContractSaving(false);
    }
  };

  const mutate = (updater: (current: SupplierInput) => SupplierInput) => setForm((current) => current ? updater(current) : current);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setSaveError(null);
    try {
      const isNew = !form.id;
      const response = await fetch(isNew ? "/api/suppliers" : `/api/suppliers/${form.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json() as { data: { supplier?: SupplierView } | null; error: string | null };
      if (!response.ok || body.error) throw new Error(body.error || `Ошибка ${response.status}`);
      await load();
      setOpen(false);
      setForm(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Не удалось сохранить поставщика");
    } finally {
      setSaving(false);
    }
  };

  const shown = suppliers.filter((supplier) => showInactive || supplier.isActive);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Building2 className="h-4 w-4 text-violet-600" /> Поставщики</div>
          <p className="mt-1 text-[11px] text-slate-500">Общий справочник компании — не по кабинету и не по юрлицу. Из него выбирают поставщика в заказе фабрике.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex min-h-11 items-center gap-1.5 text-[11px] text-slate-500 lg:min-h-0"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} className="h-3.5 w-3.5 accent-violet-600" /> показать выключенных</label>
          <button type="button" onClick={startNew} disabled={!canWrite} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-violet-700 disabled:opacity-50 lg:min-h-9"><Plus className="h-4 w-4" /> Поставщик</button>
        </div>
      </div>

      {loading ? <LoadingBanner seconds={elapsed} hint="поставщики" /> : loadError ? <WbErrorState message={loadError} onRetry={() => void load()} /> : shown.length === 0 ? (
        <WbEmptyState>{suppliers.length === 0 ? "Поставщиков пока нет. Заказ фабрике будет держать поставщика текстом, пока не заведёте карточку." : "Все поставщики выключены — отметьте «показать выключенных», чтобы их увидеть."}</WbEmptyState>
      ) : (
        <div className="scroll-x rounded-xl border border-slate-200 bg-white">
          <table className="min-w-[760px] w-full border-collapse text-[11px]">
            <thead><tr className="h-9 border-b border-slate-200 bg-slate-50 text-slate-500"><th className="px-3 text-left font-semibold">Поставщик</th><th className="px-3 text-left font-semibold">Страна</th><th className="px-3 text-left font-semibold">Валюта</th><th className="px-3 text-right font-semibold">Срок пр-ва</th><th className="px-3 text-right font-semibold">Мин. партия</th><th className="px-3 text-left font-semibold">Контакт</th></tr></thead>
            <tbody>{shown.map((supplier) => (
              <tr key={supplier.id} onClick={() => editSupplier(supplier)} className={`h-11 cursor-pointer border-b border-slate-100 hover:bg-violet-50/40 ${supplier.isActive ? "" : "opacity-50"}`}>
                <td className="px-3"><div className="font-semibold text-slate-800">{supplier.name}</div>{supplier.taxId ? <div className="text-[9px] text-slate-400">ИНН/налог. номер {supplier.taxId}</div> : null}</td>
                <td className="px-3 text-slate-600">{supplier.country || "—"}</td>
                <td className="px-3 font-mono text-slate-600">{supplier.currency}</td>
                <td className="px-3 text-right tabular-nums text-slate-600">{supplier.productionDays} дн.</td>
                <td className="px-3 text-right tabular-nums text-slate-600">{supplier.minOrderQty != null ? `${supplier.minOrderQty.toLocaleString("ru-RU")} шт` : "—"}</td>
                <td className="px-3 text-slate-600">{supplier.contactName || supplier.contactPhone || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <SlidePanel
        open={open}
        onClose={closeEditor}
        title={form?.id ? form.name : "Новый поставщик"}
        header={form ? <div className="flex min-w-0 flex-1 items-center justify-between gap-3 pr-2">
          <div className="min-w-0"><h2 className="truncate text-base font-bold text-slate-900">{form.id ? form.name || "Поставщик" : "Новый поставщик"}</h2></div>
          <button type="button" onClick={() => void save()} disabled={saving || !form.name.trim()} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Сохранить</button>
        </div> : undefined}
      >
        {form ? <div className="space-y-3 p-0.5">
          {saveError ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{saveError}</div> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Название<input value={form.name} onChange={(event) => mutate((current) => ({ ...current, name: event.target.value }))} placeholder="Guangzhou Feiyang Garment Co." className={inputClass} /></label>
            <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Страна<input value={form.country} onChange={(event) => mutate((current) => ({ ...current, country: event.target.value }))} placeholder="Китай" className={inputClass} /></label>
            <label className="space-y-1.5 text-[10px] font-medium text-slate-500">ИНН / налоговый номер<input value={form.taxId} onChange={(event) => mutate((current) => ({ ...current, taxId: event.target.value }))} className={inputClass} /></label>
            <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Валюта расчётов<select value={form.currency} onChange={(event) => mutate((current) => ({ ...current, currency: event.target.value as PurchaseCurrency }))} className={inputClass}>{PURCHASE_CURRENCIES.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Срок производства, дней<input type="number" min={0} max={365} value={form.productionDays} onChange={(event) => mutate((current) => ({ ...current, productionDays: Number(event.target.value) }))} className={inputClass} /></label>
            <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Минимальная партия, шт<input type="number" min={0} value={form.minOrderQty ?? ""} onChange={(event) => mutate((current) => ({ ...current, minOrderQty: event.target.value === "" ? null : Number(event.target.value) }))} placeholder="не задана" className={inputClass} /></label>
            <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Контактное лицо<input value={form.contactName} onChange={(event) => mutate((current) => ({ ...current, contactName: event.target.value }))} className={inputClass} /></label>
            <label className="space-y-1.5 text-[10px] font-medium text-slate-500">Телефон / мессенджер<input value={form.contactPhone} onChange={(event) => mutate((current) => ({ ...current, contactPhone: event.target.value }))} className={inputClass} /></label>
          </div>
          <label className="block space-y-1.5 text-[10px] font-medium text-slate-500">Комментарий<textarea value={form.note} onChange={(event) => mutate((current) => ({ ...current, note: event.target.value }))} rows={3} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /></label>
          {form.id ? (
            <label className="flex min-h-11 items-center gap-2 text-[11px] text-slate-600 lg:min-h-0">
              <input type="checkbox" checked={form.isActive} onChange={(event) => mutate((current) => ({ ...current, isActive: event.target.checked }))} className="h-4 w-4 accent-violet-600" />
              Активен — предлагается при создании нового заказа
            </label>
          ) : null}

          {form.id ? (
            <EditorSection
              icon={FileText}
              title={`Договоры${contracts.length ? ` (${contracts.length})` : ""}`}
              action={<button type="button" onClick={startNewContract} disabled={!canWrite || entities.length === 0 || Boolean(contractForm)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 hover:border-violet-300 disabled:opacity-50"><Plus className="h-3.5 w-3.5" /> Договор</button>}
            >
              {entities.length === 0 ? <div className="text-[11px] text-slate-400">Нет доступных юрлиц.</div> : contractsLoading ? (
                <div className="text-[11px] text-slate-400">Загрузка…</div>
              ) : contractsError ? (
                <div className="text-[11px] text-rose-600">{contractsError}</div>
              ) : (
                <div className="space-y-2">
                  {contracts.length === 0 && !contractForm ? <div className="text-[11px] text-slate-400">Договоров пока нет — момент перехода права собственности не задан ни для одного юрлица.</div> : null}
                  {contracts.map((contract) => {
                    const entityName = entities.find((entity) => entity.id === contract.legalEntityId)?.name ?? "юрлицо";
                    return (
                      <button
                        type="button"
                        key={contract.id}
                        onClick={() => editContract(contract)}
                        className={`block w-full rounded-lg border px-3 py-2 text-left text-[11px] hover:border-violet-300 ${contract.isActive ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50 opacity-60"}`}
                      >
                        <div className="font-semibold text-slate-800">№ {contract.number || "без номера"} · {entityName}</div>
                        <div className="mt-0.5 text-slate-500">
                          {contract.signedAt ? `от ${contract.signedAt} · ` : ""}
                          {contract.prepaymentPercent != null ? `предоплата ${contract.prepaymentPercent}% · ` : ""}
                          переход права — {OWNERSHIP_LABEL[contract.ownershipTransferMoment].toLowerCase()}
                          {!contract.isActive ? " · архивный" : ""}
                        </div>
                      </button>
                    );
                  })}

                  {contractForm ? (
                    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3">
                      {contractSaveError ? <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{contractSaveError}</div> : null}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="space-y-1 text-[10px] font-medium text-slate-500">Юрлицо<select value={contractForm.legalEntityId} onChange={(event) => mutateContract((current) => ({ ...current, legalEntityId: event.target.value }))} className={inputClass}>{entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>
                        <label className="space-y-1 text-[10px] font-medium text-slate-500">Номер договора<input value={contractForm.number} onChange={(event) => mutateContract((current) => ({ ...current, number: event.target.value }))} placeholder="2026-CN-08" className={inputClass} /></label>
                        <label className="space-y-1 text-[10px] font-medium text-slate-500">Дата подписания<input type="date" value={contractForm.signedAt ?? ""} onChange={(event) => mutateContract((current) => ({ ...current, signedAt: event.target.value || null }))} className={inputClass} /></label>
                        <label className="space-y-1 text-[10px] font-medium text-slate-500">Валюта<select value={contractForm.currency} onChange={(event) => mutateContract((current) => ({ ...current, currency: event.target.value as PurchaseCurrency }))} className={inputClass}>{PURCHASE_CURRENCIES.map((value) => <option key={value}>{value}</option>)}</select></label>
                        <label className="space-y-1 text-[10px] font-medium text-slate-500">Предоплата, %<input type="number" min={0} max={100} value={contractForm.prepaymentPercent ?? ""} onChange={(event) => mutateContract((current) => ({ ...current, prepaymentPercent: event.target.value === "" ? null : Number(event.target.value) }))} placeholder="не задана" className={inputClass} /></label>
                        <label className="space-y-1 text-[10px] font-medium text-slate-500">Срок производства, дней<input type="number" min={0} max={365} value={contractForm.productionDays ?? ""} onChange={(event) => mutateContract((current) => ({ ...current, productionDays: event.target.value === "" ? null : Number(event.target.value) }))} placeholder="как у поставщика" className={inputClass} /></label>
                        <label className="space-y-1 text-[10px] font-medium text-slate-500 sm:col-span-2">Момент перехода права собственности<select value={contractForm.ownershipTransferMoment} onChange={(event) => mutateContract((current) => ({ ...current, ownershipTransferMoment: event.target.value as OwnershipTransferMoment }))} className={inputClass}>{OWNERSHIP_TRANSFER_MOMENTS.map((value) => <option key={value} value={value}>{OWNERSHIP_LABEL[value]}</option>)}</select></label>
                        <label className="space-y-1 text-[10px] font-medium text-slate-500 sm:col-span-2">Страна происхождения<input value={contractForm.countryOfOrigin} onChange={(event) => mutateContract((current) => ({ ...current, countryOfOrigin: event.target.value }))} className={inputClass} /></label>
                        <label className="space-y-1 text-[10px] font-medium text-slate-500 sm:col-span-2">Условия предоплаты/расчёта<input value={contractForm.prepaymentTerms} onChange={(event) => mutateContract((current) => ({ ...current, prepaymentTerms: event.target.value }))} placeholder="30% предоплата, остаток перед отгрузкой" className={inputClass} /></label>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <label className="flex min-h-9 items-center gap-2 text-[11px] text-slate-600">
                          <input type="checkbox" checked={contractForm.isActive} onChange={(event) => mutateContract((current) => ({ ...current, isActive: event.target.checked }))} className="h-3.5 w-3.5 accent-violet-600" />
                          Активен
                        </label>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => { setContractForm(null); setContractSaveError(null); }} className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-[11px] text-slate-600">Отмена</button>
                          <button type="button" onClick={() => void saveContract()} disabled={contractSaving || !contractForm.number.trim() || !contractForm.legalEntityId} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-[11px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{contractSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Сохранить</button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </EditorSection>
          ) : null}
        </div> : null}
      </SlidePanel>
    </div>
  );
}
