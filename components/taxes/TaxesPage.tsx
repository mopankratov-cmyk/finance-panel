"use client";

import { FinanceTabs } from "@/components/FinanceTabs";
import { ActionableError } from "@/components/ui/ActionableError";
import { LoadingBanner, useElapsedSeconds } from "@/components/ui/LoadingState";
import { formatRub } from "@/lib/analytics/format";
import { COMPANY_TAX_SYSTEMS, COMPANY_VAT_MODES, type CompanyTaxSystem, type CompanyVatMode } from "@/lib/finance/companyTax";
import { calculateTaxPeriod, vatAllowsInputDeduction, type UsnExpenseStatus, type VatDeductionStatus, type VatDocumentStatus } from "@/lib/finance/taxCalculation";
import { AlertTriangle, Calculator, Check, FileCheck2, Loader2, Plus, Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type TaxPaymentKind = "operating_expense" | "insurance_contribution" | "usn_tax_payment" | "other_tax";
type Company = { id: string; name: string; groupName: string; taxSystem: CompanyTaxSystem | null; vatMode: CompanyVatMode | null; taxRate: number | null; taxAdditionalRate: number | null };
type TaxPayment = { id: string; date: string; name: string; grossAmount: number; category: string; counterparty: string; source: string; suggestedVatRate: number | null; suggestedVatAmount: number; suggestedVatKind: string; suggestedTaxKind: TaxPaymentKind; vatRate: number | null; vatAmount: number; vatDocumentStatus: VatDocumentStatus; vatDeductionStatus: VatDeductionStatus; usnExpenseStatus: UsnExpenseStatus; taxPaymentKind: TaxPaymentKind; note: string; saved: boolean };
type MarketplaceTaxDocument = { id: string; marketplace: "wb" | "ozon" | "other"; documentDate: string; documentNumber: string; grossExpenseAmount: number; vatRate: number | null; vatAmount: number; vatDocumentStatus: VatDocumentStatus; vatDeductionStatus: VatDeductionStatus; usnExpenseStatus: UsnExpenseStatus; note: string; saved: boolean };
type TaxResponse = { companies: Company[]; selectedCompany: Company | null; payments: TaxPayment[]; taxRegisterAvailable: boolean; taxSettingsAvailable: boolean; vatEffectiveFrom: string | null; wbReportedInputVat: number | null; yearSettings: { fixedInsuranceContributions: number; insuranceReductionLimitPercent: number; priorYearLoss: number; recognizedCogs: number; outputVatConfirmed: number | null; note: string }; marketplaceTaxDocuments: MarketplaceTaxDocument[]; error?: string };
type MarketplaceResponse = { wb?: { revenue_after_spp?: number; revenue_before_spp: number; commission: number; acquiring: number; ad: number; other: number; cogs: number; logistics: number | null; storage: number | null; error?: string }; ozon?: { revenue: number; commission: number; delivery: number; services: number; cogs: number; error?: string; noCabinet?: boolean }; warnings?: string[]; error?: string };
type MarketplaceTotals = { income: number; serviceExpenses: number; cogs: number; warnings: string[] };

const money = (value: number) => Math.round((Number(value) || 0) * 100) / 100;
const todayMsk = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const fieldClass = "min-h-11 rounded-lg border border-slate-300 bg-white px-2";

function rangeFor(asOf: string) {
  const year = Number(asOf.slice(0, 4));
  const count = Number(asOf.slice(5, 7));
  return { year, from: `${year}-01-01`, to: asOf, months: Array.from({ length: count }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`) };
}

async function json<T extends { error?: string }>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T;
  if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
  return body;
}

function totals(source: MarketplaceResponse): MarketplaceTotals {
  const wb = source.wb && !source.wb.error ? source.wb : null;
  const ozon = source.ozon && !source.ozon.error && !source.ozon.noCabinet ? source.ozon : null;
  return {
    income: money(Number(wb?.revenue_after_spp ?? wb?.revenue_before_spp ?? 0) + Number(ozon?.revenue ?? 0)),
    serviceExpenses: money(Number(wb?.commission ?? 0) + Number(wb?.acquiring ?? 0) + Number(wb?.ad ?? 0) + Number(wb?.other ?? 0) + Number(wb?.logistics ?? 0) + Number(wb?.storage ?? 0) + Number(ozon?.commission ?? 0) + Number(ozon?.delivery ?? 0) + Number(ozon?.services ?? 0)),
    cogs: money(Number(wb?.cogs ?? 0) + Number(ozon?.cogs ?? 0)),
    warnings: source.warnings ?? [],
  };
}

function sumTotals(values: MarketplaceTotals[]): MarketplaceTotals {
  return { income: money(values.reduce((sum, value) => sum + value.income, 0)), serviceExpenses: money(values.reduce((sum, value) => sum + value.serviceExpenses, 0)), cogs: money(values.reduce((sum, value) => sum + value.cogs, 0)), warnings: [...new Set(values.flatMap((value) => value.warnings))] };
}

function blankDocument(date: string): MarketplaceTaxDocument {
  return { id: crypto.randomUUID(), marketplace: "wb", documentDate: date, documentNumber: "", grossExpenseAmount: 0, vatRate: null, vatAmount: 0, vatDocumentStatus: "missing", vatDeductionStatus: "pending", usnExpenseStatus: "pending", note: "", saved: false };
}

function Metric({ label, value, note, tone = "slate" }: { label: string; value: number; note?: string; tone?: "slate" | "emerald" | "amber" | "rose" }) {
  const colors = { slate: "border-slate-200 bg-white", emerald: "border-emerald-200 bg-emerald-50", amber: "border-amber-200 bg-amber-50", rose: "border-rose-200 bg-rose-50" };
  return <div className={`rounded-xl border p-3 shadow-sm ${colors[tone]}`}><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-xl font-extrabold tabular-nums text-slate-950">{formatRub(value)}</div>{note ? <p className="mt-1 text-xs leading-4 text-slate-600">{note}</p> : null}</div>;
}

const usnOptions = <><option value="pending">Не проверено</option><option value="included">Включить</option><option value="excluded">Не учитывать</option></>;
const documentOptions = <><option value="missing">Нет документа</option><option value="received">УПД/СФ получен</option><option value="not_required">Не требуется</option></>;
const deductionOptions = <><option value="pending">Не проверено</option><option value="eligible">К вычету</option><option value="not_eligible">Не принимать</option></>;
const rateOptions = <><option value="">—</option>{[0, 5, 7, 10, 20, 22].map((rate) => <option key={rate} value={rate}>{rate}%</option>)}</>;

export function TaxesPage() {
  const today = useMemo(() => todayMsk(), []);
  const [asOf, setAsOf] = useState(today);
  const [companyId, setCompanyId] = useState("");
  const [register, setRegister] = useState<TaxResponse | null>(null);
  const [byMonth, setByMonth] = useState<Record<string, MarketplaceTotals>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [reload, setReload] = useState(0);
  const elapsed = useElapsedSeconds(loading);
  const dates = useMemo(() => rangeFor(asOf), [asOf]);

  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setError("");
    const load = async () => {
      const taxData = await fetch(`/api/finance/taxes?${new URLSearchParams({ from: dates.from, to: dates.to, company: companyId })}`, { cache: "no-store", signal: controller.signal }).then(json<TaxResponse>);
      if (!companyId && taxData.companies[0]) { if (active) { setRegister(taxData); setCompanyId(taxData.companies[0].id); } return; }
      const loaded: Record<string, MarketplaceTotals> = {};
      for (let start = 0; start < dates.months.length; start += 3) {
        const batch = await Promise.all(dates.months.slice(start, start + 3).map(async (month) => {
          const params = new URLSearchParams({ month, ...(companyId ? { company: companyId } : {}), ...(month === asOf.slice(0, 7) ? { to: asOf } : {}) });
          return [month, totals(await fetch(`/api/opiu/mp?${params}`, { cache: "no-store", signal: controller.signal }).then(json<MarketplaceResponse>))] as const;
        }));
        batch.forEach(([month, value]) => { loaded[month] = value; });
      }
      if (active) { setRegister(taxData); setByMonth(loaded); }
    };
    void load().catch((reason) => { if (active && !(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Не удалось рассчитать налоги"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [asOf, companyId, dates.from, dates.months, dates.to, reload]);

  const company = register?.selectedCompany ?? null;
  const marketplace = sumTotals(dates.months.map((month) => byMonth[month] ?? { income: 0, serviceExpenses: 0, cogs: 0, warnings: [] }));
  const effectiveMonth = (register?.vatEffectiveFrom ?? `${dates.year}-01-01`).slice(0, 7);
  const taxableIncome = money(dates.months.reduce((sum, month) => month >= effectiveMonth ? sum + (byMonth[month]?.income ?? 0) : sum, 0));
  const documents = register?.marketplaceTaxDocuments ?? [];
  const deductionAllowed = vatAllowsInputDeduction(company?.vatMode ?? null);
  const eligibleDocument = (document: MarketplaceTaxDocument) => deductionAllowed && document.vatDocumentStatus === "received" && document.vatDeductionStatus === "eligible";
  const confirmedMpVat = money(documents.reduce((sum, document) => eligibleDocument(document) ? sum + document.vatAmount : sum, 0));
  const mpVatInUsn = money(documents.reduce((sum, document) => eligibleDocument(document) && document.usnExpenseStatus === "included" ? sum + document.vatAmount : sum, 0));
  const mpExpenses = money(documents.reduce((sum, document) => document.usnExpenseStatus === "included" ? sum + document.grossExpenseAmount : sum, 0));
  const payments = register?.payments ?? [];
  const operatingPayments = payments.filter((payment) => payment.taxPaymentKind === "operating_expense");
  const bankInsurance = money(payments.reduce((sum, payment) => payment.taxPaymentKind === "insurance_contribution" && payment.usnExpenseStatus === "included" ? sum + payment.grossAmount : sum, 0));
  const contributions = money((register?.yearSettings.fixedInsuranceContributions ?? 0) + bankInsurance);
  const taxPaid = money(payments.reduce((sum, payment) => payment.saved && payment.taxPaymentKind === "usn_tax_payment" ? sum + payment.grossAmount : sum, 0));
  const calculation = calculateTaxPeriod({
    taxSystem: company?.taxSystem ?? null, taxRate: company?.taxRate ?? null, vatMode: company?.vatMode ?? null,
    marketplaceIncomeGross: marketplace.income, vatTaxableIncomeGross: taxableIncome,
    outputVatConfirmed: register?.yearSettings.outputVatConfirmed,
    marketplaceExpensesGross: (register?.yearSettings.recognizedCogs ?? 0) + mpExpenses, marketplaceInputVatConfirmed: confirmedMpVat,
    marketplaceInputVatInUsnExpenses: mpVatInUsn, insuranceContributions: contributions,
    insuranceReductionLimitPercent: register?.yearSettings.insuranceReductionLimitPercent ?? 0,
    priorYearLoss: register?.yearSettings.priorYearLoss ?? 0,
    bankExpenses: operatingPayments.map((payment) => ({ grossAmount: payment.grossAmount, vatAmount: payment.vatAmount, vatDocumentStatus: payment.vatDocumentStatus, vatDeductionStatus: payment.vatDeductionStatus, usnExpenseStatus: payment.usnExpenseStatus })),
  });
  const incomeExpense = company?.taxSystem === "usn_income_expense" || company?.taxSystem === "ausn_income_expense";
  const accruedUsn = incomeExpense && asOf.endsWith("-12-31") ? Math.max(calculation.usnCalculated, calculation.minimumTaxControl) : calculation.usnCalculated;
  const remainingUsn = money(Math.max(0, accruedUsn - taxPaid));
  const regionalExpense = money(calculation.usnIncome * Math.max(0, company?.taxAdditionalRate ?? 0) / 100);

  const updatePayment = (id: string, patch: Partial<TaxPayment>) => setRegister((current) => current ? { ...current, payments: current.payments.map((payment) => payment.id === id ? { ...payment, ...patch, saved: false } : payment) } : current);
  const updateDocument = (id: string, patch: Partial<MarketplaceTaxDocument>) => setRegister((current) => current ? { ...current, marketplaceTaxDocuments: current.marketplaceTaxDocuments.map((document) => document.id === id ? { ...document, ...patch, saved: false } : document) } : current);

  const savePayment = async (payment: TaxPayment) => {
    setSavingId(payment.id); setError("");
    try {
      await fetch("/api/finance/taxes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId: payment.id, vatRate: payment.vatRate, vatAmount: payment.vatAmount, vatDocumentStatus: payment.vatDocumentStatus, vatDeductionStatus: payment.vatDeductionStatus, usnExpenseStatus: payment.usnExpenseStatus, taxPaymentKind: payment.taxPaymentKind, note: payment.note }) }).then(json<{ ok: true; error?: string }>);
      setRegister((current) => current ? { ...current, payments: current.payments.map((item) => item.id === payment.id ? { ...item, saved: true } : item) } : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить платёж"); } finally { setSavingId(""); }
  };

  const saveDocument = async (document: MarketplaceTaxDocument) => {
    if (!company) return; setSavingId(document.id); setError("");
    try {
      await fetch("/api/finance/taxes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "marketplace_document", companyId: company.id, documentId: document.id, marketplace: document.marketplace, documentDate: document.documentDate, documentNumber: document.documentNumber, grossExpenseAmount: document.grossExpenseAmount, vatRate: document.vatRate, vatAmount: document.vatAmount, vatDocumentStatus: document.vatDocumentStatus, vatDeductionStatus: document.vatDeductionStatus, usnExpenseStatus: document.usnExpenseStatus, note: document.note }) }).then(json<{ ok: true; error?: string }>);
      setRegister((current) => current ? { ...current, marketplaceTaxDocuments: current.marketplaceTaxDocuments.map((item) => item.id === document.id ? { ...item, saved: true } : item) } : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить документ"); } finally { setSavingId(""); }
  };

  const saveSettings = async () => {
    if (!company || !register) return; setSavingSettings(true); setError("");
    try {
      await Promise.all([
        fetch("/api/finance/taxes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "profile", companyId: company.id, vatEffectiveFrom: register.vatEffectiveFrom }) }).then(json<{ ok: true; error?: string }>),
        fetch("/api/finance/taxes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "year_settings", companyId: company.id, taxYear: dates.year, ...register.yearSettings }) }).then(json<{ ok: true; error?: string }>),
      ]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить параметры"); } finally { setSavingSettings(false); }
  };

  const systemLabel = COMPANY_TAX_SYSTEMS.find((item) => item.value === company?.taxSystem)?.label ?? "не настроено";
  const vatLabel = COMPANY_VAT_MODES.find((item) => item.value === company?.vatMode)?.label ?? "не настроено";
  const kindOptions: Array<{ value: TaxPaymentKind; label: string }> = [{ value: "operating_expense", label: "Обычный расход" }, { value: "insurance_contribution", label: "Страховой взнос" }, { value: "usn_tax_payment", label: "Уплата УСН" }, { value: "other_tax", label: "Другой налог" }];

  return <div className="mx-auto max-w-[1600px] px-3 py-4 sm:px-4 lg:py-5">
    <FinanceTabs />
    <div className="mb-4 flex flex-wrap items-end gap-2.5"><div className="grid h-10 w-10 place-items-center rounded-lg bg-violet-100 text-violet-700"><Calculator className="h-5 w-5" /></div><div className="min-w-[220px] flex-1"><h1 className="text-2xl font-bold text-slate-900">Налоги на текущую дату</h1><p className="text-sm text-slate-500">Нарастающим итогом с 1 января</p></div><label className="text-xs font-semibold text-slate-600">Рассчитать на дату<input type="date" min="2025-01-01" max={today} value={asOf} onChange={(event) => setAsOf(event.target.value || today)} className={`mt-1 block ${fieldClass}`} /></label><label className="min-w-56 text-xs font-semibold text-slate-600">Компания<select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className={`mt-1 block w-full ${fieldClass}`}><option value="">Выберите компанию</option>{register?.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
    {loading ? <LoadingBanner seconds={elapsed} hint="отчёты маркетплейсов и налоговый регистр" /> : null}
    {error ? <ActionableError message={error} label="Налоги" onRetry={() => setReload((value) => value + 1)} tone="rose" className="mb-3" /> : null}
    {company ? <div className="mb-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><b>{company.name}</b><span className="ml-2 text-slate-500">{systemLabel} · официальная ставка {company.taxRate == null ? "не указана" : `${company.taxRate}%`} · {vatLabel}</span>{company.taxAdditionalRate ? <span className="ml-2 text-amber-700">Доп. расход региона {company.taxAdditionalRate}% — не налог ФНС</span> : null}</div><Link href="/payments?companies=1" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-3 text-xs font-semibold">Настройки компании</Link></div> : null}
    {company && (!company.taxSystem || company.taxRate == null || company.vatMode == null) ? <div className="mb-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Заполните режим, официальную ставку и НДС — до этого итог неполный.</div> : null}

    {company ? <section className="mb-4 rounded-xl border border-violet-200 bg-violet-50 p-3"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 xl:items-end"><label className="text-xs font-semibold">НДС действует с<input type="month" value={(register?.vatEffectiveFrom ?? `${dates.year}-01-01`).slice(0, 7)} onChange={(event) => setRegister((current) => current ? { ...current, vatEffectiveFrom: `${event.target.value}-01` } : current)} className={`mt-1 block w-full ${fieldClass}`} /></label><label className="text-xs font-semibold">Исходящий НДС по книге продаж<input type="number" min="0" step="0.01" value={register?.yearSettings.outputVatConfirmed ?? ""} placeholder="Пусто = расчёт по ставке" onChange={(event) => setRegister((current) => current ? { ...current, yearSettings: { ...current.yearSettings, outputVatConfirmed: event.target.value === "" ? null : Math.max(0, Number(event.target.value) || 0) } } : current)} className={`mt-1 block w-full text-right ${fieldClass}`} /></label><label className="text-xs font-semibold">Признанная себестоимость<input type="number" min="0" step="0.01" value={register?.yearSettings.recognizedCogs ?? 0} onChange={(event) => setRegister((current) => current ? { ...current, yearSettings: { ...current.yearSettings, recognizedCogs: Math.max(0, Number(event.target.value) || 0) } } : current)} className={`mt-1 block w-full text-right ${fieldClass}`} /></label><label className="text-xs font-semibold">Взносы ИП к учёту<input type="number" min="0" step="0.01" value={register?.yearSettings.fixedInsuranceContributions ?? 0} onChange={(event) => setRegister((current) => current ? { ...current, yearSettings: { ...current.yearSettings, fixedInsuranceContributions: Math.max(0, Number(event.target.value) || 0) } } : current)} className={`mt-1 block w-full text-right ${fieldClass}`} /></label><label className="text-xs font-semibold">Лимит уменьшения<select value={register?.yearSettings.insuranceReductionLimitPercent ?? 0} onChange={(event) => setRegister((current) => current ? { ...current, yearSettings: { ...current.yearSettings, insuranceReductionLimitPercent: Number(event.target.value) } } : current)} className={`mt-1 block w-full ${fieldClass}`}><option value={0}>Не уменьшать</option><option value={100}>100% — без работников</option><option value={50}>50% — есть работники</option></select></label><label className="text-xs font-semibold">Убыток прошлых лет<input type="number" min="0" step="0.01" value={register?.yearSettings.priorYearLoss ?? 0} onChange={(event) => setRegister((current) => current ? { ...current, yearSettings: { ...current.yearSettings, priorYearLoss: Math.max(0, Number(event.target.value) || 0) } } : current)} className={`mt-1 block w-full text-right ${fieldClass}`} /></label><label className="text-xs font-semibold">Примечание<input value={register?.yearSettings.note ?? ""} onChange={(event) => setRegister((current) => current ? { ...current, yearSettings: { ...current.yearSettings, note: event.target.value } } : current)} className={`mt-1 block w-full ${fieldClass}`} /></label><button type="button" disabled={savingSettings || !register?.taxSettingsAvailable} onClick={() => void saveSettings()} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white disabled:opacity-40">{savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Сохранить</button></div><p className="mt-2 text-xs text-violet-900">Себестоимость из отчётов — контроль. В налоговые расходы вводится только оплаченная себестоимость реализованных товаров.</p></section> : null}

    {company ? <><section className="mb-5"><h2 className="mb-2 font-bold">НДС с 1 января по {asOf}</h2><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Исходящий НДС" value={calculation.outputVat} /><Metric label="Входящий подтверждён" value={calculation.confirmedInputVat} note="Только полученные УПД/СФ" tone="emerald" /><Metric label="НДС к уплате" value={calculation.vatPayable} tone="rose" /><Metric label="Перенос входного НДС" value={calculation.vatCarryforward} tone="amber" /><Metric label="Контроль по отчёту WB" value={register?.wbReportedInputVat ?? 0} note={register?.wbReportedInputVat == null ? "ppvz_vw_nds ещё не загружен" : "Точный НДС WB; без УПД не вычитается"} /></div></section><section className="mb-5"><h2 className="mb-2 font-bold">УСН с 1 января по {asOf}</h2><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8"><Metric label="Доходы УСН" value={calculation.usnIncome} /><Metric label="Признанные расходы" value={calculation.usnExpenses} /><Metric label="Налоговая база" value={calculation.usnBase} /><Metric label="До уменьшения" value={calculation.usnBeforeReduction} /><Metric label="Зачтено взносов" value={calculation.insuranceContributionsApplied} note={`Всего: ${formatRub(contributions)}`} tone="emerald" /><Metric label="Начислено УСН" value={accruedUsn} note={asOf.endsWith("-12-31") ? "С учётом минимального налога" : "Минимум сравнивается 31 декабря"} tone="rose" /><Metric label="Осталось уплатить" value={remainingUsn} note={`Уплачено: ${formatRub(taxPaid)}`} tone="emerald" /><Metric label="Доп. расход региона" value={regionalExpense} note="Не налог ФНС" tone="amber" /></div><div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-3"><span>Минимальный налог 1%: <b>{formatRub(calculation.minimumTaxControl)}</b></span><span>Себестоимость проданного: <b>{formatRub(marketplace.cogs)}</b></span><span>Услуги МП по отчётам для сверки: <b>{formatRub(marketplace.serviceExpenses)}</b></span></div></section></> : null}
    {register && (!register.taxRegisterAvailable || !register.taxSettingsAvailable) ? <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Примените миграцию <code>202609240002_tax_live_register.sql</code>; до этого новые параметры сохранить нельзя.</div> : null}

    {company ? <section className="mb-6"><div className="mb-2 flex flex-wrap items-end justify-between gap-2"><div><h2 className="font-bold">Документы маркетплейсов</h2><p className="text-xs text-slate-500">Услуга МП и входящий НДС учитываются только после проверки документа.</p></div><button type="button" onClick={() => setRegister((current) => current ? { ...current, marketplaceTaxDocuments: [...current.marketplaceTaxDocuments, blankDocument(asOf)] } : current)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-violet-300 px-3 text-xs font-semibold text-violet-700"><Plus className="h-4 w-4" />Добавить документ</button></div><div className="scroll-x rounded-xl border bg-white"><table className="min-w-[1450px] w-full text-xs"><thead><tr className="bg-slate-800 text-left text-white"><th className="p-2">МП / дата</th><th className="p-2">№</th><th className="p-2">Расход с НДС</th><th className="p-2">Учёт УСН</th><th className="p-2">Ставка</th><th className="p-2">НДС</th><th className="p-2">Документ</th><th className="p-2">Вычет</th><th className="p-2">Комментарий</th><th className="p-2">Сохранить</th></tr></thead><tbody>{documents.map((document) => <tr key={document.id} className="border-b align-top"><td className="p-2"><select value={document.marketplace} onChange={(event) => updateDocument(document.id, { marketplace: event.target.value as MarketplaceTaxDocument["marketplace"] })} className={fieldClass}><option value="wb">WB</option><option value="ozon">Ozon</option><option value="other">Другой</option></select><input type="date" max={asOf} value={document.documentDate} onChange={(event) => updateDocument(document.id, { documentDate: event.target.value })} className={`ml-1 ${fieldClass}`} /></td><td className="p-2"><input value={document.documentNumber} onChange={(event) => updateDocument(document.id, { documentNumber: event.target.value })} className={`w-32 ${fieldClass}`} /></td><td className="p-2"><input type="number" min="0" value={document.grossExpenseAmount} onChange={(event) => updateDocument(document.id, { grossExpenseAmount: Math.max(0, Number(event.target.value) || 0) })} className={`w-32 text-right ${fieldClass}`} /></td><td className="p-2"><select value={document.usnExpenseStatus} onChange={(event) => updateDocument(document.id, { usnExpenseStatus: event.target.value as UsnExpenseStatus })} className={`w-36 ${fieldClass}`}>{usnOptions}</select></td><td className="p-2"><select value={document.vatRate ?? ""} onChange={(event) => updateDocument(document.id, { vatRate: event.target.value === "" ? null : Number(event.target.value) })} className={`w-24 ${fieldClass}`}>{rateOptions}</select></td><td className="p-2"><input type="number" min="0" value={document.vatAmount} onChange={(event) => updateDocument(document.id, { vatAmount: Math.max(0, Number(event.target.value) || 0) })} className={`w-28 text-right ${fieldClass}`} /></td><td className="p-2"><select value={document.vatDocumentStatus} onChange={(event) => updateDocument(document.id, { vatDocumentStatus: event.target.value as VatDocumentStatus })} className={`w-40 ${fieldClass}`}>{documentOptions}</select></td><td className="p-2"><select value={document.vatDeductionStatus} onChange={(event) => updateDocument(document.id, { vatDeductionStatus: event.target.value as VatDeductionStatus })} className={`w-36 ${fieldClass}`}>{deductionOptions}</select></td><td className="p-2"><input value={document.note} onChange={(event) => updateDocument(document.id, { note: event.target.value })} className={`w-44 ${fieldClass}`} /></td><td className="p-2"><button type="button" disabled={savingId === document.id || !register?.taxSettingsAvailable} onClick={() => void saveDocument(document)} className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-violet-600 px-3 font-semibold text-white disabled:opacity-40">{savingId === document.id ? <Loader2 className="h-4 w-4 animate-spin" /> : document.saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}{document.saved ? "Сохранено" : "Сохранить"}</button></td></tr>)}</tbody></table>{!documents.length ? <div className="p-7 text-center text-sm text-slate-500">Добавьте УПД или счёт-фактуру WB/Ozon.</div> : null}</div></section> : null}

    {company ? <section><div className="mb-2"><h2 className="font-bold">Платежи ДДС: налоговая квалификация</h2><p className="text-xs text-slate-500">Назначение банка — подсказка. Укажите вид платежа и документы.</p></div><div className="scroll-x rounded-xl border bg-white"><table className="min-w-[1500px] w-full text-xs"><thead><tr className="bg-slate-800 text-left text-white"><th className="p-2">Дата / платёж</th><th className="p-2">Сумма</th><th className="p-2">Назначение</th><th className="p-2">Учёт УСН</th><th className="p-2">Ставка НДС</th><th className="p-2">НДС</th><th className="p-2">Документ</th><th className="p-2">Вычет</th><th className="p-2">Комментарий</th><th className="p-2">Сохранить</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id} className="border-b align-top"><td className="max-w-[330px] p-2"><b>{payment.name || payment.category}</b><div className="text-slate-500">{payment.date} · {payment.counterparty || "Контрагент не указан"}</div>{payment.suggestedTaxKind !== "operating_expense" ? <div className="text-amber-700">Подсказка: {kindOptions.find((item) => item.value === payment.suggestedTaxKind)?.label}</div> : null}{payment.suggestedVatKind !== "unknown" ? <div className="text-violet-700">НДС: {payment.suggestedVatKind === "without_vat" ? "без НДС" : `${payment.suggestedVatRate ?? "?"}% · ${formatRub(payment.suggestedVatAmount)}`}</div> : null}</td><td className="p-2 text-right font-semibold">{formatRub(payment.grossAmount)}</td><td className="p-2"><select value={payment.taxPaymentKind} onChange={(event) => updatePayment(payment.id, { taxPaymentKind: event.target.value as TaxPaymentKind })} className={`w-44 ${fieldClass}`}>{kindOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></td><td className="p-2"><select value={payment.usnExpenseStatus} onChange={(event) => updatePayment(payment.id, { usnExpenseStatus: event.target.value as UsnExpenseStatus })} className={`w-36 ${fieldClass}`}>{usnOptions}</select></td><td className="p-2"><select value={payment.vatRate ?? ""} onChange={(event) => updatePayment(payment.id, { vatRate: event.target.value === "" ? null : Number(event.target.value) })} className={`w-24 ${fieldClass}`}>{rateOptions}</select></td><td className="p-2"><input type="number" min="0" value={payment.vatAmount} onChange={(event) => updatePayment(payment.id, { vatAmount: Math.max(0, Number(event.target.value) || 0) })} className={`w-28 text-right ${fieldClass}`} /></td><td className="p-2"><select value={payment.vatDocumentStatus} onChange={(event) => updatePayment(payment.id, { vatDocumentStatus: event.target.value as VatDocumentStatus })} className={`w-40 ${fieldClass}`}>{documentOptions}</select></td><td className="p-2"><select value={payment.vatDeductionStatus} onChange={(event) => updatePayment(payment.id, { vatDeductionStatus: event.target.value as VatDeductionStatus })} className={`w-36 ${fieldClass}`}>{deductionOptions}</select></td><td className="p-2"><input value={payment.note} onChange={(event) => updatePayment(payment.id, { note: event.target.value })} className={`w-44 ${fieldClass}`} /></td><td className="p-2"><button type="button" disabled={savingId === payment.id || !register?.taxRegisterAvailable} onClick={() => void savePayment(payment)} className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-violet-600 px-3 font-semibold text-white disabled:opacity-40">{savingId === payment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : payment.saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}{payment.saved ? "Сохранено" : "Сохранить"}</button></td></tr>)}</tbody></table>{!payments.length ? <div className="p-8 text-center text-sm text-slate-500"><FileCheck2 className="mx-auto mb-2 h-6 w-6" />До выбранной даты нет расходов ДДС.</div> : null}</div></section> : null}
  </div>;
}
