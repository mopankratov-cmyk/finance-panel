"use client";

import { AlertTriangle, CalendarDays, CheckCircle2, CreditCard, FileSpreadsheet, Loader2, Pencil, Plus, RefreshCw, Save, UserMinus, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import type { Account, Payment } from "@/lib/types";
import type { DdsCompany } from "./ddsCompanies";
import { readFirstSheetXlsx } from "./bankStatement";
import {
  EMPLOYMENT_LABELS,
  PAYMENT_METHOD_LABELS,
  blankPayrollEntry,
  allocatedToDebt,
  draftFromEntry,
  employeeBelongsToPeriod,
  isEmployeeActiveOn,
  nextPayrollDate,
  payrollEntryTotal,
  payrollPeriodForDate,
  payrollSalaryAmount,
  payrollTaxAmount,
  settlementFromAllocations,
  taxIsPayable,
  type PayrollData,
  type PayrollDraftEntry,
  type PayrollEmployee,
  type PayrollEmploymentType,
  type PayrollPaymentMethod,
} from "./payroll";
import { allocatePayrollPayment, importPayrollRequisites, loadPayrollData, savePayrollDebt, savePayrollEmployee, savePayrollPeriod } from "./payrollStore";

const EMPTY_DATA: PayrollData = { employees: [], periods: [], entries: [], debts: [], allocations: [] };

export function PayrollRegister({ accounts, companies, payments, onCalendarUpdated }: { accounts: Account[]; companies: DdsCompany[]; payments: Payment[]; onCalendarUpdated: () => Promise<void> }) {
  const today = todayISO();
  const [data, setData] = useState<PayrollData>(EMPTY_DATA);
  const [payDate, setPayDate] = useState(() => nextPayrollDate(today));
  const [drafts, setDrafts] = useState<Record<string, PayrollDraftEntry>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingEmployee, setEditingEmployee] = useState<PayrollEmployee | null>(null);
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadPayrollData());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось загрузить зарплатную ведомость");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const range = useMemo(() => payrollPeriodForDate(payDate), [payDate]);
  const selectedPeriod = useMemo(() => data.periods.find((period) => period.payDate === payDate) ?? null, [data.periods, payDate]);
  const employeesForPeriod = useMemo(() => {
    if (!range) return [];
    const existingEmployeeIds = new Set(data.entries.filter((entry) => entry.periodId === selectedPeriod?.id).map((entry) => entry.employeeId));
    return data.employees.filter((employee) => employeeBelongsToPeriod(employee, range.periodStart, range.periodEnd) || existingEmployeeIds.has(employee.id));
  }, [data.employees, data.entries, range, selectedPeriod?.id]);

  useEffect(() => {
    if (!range) {
      setDrafts({});
      return;
    }
    const existing = new Map(data.entries.filter((entry) => entry.periodId === selectedPeriod?.id).map((entry) => [entry.employeeId, entry]));
    setDrafts(Object.fromEntries(employeesForPeriod.map((employee) => {
      const entry = existing.get(employee.id);
      return [employee.id, entry ? draftFromEntry(entry) : blankPayrollEntry(employee)];
    })));
  }, [data.entries, employeesForPeriod, range, selectedPeriod?.id]);

  const employeeById = useMemo(() => new Map(data.employees.map((employee) => [employee.id, employee])), [data.employees]);
  const settlementByEntry = useMemo(() => new Map(data.entries.flatMap((entry) => {
    const employee = employeeById.get(entry.employeeId);
    return employee ? [[entry.id, settlementFromAllocations(employee, entry, data.allocations)] as const] : [];
  })), [data.allocations, data.entries, employeeById]);
  const existingEntryByEmployee = useMemo(
    () => new Map(data.entries.filter((entry) => entry.periodId === selectedPeriod?.id).map((entry) => [entry.employeeId, entry])),
    [data.entries, selectedPeriod?.id],
  );
  const activeEmployees = useMemo(() => data.employees.filter((employee) => isEmployeeActiveOn(employee, today)), [data.employees, today]);
  const formerEmployees = useMemo(() => data.employees.filter((employee) => !isEmployeeActiveOn(employee, today)), [data.employees, today]);
  const debtByEmployee = useMemo(() => {
    const totals = new Map<string, number>();
    for (const entry of data.entries) {
      totals.set(entry.employeeId, (totals.get(entry.employeeId) ?? 0) + (settlementByEntry.get(entry.id)?.debt ?? 0));
    }
    for (const debt of data.debts) {
      totals.set(debt.employeeId, (totals.get(debt.employeeId) ?? 0) + Math.max(0, debt.amount - allocatedToDebt(debt.id, data.allocations)));
    }
    return totals;
  }, [data.allocations, data.debts, data.entries, settlementByEntry]);

  const payrollCandidates = useMemo(() => {
    const allocated = new Map<string, number>();
    for (const item of data.allocations) allocated.set(item.paymentId, (allocated.get(item.paymentId) ?? 0) + item.amount);
    const employeeWords = data.employees.map((employee) => employee.fullName.toLowerCase().split(" ")[0]).filter(Boolean);
    return payments.filter((payment) => {
      if (payment.status !== "done" || payment.amount >= 0) return false;
      const remaining = Math.abs(payment.amount) - (allocated.get(payment.id) ?? 0);
      if (remaining <= 0.009) return false;
      const haystack = `${payment.name} ${payment.category} ${payment.counterparty} ${payment.comment ?? ""}`.toLowerCase();
      return /(зарплат|аванс|зп|сотрудник)/.test(haystack) || employeeWords.some((word) => word.length > 3 && haystack.includes(word));
    }).sort((left, right) => right.date.localeCompare(left.date));
  }, [data.allocations, data.employees, payments]);

  const summary = useMemo(() => employeesForPeriod.reduce((result, employee) => {
    const draft = drafts[employee.id] ?? blankPayrollEntry(employee);
    const entry = existingEntryByEmployee.get(employee.id);
    const settlement = entry ? settlementByEntry.get(entry.id) : undefined;
    result.salary += payrollSalaryAmount(draft);
    result.tax += payrollTaxAmount(employee, draft);
    result.total += payrollEntryTotal(employee, draft);
    result.paid += settlement?.paid ?? 0;
    return result;
  }, { salary: 0, tax: 0, total: 0, paid: 0 }), [drafts, employeesForPeriod, existingEntryByEmployee, settlementByEntry]);

  const missingTax = employeesForPeriod.filter((employee) => {
    const draft = drafts[employee.id];
    return draft && taxIsPayable(employee, draft)
      && (employee.employmentType === "individual_entrepreneur" || employee.employmentType === "self_employed")
      && payrollSalaryAmount(draft) > 0
      && draft.taxAmount === 0;
  });

  const updateDraft = (employeeId: string, patch: Partial<PayrollDraftEntry>) => {
    setDrafts((current) => {
      const employee = employeeById.get(employeeId);
      const next = { ...current[employeeId], ...patch };
      const amountChanged = patch.officialAmount !== undefined || patch.unofficialAmount !== undefined || patch.contractorAmount !== undefined || patch.paymentMethod !== undefined;
      if (employee && amountChanged && patch.taxAmount === undefined && employee.taxRate !== null) {
        next.taxAmount = taxIsPayable(employee, next)
          ? Math.round(payrollSalaryAmount(next) * employee.taxRate) / 100
          : 0;
      }
      return { ...current, [employeeId]: next };
    });
    setSuccess("");
  };

  const savePeriod = async () => {
    if (!range) {
      setError("Дата выплаты должна быть 5-м или 20-м числом месяца");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await savePayrollPeriod(payDate, employeesForPeriod.map((employee) => drafts[employee.id] ?? blankPayrollEntry(employee)));
      await onCalendarUpdated();
      setSuccess("Ведомость сохранена. Зарплата и налог обновлены в платёжном календаре без дублей.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось сохранить ведомость");
    } finally {
      setSaving(false);
    }
  };

  const openNewEmployee = () => {
    setEditingEmployee(newEmployee());
    setEmployeeModalOpen(true);
  };

  if (loading && !data.employees.length) {
    return <Card><div className="flex items-center gap-3 p-6 text-slate-600"><Loader2 className="h-5 w-5 animate-spin" /> Загружаю сотрудников и ведомости…</div></Card>;
  }

  return (
    <div className="space-y-5">
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
      {success && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" />{success}</div>}
      {data.preview && <div role="status" className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900"><strong>Предварительный просмотр.</strong> Сотрудники показаны из присланного Excel. Начисления и изменения станут доступны после применения миграции базы.</div>}

      <Card>
        <div className="flex flex-col gap-4 border-b border-slate-100 p-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-violet-700" /><h2 className="text-lg font-bold text-slate-950">Ведомость на выплату</h2></div>
            <p className="mt-1 text-sm text-slate-500">5-го числа — за 16–последний день прошлого месяца; 20-го — за 1–15 число текущего месяца.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-semibold text-slate-700">Дата выплаты
              <input type="date" value={payDate} onChange={(event) => setPayDate(event.target.value)} className="mt-1 min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
            </label>
            <button type="button" onClick={() => setPayDate(nextPayrollDate(today))} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><RefreshCw className="h-4 w-4" />Ближайшая выплата</button>
          </div>
        </div>
        <div className="p-5">
          {range ? (
            <p className="mb-4 rounded-xl bg-violet-50 px-4 py-3 text-sm text-violet-900">Период начисления: <strong>{formatDate(range.periodStart)} — {formatDate(range.periodEnd)}</strong></p>
          ) : (
            <p role="alert" className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">Выберите 5-е или 20-е число месяца.</p>
          )}
          <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="Зарплата" value={formatMoney(summary.salary)} />
            <Metric label="Налоги" value={formatMoney(summary.tax)} tone="amber" />
            <Metric label="Всего начислено" value={formatMoney(summary.total)} tone="violet" />
            <Metric label="Оплачено по ДДС" value={formatMoney(summary.paid)} tone="green" />
            <Metric label="Осталось выплатить" value={formatMoney(Math.max(0, summary.total - summary.paid))} tone={summary.total > summary.paid ? "rose" : "green"} />
          </div>
          {missingTax.length > 0 && (
            <div role="alert" className="mb-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Не указан налог для выплат на расчётный счёт: {missingTax.map((employee) => employee.fullName.split(" ")[0]).join(", ")}. Система не подставляет неизвестную ставку.</span>
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[1380px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-3 font-semibold">Сотрудник</th>
                  <th className="px-3 py-3 font-semibold">Оформление</th>
                  <th className="px-3 py-3 font-semibold">Начисления</th>
                  <th className="px-3 py-3 font-semibold">Налог</th>
                  <th className="px-3 py-3 font-semibold">Выплата</th>
                  <th className="px-3 py-3 font-semibold">Компания</th>
                  <th className="px-3 py-3 font-semibold">Кошелёк</th>
                  <th className="px-3 py-3 text-right font-semibold">Итого / долг</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {employeesForPeriod.map((employee) => {
                  const draft = drafts[employee.id] ?? blankPayrollEntry(employee);
                  const savedEntry = existingEntryByEmployee.get(employee.id);
                  const settlement = savedEntry ? settlementByEntry.get(savedEntry.id) : undefined;
                  return (
                    <tr key={employee.id} className="align-top hover:bg-slate-50/70">
                      <td className="px-3 py-3"><p className="font-semibold text-slate-950">{employee.fullName}</p><p className="mt-1 text-xs text-slate-500">{employee.position || "Должность не указана"}</p></td>
                      <td className="px-3 py-3"><span className="inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{EMPLOYMENT_LABELS[employee.employmentType]}</span></td>
                      <td className="px-3 py-3"><AccrualInputs employee={employee} draft={draft} onChange={(patch) => updateDraft(employee.id, patch)} /></td>
                      <td className="px-3 py-3">
                        {taxIsPayable(employee, draft) ? <MoneyInput label="Налог" value={draft.taxAmount} onChange={(value) => updateDraft(employee.id, { taxAmount: value })} /> : <span className="text-xs text-slate-400">Не добавляется</span>}
                      </td>
                      <td className="px-3 py-3">
                        <select aria-label={`Способ выплаты ${employee.fullName}`} value={draft.paymentMethod} onChange={(event) => updateDraft(employee.id, { paymentMethod: event.target.value as PayrollPaymentMethod })} className="min-h-11 w-48 rounded-lg border border-slate-300 bg-white px-3 text-sm">
                          {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <p className="mt-1 max-w-48 text-xs text-slate-500">{employee.bankName || "Банк не указан"}{employee.paymentDetailsMasked ? ` · ${employee.paymentDetailsMasked}` : ""}</p>
                      </td>
                      <td className="px-3 py-3">
                        <select aria-label={`Компания ${employee.fullName}`} value={draft.companyId ?? ""} onChange={(event) => updateDraft(employee.id, { companyId: event.target.value || null })} className="min-h-11 w-48 rounded-lg border border-slate-300 bg-white px-3 text-sm">
                          <option value="">Не назначена</option>
                          {companies.filter((company) => company.isActive).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        <select aria-label={`Кошелёк ${employee.fullName}`} value={draft.accountId ?? ""} onChange={(event) => updateDraft(employee.id, { accountId: event.target.value || null })} className="min-h-11 w-48 rounded-lg border border-slate-300 bg-white px-3 text-sm">
                          <option value="">Выберите кошелёк</option>
                          {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <p className="font-bold tabular-nums text-slate-950">{formatMoney(payrollEntryTotal(employee, draft))}</p>
                        <p className={`mt-1 text-xs font-semibold tabular-nums ${(settlement?.debt ?? payrollEntryTotal(employee, draft)) > 0 ? "text-rose-700" : "text-emerald-700"}`}>Долг: {formatMoney(settlement?.debt ?? payrollEntryTotal(employee, draft))}</p>
                        {(settlement?.paid ?? 0) > 0 && <p className="mt-1 text-xs text-emerald-700">По ДДС: {formatMoney(settlement?.paid ?? 0)}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="button" disabled={saving || !range || employeesForPeriod.length === 0 || data.preview} onClick={() => void savePeriod()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-5 text-sm font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? "Сохраняю…" : "Сохранить и обновить календарь"}
            </button>
          </div>
        </div>
      </Card>

      <PaymentAllocationQueue
        payments={payrollCandidates}
        data={data}
        disabled={Boolean(data.preview)}
        onAllocate={async (input) => {
          setSaving(true); setError("");
          try { await allocatePayrollPayment(input); await load(); setSuccess("Оплата подтверждена и отражена в выбранном начислении сотрудника."); }
          catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось распределить оплату"); }
          finally { setSaving(false); }
        }}
      />

      <EmployeeSection title="Действующие сотрудники" icon={<UsersRound className="h-5 w-5 text-emerald-700" />} employees={activeEmployees} debtByEmployee={debtByEmployee} onEdit={(employee) => { setEditingEmployee(employee); setEmployeeModalOpen(true); }} action={!data.preview ? <button type="button" onClick={openNewEmployee} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-violet-300 px-3 text-sm font-semibold text-violet-700 hover:bg-violet-50"><Plus className="h-4 w-4" />Добавить сотрудника</button> : undefined} />
      <EmployeeSection title="Уволенные сотрудники" icon={<UserMinus className="h-5 w-5 text-slate-500" />} employees={formerEmployees} debtByEmployee={debtByEmployee} onEdit={(employee) => { setEditingEmployee(employee); setEmployeeModalOpen(true); }} empty="Уволенных сотрудников пока нет." />
      <RequisitesCard employees={activeEmployees} preview={Boolean(data.preview)} onImported={load} />

      <Modal open={employeeModalOpen} onClose={() => setEmployeeModalOpen(false)} title={editingEmployee?.id ? "Карточка сотрудника" : "Новый сотрудник"}>
        {editingEmployee && <><EmployeeProfile employee={editingEmployee} data={data} payments={payments} preview={Boolean(data.preview)} onSaveDebt={async (year, amount, comment) => { await savePayrollDebt(editingEmployee.id, year, amount, comment); await load(); }} /><EmployeeForm employee={editingEmployee} companies={companies} onChange={setEditingEmployee} onCancel={() => setEmployeeModalOpen(false)} onSave={async () => {
          try {
            setSaving(true);
            await savePayrollEmployee(editingEmployee);
            setEmployeeModalOpen(false);
            await load();
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Не удалось сохранить сотрудника");
          } finally {
            setSaving(false);
          }
        }} saving={saving} preview={Boolean(data.preview)} /></>}
      </Modal>
    </div>
  );
}

type AllocationInput = Parameters<typeof allocatePayrollPayment>[0];

function PaymentAllocationQueue({ payments, data, disabled, onAllocate }: { payments: Payment[]; data: PayrollData; disabled: boolean; onAllocate: (input: AllocationInput) => Promise<void> }) {
  return <Card>
    <div className="border-b border-slate-100 p-5"><div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-violet-700" /><h2 className="font-bold text-slate-950">Оплаты из ДДС требуют подтверждения</h2><span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-800">{payments.length}</span></div><p className="mt-1 text-sm text-slate-500">Система ничего не закрывает по фамилии автоматически. Выберите сотрудника и долг, к которому относится каждая оплата.</p></div>
    <div className="divide-y divide-slate-100">
      {payments.length === 0 ? <p className="p-5 text-sm text-slate-500">Нераспределённых зарплатных оплат нет.</p> : payments.map((payment) => <PaymentAllocationRow key={payment.id} payment={payment} data={data} disabled={disabled} onAllocate={onAllocate} />)}
    </div>
  </Card>;
}

function PaymentAllocationRow({ payment, data, disabled, onAllocate }: { payment: Payment; data: PayrollData; disabled: boolean; onAllocate: (input: AllocationInput) => Promise<void> }) {
  const [employeeId, setEmployeeId] = useState("");
  const [target, setTarget] = useState("");
  const alreadyAllocated = data.allocations.filter((item) => item.paymentId === payment.id).reduce((sum, item) => sum + item.amount, 0);
  const available = Math.max(0, Math.round((Math.abs(payment.amount) - alreadyAllocated) * 100) / 100);
  const [amount, setAmount] = useState(available);
  const employeeEntries = data.entries.filter((entry) => entry.employeeId === employeeId).map((entry) => {
    const period = data.periods.find((item) => item.id === entry.periodId);
    const employee = data.employees.find((item) => item.id === employeeId);
    const due = employee ? payrollEntryTotal(employee, draftFromEntry(entry)) : 0;
    const paid = data.allocations.filter((item) => item.entryId === entry.id).reduce((sum, item) => sum + item.amount, 0);
    return { entry, period, remaining: Math.max(0, due - paid) };
  }).filter((item) => item.remaining > 0.009).sort((a, b) => (b.period?.payDate ?? "").localeCompare(a.period?.payDate ?? ""));
  const employeeDebts = data.debts.filter((debt) => debt.employeeId === employeeId).map((debt) => ({ debt, remaining: Math.max(0, debt.amount - allocatedToDebt(debt.id, data.allocations)) })).filter((item) => item.remaining > 0.009);
  const selectedEntry = employeeEntries.find((item) => `entry:${item.entry.id}` === target);
  const selectedDebt = employeeDebts.find((item) => `debt:${item.debt.id}` === target);
  const targetRemaining = selectedEntry?.remaining ?? selectedDebt?.remaining ?? 0;
  const selectedEntryKind = selectedEntry?.period?.payDate && selectedEntry.period.payDate < todayISO()
    ? (selectedEntry.period.payDate.slice(0, 4) < todayISO().slice(0, 4) ? "prior_year_debt" : "current_year_debt")
    : "current_salary";
  return <div className="grid gap-3 p-5 lg:grid-cols-[1.2fr_1fr_1.5fr_140px_auto] lg:items-end">
    <div><p className="font-bold text-rose-700">{formatMoney(Math.abs(payment.amount))} · {formatDate(payment.date)}</p><p className="mt-1 text-sm text-slate-700">{payment.counterparty || payment.name}</p><p className="mt-1 text-xs text-slate-500">{payment.comment || payment.category || "Без комментария"}</p>{alreadyAllocated > 0 && <p className="mt-1 text-xs font-semibold text-emerald-700">Уже распределено: {formatMoney(alreadyAllocated)}</p>}</div>
    <label className="text-xs font-semibold text-slate-600">Сотрудник<select value={employeeId} onChange={(event) => { setEmployeeId(event.target.value); setTarget(""); }} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">Выберите</option>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}</select></label>
    <label className="text-xs font-semibold text-slate-600">Куда отнести<select value={target} onChange={(event) => { setTarget(event.target.value); const option = employeeEntries.find((item) => `entry:${item.entry.id}` === event.target.value)?.remaining ?? employeeDebts.find((item) => `debt:${item.debt.id}` === event.target.value)?.remaining; if (option) setAmount(Math.min(available, option)); }} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">Выберите начисление</option>{employeeEntries.map(({ entry, period, remaining }) => { const kind = period?.payDate && period.payDate < todayISO() ? (period.payDate.slice(0, 4) < todayISO().slice(0, 4) ? "Долг прошлых лет" : "Долг текущего года") : "Текущая зарплата"; return <option key={entry.id} value={`entry:${entry.id}`}>{kind}: {period ? `${formatDate(period.periodStart)}–${formatDate(period.periodEnd)}` : "период"} · {formatMoney(remaining)}</option>; })}{employeeDebts.map(({ debt, remaining }) => <option key={debt.id} value={`debt:${debt.id}`}>Долг за {debt.debtYear} год · осталось {formatMoney(remaining)}</option>)}</select></label>
    <MoneyInput label={`Сумма (доступно ${formatMoney(available)})`} value={amount} onChange={setAmount} />
    <button type="button" disabled={disabled || !employeeId || !target || amount <= 0 || amount > available || amount > targetRemaining} onClick={() => void onAllocate({ paymentId: payment.id, employeeId, entryId: selectedEntry?.entry.id, debtOpeningId: selectedDebt?.debt.id, amount, allocationKind: selectedDebt ? (selectedDebt.debt.debtYear < new Date().getFullYear() ? "prior_year_debt" : "current_year_debt") : selectedEntryKind })} className="min-h-11 rounded-lg bg-violet-600 px-4 text-sm font-bold text-white disabled:opacity-40">Подтвердить</button>
  </div>;
}

function EmployeeProfile({ employee, data, payments, preview, onSaveDebt }: { employee: PayrollEmployee; data: PayrollData; payments: Payment[]; preview: boolean; onSaveDebt: (year: number, amount: number, comment: string) => Promise<void> }) {
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [amount, setAmount] = useState(0);
  const entries = data.entries.filter((entry) => entry.employeeId === employee.id).map((entry) => ({ entry, period: data.periods.find((period) => period.id === entry.periodId) })).sort((a, b) => (b.period?.payDate ?? "").localeCompare(a.period?.payDate ?? ""));
  const allocations = data.allocations.filter((item) => item.employeeId === employee.id);
  const currentYear = new Date().getFullYear();
  const entryOutstanding = entries.map(({ entry, period }) => ({ year: Number(period?.payDate.slice(0, 4) ?? currentYear), amount: Math.max(0, payrollEntryTotal(employee, draftFromEntry(entry)) - data.allocations.filter((item) => item.entryId === entry.id).reduce((sum, item) => sum + item.amount, 0)) }));
  const debtOutstanding = data.debts.filter((debt) => debt.employeeId === employee.id).map((debt) => ({ year: debt.debtYear, amount: Math.max(0, debt.amount - allocatedToDebt(debt.id, data.allocations)) }));
  const previousDebt = [...entryOutstanding, ...debtOutstanding].filter((item) => item.year < currentYear).reduce((sum, item) => sum + item.amount, 0);
  const currentDebt = [...entryOutstanding, ...debtOutstanding].filter((item) => item.year === currentYear).reduce((sum, item) => sum + item.amount, 0);
  return <div className="mb-5 space-y-4 rounded-xl bg-slate-50 p-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Оклад" value={formatMoney(employee.monthlySalary)} /><Metric label="Долг прошлых лет" value={formatMoney(previousDebt)} tone="rose" /><Metric label="Долг текущего года" value={formatMoney(currentDebt)} tone="amber" /><Metric label="Подтверждено оплат" value={formatMoney(allocations.reduce((sum, item) => sum + item.amount, 0))} tone="green" /></div>
    <div><h3 className="text-sm font-bold text-slate-900">Начисления и остатки</h3>{entries.length ? <div className="mt-2 max-h-44 overflow-auto rounded-lg border bg-white">{entries.map(({ entry, period }) => { const due = payrollEntryTotal(employee, draftFromEntry(entry)); const paid = data.allocations.filter((item) => item.entryId === entry.id).reduce((sum, item) => sum + item.amount, 0); return <div key={entry.id} className="flex justify-between gap-3 border-b px-3 py-2 text-xs last:border-0"><span>{period ? `${formatDate(period.periodStart)}–${formatDate(period.periodEnd)}` : "Период"}</span><span>Начислено {formatMoney(due)} · оплачено {formatMoney(paid)} · <strong>осталось {formatMoney(Math.max(0, due - paid))}</strong></span></div>; })}</div> : <p className="mt-1 text-xs text-slate-500">Начислений пока нет.</p>}</div>
    <div><h3 className="text-sm font-bold text-slate-900">История подтверждённых оплат</h3>{allocations.length ? <div className="mt-2 space-y-1">{allocations.map((item) => { const payment = payments.find((row) => row.id === item.paymentId); return <p key={item.id} className="text-xs text-slate-600">{payment ? formatDate(payment.date) : formatDate(item.confirmedAt.slice(0, 10))} · {formatMoney(item.amount)} · {item.allocationKind === "prior_year_debt" ? "долг прошлых лет" : item.allocationKind === "current_year_debt" ? "долг текущего года" : "текущая зарплата"}</p>; })}</div> : <p className="mt-1 text-xs text-slate-500">Подтверждённых оплат пока нет.</p>}</div>
    {!preview && employee.id && <div className="grid gap-2 sm:grid-cols-[120px_1fr_auto] sm:items-end"><label className="text-xs font-semibold">Год долга<input type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border px-3" /></label><MoneyInput label="Начальный долг" value={amount} onChange={setAmount} /><button type="button" disabled={amount < 0} onClick={() => void onSaveDebt(year, amount, "Начальный долг по зарплате")} className="min-h-11 rounded-lg border border-violet-300 px-3 text-sm font-semibold text-violet-700">Сохранить долг</button></div>}
  </div>;
}

function RequisitesCard({ employees, preview, onImported }: { employees: PayrollEmployee[]; preview: boolean; onImported: () => Promise<void> }) {
  const [message, setMessage] = useState("");
  const importFile = async (file: File) => {
    try {
      const grid = await readFirstSheetXlsx(file);
      const records = grid.slice(2).map((row) => ({ fullName: String(row[1] ?? "").trim(), paymentDetails: String(row[17] ?? "").trim(), bankName: String(row[18] ?? "").trim(), phone: String(row[24] ?? "").trim() })).filter((row) => row.fullName);
      const updated = await importPayrollRequisites(records);
      setMessage(`Обновлены реквизиты: ${updated} сотрудников.`);
      await onImported();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Не удалось импортировать реквизиты"); }
  };
  return <Card><details><summary className="flex cursor-pointer list-none items-center gap-2 p-5 font-bold text-slate-950"><CreditCard className="h-5 w-5 text-violet-700" />Реквизиты для выплаты<span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{employees.length}</span></summary><div className="border-t p-5"><div className="mb-4 flex flex-wrap items-center gap-3"><p className="mr-auto text-sm text-slate-500">Отдельный лист для сотрудника, который проводит выплаты.</p><label className={`inline-flex min-h-11 items-center gap-2 rounded-lg border border-violet-300 px-3 text-sm font-semibold text-violet-700 ${preview ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:bg-violet-50"}`}><FileSpreadsheet className="h-4 w-4" />Загрузить реквизиты из Excel<input type="file" accept=".xlsx" disabled={preview} className="hidden" onChange={(event) => event.target.files?.[0] && void importFile(event.target.files[0])} /></label></div>{message && <p className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{message}</p>}<div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[860px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">Сотрудник</th><th className="px-5 py-3">Способ</th><th className="px-5 py-3">Банк</th><th className="px-5 py-3">Реквизиты</th><th className="px-5 py-3">Телефон</th></tr></thead><tbody className="divide-y">{employees.map((employee) => <tr key={employee.id}><td className="px-5 py-3 font-semibold">{employee.fullName}</td><td className="px-5 py-3">{PAYMENT_METHOD_LABELS[employee.defaultPaymentMethod]}</td><td className="px-5 py-3">{employee.bankName || "Не указан"}</td><td className="px-5 py-3 whitespace-pre-line">{employee.paymentDetails || employee.paymentDetailsMasked || "Не заполнено"}</td><td className="px-5 py-3">{employee.phone || "Не заполнено"}</td></tr>)}</tbody></table></div></div></details></Card>;
}

function AccrualInputs({ employee, draft, onChange }: { employee: PayrollEmployee; draft: PayrollDraftEntry; onChange: (patch: Partial<PayrollDraftEntry>) => void }) {
  const half = Math.round(employee.monthlySalary * 50) / 100;
  return <div className="w-64 space-y-2">
    {(employee.employmentType === "official" || employee.employmentType === "partial") && <MoneyInput label="Официально" value={draft.officialAmount} onChange={(officialAmount) => onChange({ officialAmount })} />}
    {(employee.employmentType === "unofficial" || employee.employmentType === "partial") && <MoneyInput label="Неофициально" value={draft.unofficialAmount} onChange={(unofficialAmount) => onChange({ unofficialAmount })} />}
    {(employee.employmentType === "individual_entrepreneur" || employee.employmentType === "self_employed") && <MoneyInput label="По договору" value={draft.contractorAmount} onChange={(contractorAmount) => onChange({ contractorAmount })} />}
    {employee.monthlySalary > 0 && <button type="button" onClick={() => {
      if (employee.employmentType === "official") onChange({ officialAmount: half });
      else if (employee.employmentType === "unofficial") onChange({ unofficialAmount: half });
      else if (employee.employmentType === "individual_entrepreneur" || employee.employmentType === "self_employed") onChange({ contractorAmount: half });
    }} className="text-left text-xs font-semibold text-violet-700 hover:text-violet-900">Подставить ½ оклада ({formatMoney(half)})</button>}
  </div>;
}

function MoneyInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="block text-xs font-semibold text-slate-600">{label}
    <input type="number" min="0" step="0.01" value={value || ""} onChange={(event) => onChange(Math.max(0, Math.round(Number(event.target.value || 0) * 100) / 100))} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm tabular-nums focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
  </label>;
}

function Metric({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "amber" | "violet" | "green" | "rose" }) {
  const styles = { slate: "bg-slate-50 text-slate-950", amber: "bg-amber-50 text-amber-900", violet: "bg-violet-50 text-violet-950", green: "bg-emerald-50 text-emerald-900", rose: "bg-rose-50 text-rose-900" };
  return <div className={`rounded-xl p-3 ${styles[tone]}`}><p className="text-xs uppercase tracking-wide opacity-70">{label}</p><p className="mt-1 text-lg font-bold tabular-nums">{value}</p></div>;
}

function EmployeeSection({ title, icon, employees, debtByEmployee, onEdit, action, empty = "Нет сотрудников" }: { title: string; icon: ReactNode; employees: PayrollEmployee[]; debtByEmployee: Map<string, number>; onEdit: (employee: PayrollEmployee) => void; action?: ReactNode; empty?: string }) {
  return <Card>
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-5"><div className="flex items-center gap-2">{icon}<h2 className="font-bold text-slate-950">{title}</h2><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{employees.length}</span></div>{action}</div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead><tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-5 py-3">ФИО и должность</th><th className="px-5 py-3">Оформление</th><th className="px-5 py-3">Компания / проект</th><th className="px-5 py-3">Оклад</th><th className="px-5 py-3">Выплата</th><th className="px-5 py-3 text-right">Долг</th><th className="px-5 py-3"><span className="sr-only">Действия</span></th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {employees.length === 0 ? <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-400">{empty}</td></tr> : employees.map((employee) => <tr key={employee.id} className="hover:bg-slate-50/70">
            <td className="px-5 py-3"><p className="font-semibold text-slate-950">{employee.fullName}</p><p className="mt-1 text-xs text-slate-500">{employee.position || "Должность не указана"}{employee.city ? ` · ${employee.city}` : ""}</p></td>
            <td className="px-5 py-3"><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{EMPLOYMENT_LABELS[employee.employmentType]}</span></td>
            <td className="px-5 py-3 text-slate-600">{employee.employerName || "Компания не указана"}<p className="mt-1 text-xs text-slate-400">{employee.project || "Проект не указан"}</p></td>
            <td className="px-5 py-3 font-semibold tabular-nums">{formatMoney(employee.monthlySalary)}</td>
            <td className="px-5 py-3 text-slate-600">{PAYMENT_METHOD_LABELS[employee.defaultPaymentMethod]}<p className="mt-1 text-xs text-slate-400">{employee.bankName || "Банк не указан"}</p></td>
            <td className={`px-5 py-3 text-right font-bold tabular-nums ${(debtByEmployee.get(employee.id) ?? 0) > 0 ? "text-rose-700" : "text-emerald-700"}`}>{formatMoney(debtByEmployee.get(employee.id) ?? 0)}</td>
            <td className="px-5 py-3 text-right"><button type="button" aria-label={`Редактировать ${employee.fullName}`} onClick={() => onEdit(employee)} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-violet-50 hover:text-violet-700"><Pencil className="h-4 w-4" /></button></td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </Card>;
}

function newEmployee(): PayrollEmployee {
  return { id: "", fullName: "", employmentStatus: "active", employmentType: "unofficial", hireDate: todayISO(), terminationDate: null, employerName: "", companyId: null, position: "", project: "", city: "", monthlySalary: 0, taxRate: null, defaultPaymentMethod: "card", bankName: "", phone: "", paymentDetails: "", paymentDetailsMasked: "", notes: "" };
}

function EmployeeForm({ employee, companies, onChange, onSave, onCancel, saving, preview }: { employee: PayrollEmployee; companies: DdsCompany[]; onChange: (employee: PayrollEmployee) => void; onSave: () => Promise<void>; onCancel: () => void; saving: boolean; preview: boolean }) {
  const patch = (value: Partial<PayrollEmployee>) => onChange({ ...employee, ...value });
  return <div className="space-y-4">
    <label className="block text-sm font-semibold text-slate-700">ФИО<input value={employee.fullName} onChange={(event) => patch({ fullName: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold text-slate-700">Статус<select value={employee.employmentStatus} onChange={(event) => patch({ employmentStatus: event.target.value as PayrollEmployee["employmentStatus"] })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="active">Действующий</option><option value="terminated">Уволен</option></select></label>
      <label className="text-sm font-semibold text-slate-700">Оформление<select value={employee.employmentType} onChange={(event) => patch({ employmentType: event.target.value as PayrollEmploymentType })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">{Object.entries(EMPLOYMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm font-semibold text-slate-700">Оклад<input type="number" min="0" step="0.01" value={employee.monthlySalary || ""} onChange={(event) => patch({ monthlySalary: Math.max(0, Number(event.target.value || 0)) })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
      <label className="text-sm font-semibold text-slate-700">Дата приёма<input type="date" value={employee.hireDate ?? ""} onChange={(event) => patch({ hireDate: event.target.value || null })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
      <label className="text-sm font-semibold text-slate-700">Дата увольнения<input type="date" value={employee.terminationDate ?? ""} onChange={(event) => patch({ terminationDate: event.target.value || null })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
      <label className="text-sm font-semibold text-slate-700">Должность<input value={employee.position} onChange={(event) => patch({ position: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
      <label className="text-sm font-semibold text-slate-700">Проект<input value={employee.project} onChange={(event) => patch({ project: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
      <label className="text-sm font-semibold text-slate-700">Компания<select value={employee.companyId ?? ""} onChange={(event) => patch({ companyId: event.target.value || null, employerName: companies.find((company) => company.id === event.target.value)?.name ?? employee.employerName })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="">Не связана со справочником</option>{companies.filter((company) => company.isActive).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
      <label className="text-sm font-semibold text-slate-700">Способ выплаты<select value={employee.defaultPaymentMethod} onChange={(event) => patch({ defaultPaymentMethod: event.target.value as PayrollPaymentMethod })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">{Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm font-semibold text-slate-700">Ставка налога, %<input type="number" min="0" max="100" step="0.01" value={employee.taxRate ?? ""} onChange={(event) => patch({ taxRate: event.target.value === "" ? null : Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
      <label className="text-sm font-semibold text-slate-700">Банк<input value={employee.bankName} onChange={(event) => patch({ bankName: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
      <label className="text-sm font-semibold text-slate-700">Телефон<input value={employee.phone} onChange={(event) => patch({ phone: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
    </div>
    <label className="block text-sm font-semibold text-slate-700">Полные реквизиты<textarea value={employee.paymentDetails} onChange={(event) => patch({ paymentDetails: event.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
    <label className="block text-sm font-semibold text-slate-700">Маскированные реквизиты<input value={employee.paymentDetailsMasked} onChange={(event) => patch({ paymentDetailsMasked: event.target.value })} placeholder="Например: карта •••• 1234" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
    <label className="block text-sm font-semibold text-slate-700">Комментарий<textarea value={employee.notes} onChange={(event) => patch({ notes: event.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
    <div className="flex justify-end gap-2"><button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700">Закрыть</button><button type="button" disabled={preview || saving || !employee.fullName.trim()} onClick={() => void onSave()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-bold text-white disabled:opacity-40">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{preview ? "Доступно после внедрения" : "Сохранить"}</button></div>
  </div>;
}
