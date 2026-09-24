"use client";

import { FinanceTabs } from "@/components/FinanceTabs";
import { ActionableError } from "@/components/ui/ActionableError";
import { LoadingBanner, useElapsedSeconds } from "@/components/ui/LoadingState";
import { formatRub } from "@/lib/analytics/format";
import { companyTaxTotalRate, COMPANY_TAX_SYSTEMS, COMPANY_VAT_MODES, type CompanyTaxSystem, type CompanyVatMode } from "@/lib/finance/companyTax";
import { calculateTaxPeriod, vatAllowsInputDeduction, type UsnExpenseStatus, type VatDeductionStatus, type VatDocumentStatus } from "@/lib/finance/taxCalculation";
import { AlertTriangle, Calculator, Check, FileCheck2, Loader2, Save } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Company = {
  id: string; name: string; groupName: string;
  taxSystem: CompanyTaxSystem | null; vatMode: CompanyVatMode | null;
  taxRate: number | null; taxAdditionalRate: number | null;
};

type TaxPayment = {
  id: string; date: string; name: string; grossAmount: number; category: string; counterparty: string; source: string;
  suggestedVatRate: number | null; suggestedVatAmount: number; suggestedVatKind: string;
  vatRate: number | null; vatAmount: number; vatDocumentStatus: VatDocumentStatus;
  vatDeductionStatus: VatDeductionStatus; usnExpenseStatus: UsnExpenseStatus; note: string; saved: boolean;
};

type TaxResponse = {
  companies: Company[]; selectedCompany: Company | null; payments: TaxPayment[];
  taxRegisterAvailable: boolean; taxSettingsAvailable: boolean; taxPaid: number;
  vatEffectiveFrom: string | null;
  marketplaceVatPeriods: Array<{ periodKey: string; confirmedInputVat: number; note: string }>;
  error?: string;
};

type MarketplaceResponse = {
  wb?: { revenue_after_spp?: number; revenue_before_spp: number; commission: number; acquiring: number; ad: number; other: number; logistics: number | null; storage: number | null; penalty: number | null; error?: string };
  ozon?: { revenue: number; commission: number; delivery: number; services: number; error?: string; noCabinet?: boolean };
  warnings?: string[]; error?: string;
};

type MarketplaceTotals = { income: number; expenses: number; warnings: string[] };

const currentYear = new Date().getFullYear();
const currentQuarter = Math.floor(new Date().getMonth() / 3) + 1;
const money = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

function quarterDates(year: number, quarter: number) {
  const firstMonth = (quarter - 1) * 3 + 1;
  const lastMonth = firstMonth + 2;
  const lastDay = new Date(Date.UTC(year, lastMonth, 0)).getUTCDate();
  return {
    from: `${year}-01-01`,
    quarterFrom: `${year}-${String(firstMonth).padStart(2, "0")}-01`,
    to: `${year}-${String(lastMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    months: Array.from({ length: lastMonth }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`),
  };
}

async function json<T extends { error?: string }>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T;
  if (!response.ok) throw new Error(body.error || `Ошибка ${response.status}`);
  return body;
}

function marketplaceTotals(source: MarketplaceResponse): MarketplaceTotals {
  const wbReady = source.wb && !source.wb.error;
  const ozonReady = source.ozon && !source.ozon.error && !source.ozon.noCabinet;
  const income = (wbReady ? Number(source.wb?.revenue_after_spp ?? source.wb?.revenue_before_spp ?? 0) : 0)
    + (ozonReady ? Number(source.ozon?.revenue ?? 0) : 0);
  // Штрафы не включаем автоматически. «Прочие удержания» показываются в базе,
  // но окончательную принимаемость бухгалтер проверяет по документам МП.
  const expenses = (wbReady ? Number(source.wb?.commission ?? 0) + Number(source.wb?.acquiring ?? 0)
    + Number(source.wb?.ad ?? 0) + Number(source.wb?.other ?? 0) + Number(source.wb?.logistics ?? 0) + Number(source.wb?.storage ?? 0) : 0)
    + (ozonReady ? Number(source.ozon?.commission ?? 0) + Number(source.ozon?.delivery ?? 0) + Number(source.ozon?.services ?? 0) : 0);
  return { income: money(income), expenses: money(expenses), warnings: source.warnings ?? [] };
}

function sumTotals(values: readonly MarketplaceTotals[]): MarketplaceTotals {
  return {
    income: money(values.reduce((sum, value) => sum + value.income, 0)),
    expenses: money(values.reduce((sum, value) => sum + value.expenses, 0)),
    warnings: [...new Set(values.flatMap((value) => value.warnings))],
  };
}

function Metric({ label, value, note, tone = "slate" }: { label: string; value: number; note?: string; tone?: "slate" | "emerald" | "amber" | "rose" }) {
  const colors = { slate: "border-slate-200 bg-white", emerald: "border-emerald-200 bg-emerald-50", amber: "border-amber-200 bg-amber-50", rose: "border-rose-200 bg-rose-50" };
  return <div className={`rounded-xl border p-3 shadow-sm ${colors[tone]}`}><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-xl font-extrabold tabular-nums text-slate-950">{formatRub(value)}</div>{note ? <p className="mt-1 text-xs leading-4 text-slate-600">{note}</p> : null}</div>;
}

export function TaxesPage() {
  const [year, setYear] = useState(currentYear);
  const [quarter, setQuarter] = useState(currentQuarter);
  const [companyId, setCompanyId] = useState("");
  const [register, setRegister] = useState<TaxResponse | null>(null);
  const [marketplaceByMonth, setMarketplaceByMonth] = useState<Record<string, MarketplaceTotals>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [reload, setReload] = useState(0);
  const elapsed = useElapsedSeconds(loading);
  const dates = useMemo(() => quarterDates(year, quarter), [quarter, year]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true); setError("");
    const load = async () => {
      const params = new URLSearchParams({ from: dates.from, to: dates.to, company: companyId });
      const taxData = await fetch(`/api/finance/taxes?${params}`, { cache: "no-store", signal: controller.signal }).then(json<TaxResponse>);
      if (!companyId && taxData.companies[0]) {
        if (active) { setRegister(taxData); setCompanyId(taxData.companies[0].id); }
        return;
      }
      const totals: Record<string, MarketplaceTotals> = {};
      for (let index = 0; index < dates.months.length; index += 3) {
        const batch = dates.months.slice(index, index + 3);
        const loaded = await Promise.all(batch.map(async (month) => {
          const monthParams = new URLSearchParams({ month, ...(companyId ? { company: companyId } : {}) });
          const source = await fetch(`/api/opiu/mp?${monthParams}`, { cache: "no-store", signal: controller.signal }).then(json<MarketplaceResponse>);
          return [month, marketplaceTotals(source)] as const;
        }));
        loaded.forEach(([month, total]) => { totals[month] = total; });
      }
      if (active) { setRegister(taxData); setMarketplaceByMonth(totals); }
    };
    void load().catch((reason) => {
      if (active && !(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Не удалось рассчитать налоги");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [companyId, dates.from, dates.months, dates.to, reload]);

  const company = register?.selectedCompany ?? null;
  const rate = companyTaxTotalRate(company?.taxRate ?? null, company?.taxAdditionalRate ?? null);
  const quarterMonths = dates.months.slice((quarter - 1) * 3);
  const ytdMarketplace = sumTotals(dates.months.map((month) => marketplaceByMonth[month] ?? { income: 0, expenses: 0, warnings: [] }));
  const quarterMarketplace = sumTotals(quarterMonths.map((month) => marketplaceByMonth[month] ?? { income: 0, expenses: 0, warnings: [] }));
  const effectiveMonth = register?.vatEffectiveFrom?.slice(0, 7) ?? `${year}-01`;
  const vatIncome = (months: string[]) => money(months.reduce((sum, month) => (
    month >= effectiveMonth ? sum + (marketplaceByMonth[month]?.income ?? 0) : sum
  ), 0));
  const periodKey = `${year}-Q${quarter}`;
  const selectedPeriod = register?.marketplaceVatPeriods.find((period) => period.periodKey === periodKey)
    ?? { periodKey, confirmedInputVat: 0, note: "" };
  const ytdMarketplaceInputVat = money((register?.marketplaceVatPeriods ?? [])
    .filter((period) => period.periodKey.startsWith(`${year}-Q`) && period.periodKey <= periodKey)
    .reduce((sum, period) => sum + period.confirmedInputVat, 0));
  const ytdBank = register?.payments ?? [];
  const quarterBank = ytdBank.filter((payment) => payment.date >= dates.quarterFrom);
  const toExpenseInput = (payment: TaxPayment) => ({
    grossAmount: payment.grossAmount, vatAmount: payment.vatAmount,
    vatDocumentStatus: payment.vatDocumentStatus,
    vatDeductionStatus: payment.date >= (register?.vatEffectiveFrom ?? `${year}-01-01`) ? payment.vatDeductionStatus : "not_eligible" as VatDeductionStatus,
    usnExpenseStatus: payment.usnExpenseStatus,
  });
  const ytd = calculateTaxPeriod({ taxSystem: company?.taxSystem ?? null, taxRate: rate, vatMode: company?.vatMode ?? null, marketplaceIncomeGross: ytdMarketplace.income, vatTaxableIncomeGross: vatIncome(dates.months), marketplaceExpensesGross: ytdMarketplace.expenses, marketplaceInputVatConfirmed: ytdMarketplaceInputVat, bankExpenses: ytdBank.map(toExpenseInput) });
  const vatQuarter = calculateTaxPeriod({ taxSystem: company?.taxSystem ?? null, taxRate: rate, vatMode: company?.vatMode ?? null, marketplaceIncomeGross: quarterMarketplace.income, vatTaxableIncomeGross: vatIncome(quarterMonths), marketplaceExpensesGross: quarterMarketplace.expenses, marketplaceInputVatConfirmed: selectedPeriod.confirmedInputVat, bankExpenses: quarterBank.map(toExpenseInput) });
  const marketplaceInputVatPotential = vatAllowsInputDeduction(company?.vatMode ?? null) ? money(quarterMarketplace.expenses * 22 / 122) : 0;
  const usnRemaining = Math.max(0, ytd.usnCalculated - (register?.taxPaid ?? 0));

  const updatePayment = (id: string, patch: Partial<TaxPayment>) => setRegister((current) => current ? { ...current, payments: current.payments.map((payment) => payment.id === id ? { ...payment, ...patch } : payment) } : current);
  const save = async (payment: TaxPayment) => {
    setSavingId(payment.id); setError("");
    try {
      await fetch("/api/finance/taxes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId: payment.id, vatRate: payment.vatRate, vatAmount: payment.vatAmount, vatDocumentStatus: payment.vatDocumentStatus, vatDeductionStatus: payment.vatDeductionStatus, usnExpenseStatus: payment.usnExpenseStatus, note: payment.note }) }).then(json<{ ok: true; error?: string }>);
      updatePayment(payment.id, { saved: true });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить налоговую квалификацию"); }
    finally { setSavingId(""); }
  };
  const saveSettings = async () => {
    if (!company || !register) return;
    setSavingSettings(true); setError("");
    try {
      await Promise.all([
        fetch("/api/finance/taxes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "profile", companyId: company.id, vatEffectiveFrom: register.vatEffectiveFrom }) }).then(json<{ ok: true; error?: string }>),
        fetch("/api/finance/taxes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "period", companyId: company.id, periodKey, marketplaceInputVatConfirmed: selectedPeriod.confirmedInputVat, note: selectedPeriod.note }) }).then(json<{ ok: true; error?: string }>),
      ]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить настройки НДС"); }
    finally { setSavingSettings(false); }
  };

  const updatePeriod = (patch: Partial<(typeof selectedPeriod)>) => setRegister((current) => {
    if (!current) return current;
    const exists = current.marketplaceVatPeriods.some((period) => period.periodKey === periodKey);
    return {
      ...current,
      marketplaceVatPeriods: exists
        ? current.marketplaceVatPeriods.map((period) => period.periodKey === periodKey ? { ...period, ...patch } : period)
        : [...current.marketplaceVatPeriods, { ...selectedPeriod, ...patch }],
    };
  });

  const taxSystemLabel = COMPANY_TAX_SYSTEMS.find((item) => item.value === company?.taxSystem)?.label ?? "не настроено";
  const vatLabel = COMPANY_VAT_MODES.find((item) => item.value === company?.vatMode)?.label ?? "не настроено";

  return <div className="mx-auto max-w-[1600px] px-3 py-4 sm:px-4 lg:py-5">
    <FinanceTabs />
    <div className="mb-4 flex flex-wrap items-end gap-2.5">
      <div className="grid h-10 w-10 place-items-center rounded-lg bg-violet-100 text-violet-700"><Calculator className="h-5 w-5" /></div>
      <div className="min-w-[220px] flex-1"><h1 className="text-2xl font-bold text-slate-900">Налоги</h1><p className="text-sm text-slate-500">УСН и НДС по отчётам маркетплейсов и фактическим платежам ДДС</p></div>
      <label className="text-xs font-semibold text-slate-600">Год<input type="number" min="2025" max="2100" value={year} onChange={(event) => setYear(Number(event.target.value) || currentYear)} className="mt-1 block min-h-11 w-28 rounded-lg border border-slate-300 bg-white px-3" /></label>
      <label className="text-xs font-semibold text-slate-600">Квартал<select value={quarter} onChange={(event) => setQuarter(Number(event.target.value))} className="mt-1 block min-h-11 rounded-lg border border-slate-300 bg-white px-3"><option value={1}>I квартал</option><option value={2}>II квартал</option><option value={3}>III квартал</option><option value={4}>IV квартал</option></select></label>
      <label className="min-w-56 text-xs font-semibold text-slate-600">Компания<select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="">Выберите компанию</option>{register?.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </div>
    {loading ? <LoadingBanner seconds={elapsed} hint="отчёты маркетплейсов и налоговый регистр ДДС" /> : null}
    {error ? <ActionableError message={error} label="Налоги" onRetry={() => setReload((value) => value + 1)} tone="rose" className="mb-3" /> : null}
    {company ? <div className="mb-4 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><b>{company.name}</b><span className="ml-2 text-slate-500">{taxSystemLabel} · {rate == null ? "ставка не указана" : `${rate}%`} · {vatLabel}</span></div><Link href="/payments?companies=1" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">Настройки компании</Link></div> : null}
    {company && (!company.taxSystem || rate == null || company.vatMode == null) ? <div className="mb-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>Заполните налоговый режим, ставку и НДС в настройках компании — до этого итог нельзя считать полным.</span></div> : null}
    {company?.vatMode === "5" || company?.vatMode === "7" ? <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">При специальных ставках НДС {company.vatMode}% входной НДС к вычету не принимается. Он остаётся в стоимости расхода, если сам расход признаётся для УСН.</div> : null}
    {company && company.vatMode !== "exempt" && company.vatMode !== "0" ? <section className="mb-4 rounded-xl border border-violet-200 bg-violet-50 p-3"><div className="grid gap-3 lg:grid-cols-[190px_190px_1fr_auto] lg:items-end"><label className="text-xs font-semibold text-slate-700">НДС действует с месяца<input type="month" value={(register?.vatEffectiveFrom ?? `${year}-01-01`).slice(0, 7)} onChange={(event) => setRegister((current) => current ? { ...current, vatEffectiveFrom: `${event.target.value}-01` } : current)} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3" /></label><label className="text-xs font-semibold text-slate-700">Входящий НДС МП за квартал<input type="number" min="0" step="0.01" value={selectedPeriod.confirmedInputVat} onChange={(event) => updatePeriod({ confirmedInputVat: Math.max(0, Number(event.target.value) || 0) })} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-right tabular-nums" /></label><label className="text-xs font-semibold text-slate-700">Документ-основание<input value={selectedPeriod.note} onChange={(event) => updatePeriod({ note: event.target.value })} placeholder="УПД/СФ маркетплейса, номер и дата" className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3" /></label><button type="button" disabled={savingSettings || !register?.taxSettingsAvailable} onClick={() => void saveSettings()} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-4 text-xs font-semibold text-white disabled:opacity-40">{savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Сохранить НДС</button></div><p className="mt-2 text-xs leading-5 text-violet-900">Сумму из отчёта маркетплейса показываем как потенциальную. В вычет попадает только подтверждённая здесь сумма по полученному УПД/счёту-фактуре.</p></section> : null}

    {company ? <>
      <section className="mb-5"><h2 className="mb-2 text-base font-bold text-slate-900">НДС за {quarter} квартал</h2><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Исходящий НДС" value={vatQuarter.outputVat} note="Из выручки покупателя" /><Metric label="Входящий подтверждён" value={vatQuarter.confirmedInputVat} note="Только УПД/счёт-фактура + отметка вычета" tone="emerald" /><Metric label="Потенциальный НДС МП" value={marketplaceInputVatPotential} note="Справочно из услуг МП; без УПД не вычитается" tone="amber" /><Metric label="НДС к уплате" value={vatQuarter.vatPayable} note="Без неподтверждённых документов" tone="rose" /><Metric label="Расходы МП с НДС" value={quarterMarketplace.expenses} note="Комиссия, логистика и услуги по отчётам" /></div></section>
      <section className="mb-5"><h2 className="mb-2 text-base font-bold text-slate-900">УСН нарастающим итогом с начала {year} года</h2><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6"><Metric label="Доходы УСН" value={ytd.usnIncome} note="Полная сумма покупателя минус исходящий НДС" /><Metric label="Признанные расходы" value={ytd.usnExpenses} note="Удержания МП + отмеченные расходы ДДС" /><Metric label="Налоговая база" value={ytd.usnBase} /><Metric label="Налог по ставке" value={ytd.usnCalculated} tone="rose" /><Metric label="Контроль 1%" value={ytd.minimumTaxControl} note="Минимальный налог сравнивается только по итогам года" tone="amber" /><Metric label="После явных уплат УСН" value={usnRemaining} note={`В ДДС с пометкой УСН: ${formatRub(register?.taxPaid ?? 0)}. ЕНП без расшифровки не вычитается.`} tone="emerald" /></div></section>
    </> : null}

    {register && (!register.taxRegisterAvailable || !register.taxSettingsAvailable) ? <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Налоговый регистр ещё не создан в базе. Примените миграцию <code>202609240001_payment_tax_register.sql</code>; до этого подсказки видны, но сохранить их нельзя.</div> : null}

    {company ? <section><div className="mb-2 flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-base font-bold text-slate-900">Расходы ДДС: налоговая квалификация</h2><p className="text-xs text-slate-500">«Включить в УСН» и «принять НДС» — разные решения. НДС из назначения платежа всегда только подсказка.</p></div><div className="text-xs text-slate-500">Неразобрано: <b>{ytdBank.filter((payment) => payment.usnExpenseStatus === "pending").length}</b></div></div>
      <div className="scroll-x rounded-xl border border-slate-200 bg-white shadow-sm"><table className="min-w-[1280px] w-full border-collapse text-xs"><thead><tr className="bg-slate-800 text-left text-white"><th className="px-3 py-2">Дата / платёж</th><th className="px-3 py-2 text-right">Сумма</th><th className="px-3 py-2">Расход УСН</th><th className="px-3 py-2">Ставка НДС</th><th className="px-3 py-2">Сумма НДС</th><th className="px-3 py-2">Документ</th><th className="px-3 py-2">Вычет</th><th className="px-3 py-2">Комментарий</th><th className="px-3 py-2">Сохранить</th></tr></thead><tbody>{ytdBank.map((payment) => <tr key={payment.id} className="border-b border-slate-100 align-top hover:bg-slate-50"><td className="max-w-[330px] px-3 py-2"><div className="font-semibold text-slate-800">{payment.name || payment.category}</div><div className="mt-0.5 text-slate-500">{payment.date} · {payment.counterparty || "Контрагент не указан"} · {payment.source}</div>{payment.suggestedVatKind !== "unknown" ? <div className="mt-1 text-[11px] text-violet-700">Подсказка: {payment.suggestedVatKind === "without_vat" ? "без НДС" : `${payment.suggestedVatRate ?? "?"}% · ${formatRub(payment.suggestedVatAmount)}`}</div> : null}</td><td className="px-3 py-2 text-right font-semibold tabular-nums">{formatRub(payment.grossAmount)}</td><td className="px-3 py-2"><select value={payment.usnExpenseStatus} onChange={(event) => updatePayment(payment.id, { usnExpenseStatus: event.target.value as UsnExpenseStatus })} className="min-h-11 w-36 rounded-lg border border-slate-300 bg-white px-2"><option value="pending">Не проверено</option><option value="included">Включить</option><option value="excluded">Не учитывать</option></select></td><td className="px-3 py-2"><select value={payment.vatRate ?? ""} onChange={(event) => updatePayment(payment.id, { vatRate: event.target.value === "" ? null : Number(event.target.value) })} className="min-h-11 w-24 rounded-lg border border-slate-300 bg-white px-2"><option value="">—</option>{[0,5,7,10,20,22].map((value) => <option key={value} value={value}>{value}%</option>)}</select></td><td className="px-3 py-2"><input type="number" min="0" step="0.01" value={payment.vatAmount} onChange={(event) => updatePayment(payment.id, { vatAmount: Math.max(0, Number(event.target.value) || 0) })} className="min-h-11 w-32 rounded-lg border border-slate-300 px-2 text-right tabular-nums" /></td><td className="px-3 py-2"><select value={payment.vatDocumentStatus} onChange={(event) => updatePayment(payment.id, { vatDocumentStatus: event.target.value as VatDocumentStatus })} className="min-h-11 w-40 rounded-lg border border-slate-300 bg-white px-2"><option value="missing">Нет документа</option><option value="received">УПД/СФ получен</option><option value="not_required">Не требуется</option></select></td><td className="px-3 py-2"><select value={payment.vatDeductionStatus} onChange={(event) => updatePayment(payment.id, { vatDeductionStatus: event.target.value as VatDeductionStatus })} className="min-h-11 w-40 rounded-lg border border-slate-300 bg-white px-2"><option value="pending">Не проверено</option><option value="eligible">К вычету</option><option value="not_eligible">Не принимается</option></select></td><td className="px-3 py-2"><input value={payment.note} onChange={(event) => updatePayment(payment.id, { note: event.target.value })} placeholder="№ УПД, причина" className="min-h-11 w-48 rounded-lg border border-slate-300 px-2" /></td><td className="px-3 py-2"><button type="button" disabled={savingId === payment.id || !register?.taxRegisterAvailable} onClick={() => void save(payment)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-3 font-semibold text-white disabled:opacity-40">{savingId === payment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : payment.saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}{payment.saved ? "Сохранено" : "Сохранить"}</button></td></tr>)}</tbody></table>{!ytdBank.length ? <div className="p-8 text-center text-sm text-slate-500"><FileCheck2 className="mx-auto mb-2 h-6 w-6" />За период нет фактических расходов ДДС этой компании.</div> : null}</div>
    </section> : null}
  </div>;
}
