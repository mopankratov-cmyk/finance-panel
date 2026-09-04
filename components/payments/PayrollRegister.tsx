"use client";

import { AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, ClipboardList, FileSpreadsheet, LayoutDashboard, Landmark, Loader2, Pencil, Plus, RefreshCw, Save, Trash2, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import { consumedFactIds } from "@/lib/finance/factLinks";
import { paymentIsPayrollCandidate } from "@/lib/payroll/model";
import type { Account, Payment } from "@/lib/types";
import type { DdsCompany } from "./ddsCompanies";
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
  payrollLineTaxIsPayable,
  payrollSalaryAmount,
  payrollTaxAmount,
  settlementFromAllocations,
  type PayrollData,
  type PayrollDraftEntry,
  type PayrollEmployee,
  type PayrollEmploymentType,
  type PayrollAccrualLine,
  type PayrollPaymentMethod,
} from "./payroll";
import { allocatePayrollPayment, importPayrollStaffFile, importPayrollStaffPrivateFile, loadPayrollData, savePayrollDebt, savePayrollEmployee, savePayrollPeriod } from "./payrollStore";

const EMPTY_DATA: PayrollData = { employees: [], periods: [], entries: [], debts: [], allocations: [] };
// Разбор штатного Excel — на сервере (lib/payroll/staffSheet.ts); форма только отправляет файл.

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
  const [activeView, setActiveView] = useState<"summary" | "staff" | "requisites" | "register">("summary");

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
    const consumed = consumedFactIds(payments);
    const employeeWords = data.employees.map((employee) => employee.fullName.toLowerCase().split(" ")[0]).filter(Boolean);
    return payments.filter((payment) => {
      if (!paymentIsPayrollCandidate(payment)) return false;
      const payrollAllocated = allocated.get(payment.id) ?? 0;
      if (consumed.has(payment.id) && payrollAllocated <= 0) return false;
      const remaining = Math.abs(payment.amount) - payrollAllocated;
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
    return draft && draft.lines.some((line) => payrollLineTaxIsPayable(employee, line) && line.amount > 0 && line.taxAmount === 0);
  });

  const updateDraft = (employeeId: string, patch: Partial<PayrollDraftEntry>) => {
    setDrafts((current) => ({ ...current, [employeeId]: { ...current[employeeId], ...patch } }));
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
      if (data.preview) {
        setSuccess("Предпросмотр ведомости сохранён на экране. После внедрения эти же строки запишутся в календарь.");
        return;
      }
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

      <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-2 xl:grid-cols-4" role="tablist" aria-label="Разделы зарплатной ведомости">
        <PayrollTab active={activeView === "summary"} icon={<LayoutDashboard className="h-4 w-4" />} label="Свод" description="Начисления, оплаты и долги" onClick={() => setActiveView("summary")} />
        <PayrollTab active={activeView === "staff"} icon={<UsersRound className="h-4 w-4" />} label="Штат" description="Сотрудники, должности и оклады" onClick={() => setActiveView("staff")} />
        <PayrollTab active={activeView === "requisites"} icon={<Landmark className="h-4 w-4" />} label="Реквизиты" description="Банки, карты и контакты" onClick={() => setActiveView("requisites")} />
        <PayrollTab active={activeView === "register"} icon={<ClipboardList className="h-4 w-4" />} label="Зарплатная ведомость" description="Выплаты 5-го и 20-го числа" onClick={() => setActiveView("register")} />
      </div>

      <div className={activeView === "summary" ? "space-y-5" : "hidden"} role="tabpanel">
        <PayrollSummary data={data} debtByEmployee={debtByEmployee} />
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
        <SummaryEmployeeSection title="Действующие сотрудники" employees={activeEmployees} data={data} payments={payments} debtByEmployee={debtByEmployee} onEdit={(employee) => { setEditingEmployee(employee); setEmployeeModalOpen(true); }} defaultOpen />
        <SummaryEmployeeSection title="Уволенные сотрудники" employees={formerEmployees} data={data} payments={payments} debtByEmployee={debtByEmployee} onEdit={(employee) => { setEditingEmployee(employee); setEmployeeModalOpen(true); }} />
        <SummaryEmployeeSection title="Все сотрудники" employees={data.employees} data={data} payments={payments} debtByEmployee={debtByEmployee} onEdit={(employee) => { setEditingEmployee(employee); setEmployeeModalOpen(true); }} />
      </div>

      <div className={activeView === "register" ? "space-y-5" : "hidden"} role="tabpanel">
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
          <PayrollLinesTable employees={employeesForPeriod} drafts={drafts} companies={companies} accounts={accounts} onEdit={(employee) => { setEditingEmployee(employee); setEmployeeModalOpen(true); }} onChange={(employeeId, lines) => updateDraft(employeeId, { lines })} />
          <div className="mt-4 flex justify-end">
            <button type="button" disabled={saving || !range || employeesForPeriod.length === 0} onClick={() => void savePeriod()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-5 text-sm font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? "Сохраняю…" : "Сохранить и обновить календарь"}
            </button>
          </div>
        </div>
      </Card>

      </div>

      <div className={activeView === "staff" ? "space-y-5" : "hidden"} role="tabpanel">
        <StaffDirectory activeEmployees={activeEmployees} formerEmployees={formerEmployees} companies={companies} preview={Boolean(data.preview)} canViewPrivate={Boolean(data.canViewPrivate)} onEdit={(employee) => { setEditingEmployee(employee); setEmployeeModalOpen(true); }} onAdd={!data.preview ? openNewEmployee : undefined} onImported={load} onPreviewLoaded={(employees) => setData((current) => ({ ...current, employees, preview: true }))} />
      </div>

      <div className={activeView === "requisites" ? "space-y-5" : "hidden"} role="tabpanel">
        <RequisitesDirectory employees={data.employees} canViewPrivate={Boolean(data.canViewPrivate)} onEdit={(employee) => { setEditingEmployee(employee); setEmployeeModalOpen(true); }} />
      </div>

      <Modal open={employeeModalOpen} onClose={() => setEmployeeModalOpen(false)} title={editingEmployee?.id ? "Карточка сотрудника" : "Новый сотрудник"}>
        {editingEmployee && <><EmployeeProfile employee={editingEmployee} data={data} payments={payments} preview={Boolean(data.preview)} onSaveDebt={async (year, amount, comment) => { await savePayrollDebt(editingEmployee.id, year, amount, comment); await load(); }} /><EmployeeForm employee={editingEmployee} companies={companies} canViewPrivate={Boolean(data.canViewPrivate)} onChange={setEditingEmployee} onCancel={() => setEmployeeModalOpen(false)} onSave={async () => {
          try {
            setSaving(true);
            if (data.preview) {
              setData((current) => ({ ...current, employees: current.employees.map((employee) => employee.id === editingEmployee.id ? editingEmployee : employee) }));
              setEmployeeModalOpen(false);
              setSuccess("Изменения сохранены в предпросмотре. После внедрения они будут сохраняться в базе.");
              return;
            }
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

function PayrollTab({ active, icon, label, description, onClick }: { active: boolean; icon: ReactNode; label: string; description: string; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-violet-300 ${active ? "bg-violet-600 text-white shadow-sm" : "text-slate-700 hover:bg-slate-50"}`}>
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active ? "bg-white/15" : "bg-violet-50 text-violet-700"}`}>{icon}</span>
    <span><span className="block text-sm font-bold">{label}</span><span className={`mt-0.5 block text-xs ${active ? "text-violet-100" : "text-slate-500"}`}>{description}</span></span>
  </button>;
}

function PayrollSummary({ data, debtByEmployee }: { data: PayrollData; debtByEmployee: Map<string, number> }) {
  const accrued = data.entries.reduce((total, entry) => {
    const employee = data.employees.find((item) => item.id === entry.employeeId);
    return total + (employee ? payrollEntryTotal(employee, draftFromEntry(entry)) : 0);
  }, 0);
  const paid = data.allocations.reduce((total, allocation) => total + allocation.amount, 0);
  const debt = [...debtByEmployee.values()].reduce((total, amount) => total + amount, 0);
  const nextDate = nextPayrollDate(todayISO());
  return <Card><div className="p-5"><div className="flex items-center gap-2"><LayoutDashboard className="h-5 w-5 text-violet-700" /><div><h2 className="text-lg font-bold text-slate-950">Свод по зарплате</h2><p className="text-sm text-slate-500">Короткая картина начислений, оплат и задолженности.</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Всего начислено" value={formatMoney(accrued)} tone="violet" /><Metric label="Подтверждено оплат" value={formatMoney(paid)} tone="green" /><Metric label="Подтверждённый долг" value={formatMoney(debt)} tone={debt > 0 ? "rose" : "green"} /><Metric label="Ближайшая выплата" value={formatDate(nextDate)} /></div></div></Card>;
}

function SummaryEmployeeSection({ title, employees, data, payments, debtByEmployee, onEdit, defaultOpen = false }: { title: string; employees: PayrollEmployee[]; data: PayrollData; payments: Payment[]; debtByEmployee: Map<string, number>; onEdit: (employee: PayrollEmployee) => void; defaultOpen?: boolean }) {
  const totalDebt = employees.reduce((sum, employee) => sum + (debtByEmployee.get(employee.id) ?? 0), 0);
  const periods = data.periods.filter((period) => data.entries.some((entry) => entry.periodId === period.id)).sort((left, right) => left.payDate.localeCompare(right.payDate));
  const columnCount = 3 + periods.length * 3;
  const historyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const table = historyRef.current;
    if (table) table.scrollLeft = table.scrollWidth;
  }, [periods.length, employees.length]);
  return <Card><details open={defaultOpen} className="group"><summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-5 py-4 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-300"><div className="min-w-0 flex-1"><h3 className="font-bold text-slate-950">{title}</h3><p className="mt-0.5 text-sm text-slate-500">{employees.length} сотрудников · подтверждённый остаток {formatMoney(totalDebt)} · последние даты открыты сразу</p></div><ChevronDown className="h-5 w-5 text-slate-400 transition-transform group-open:rotate-180" /></summary><div ref={historyRef} className="overflow-x-auto border-t border-slate-100"><table className="w-full min-w-max text-sm"><thead><tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><th rowSpan={2} className="sticky left-0 z-20 min-w-[230px] border-r border-slate-200 bg-slate-50 px-5 py-3">Сотрудник</th>{periods.map((period) => <th key={period.id} colSpan={3} className="border-l border-slate-200 bg-slate-100 px-3 py-2 text-center"><span className="block font-bold text-slate-700">Выплата {formatDate(period.payDate)}</span><span className="mt-0.5 block normal-case tracking-normal text-slate-500">за {formatDate(period.periodStart)}–{formatDate(period.periodEnd)}</span></th>)}<th rowSpan={2} className="min-w-[145px] border-l border-slate-200 bg-slate-50 px-4 py-3 text-right">Всего долг</th><th rowSpan={2} className="w-16 bg-slate-50 px-3 py-3"><span className="sr-only">Открыть карточку</span></th></tr><tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">{periods.flatMap((period) => [<th key={`${period.id}:accrual`} className="min-w-[120px] border-l border-slate-200 px-3 py-2 text-right">Начислено</th>, <th key={`${period.id}:paid`} className="min-w-[130px] px-3 py-2 text-right">Оплачено</th>, <th key={`${period.id}:debt`} className="min-w-[120px] px-3 py-2 text-right">Остаток</th>])}</tr></thead><tbody className="divide-y divide-slate-100">{employees.length === 0 ? <tr><td colSpan={columnCount} className="px-5 py-8 text-center text-slate-400">Сотрудников нет</td></tr> : employees.map((employee) => <tr key={employee.id} className="hover:bg-slate-50/70"><td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-5 py-3"><button type="button" onClick={() => onEdit(employee)} className="min-h-11 cursor-pointer text-left font-semibold text-slate-950 hover:text-violet-700"><span className="block">{employee.fullName}</span><span className="mt-0.5 block text-xs font-normal text-slate-500">{employee.position || EMPLOYMENT_LABELS[employee.employmentType]}</span></button></td>{periods.flatMap((period) => { const entry = data.entries.find((item) => item.employeeId === employee.id && item.periodId === period.id); if (!entry) return [<td key={`${period.id}:accrual`} className="border-l border-slate-100 px-3 py-3 text-right text-slate-300">—</td>, <td key={`${period.id}:paid`} className="px-3 py-3 text-right text-slate-300">—</td>, <td key={`${period.id}:debt`} className="px-3 py-3 text-right text-slate-300">—</td>]; const due = payrollEntryTotal(employee, draftFromEntry(entry)); const allocations = data.allocations.filter((item) => item.entryId === entry.id); const paid = allocations.reduce((sum, item) => sum + item.amount, 0); const dates = [...new Set(allocations.map((item) => payments.find((payment) => payment.id === item.paymentId)?.date ?? item.confirmedAt.slice(0, 10)))].map(formatDate).join(", "); const remaining = Math.max(0, due - paid); return [<td key={`${period.id}:accrual`} className="border-l border-slate-100 bg-sky-50/70 px-3 py-3 text-right font-semibold tabular-nums text-slate-900"><span className="block">{formatMoney(due)}</span><span className="mt-1 block text-[11px] font-normal text-slate-500">начислено {formatDate(period.payDate)}</span></td>, <td key={`${period.id}:paid`} className="px-3 py-3 text-right tabular-nums text-emerald-700"><span className="block font-semibold">{paid ? formatMoney(paid) : "—"}</span>{dates && <span className="mt-1 block text-[11px] text-slate-500">{dates}</span>}</td>, <td key={`${period.id}:debt`} className={`px-3 py-3 text-right font-bold tabular-nums ${remaining > 0 ? "text-rose-700" : "text-emerald-700"}`}>{formatMoney(remaining)}</td>]; })}<td className={`border-l border-slate-200 px-4 py-3 text-right font-bold tabular-nums ${(debtByEmployee.get(employee.id) ?? 0) > 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{formatMoney(debtByEmployee.get(employee.id) ?? 0)}</td><td className="px-3 py-3"><button type="button" aria-label={`Открыть карточку ${employee.fullName}`} onClick={() => onEdit(employee)} className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-slate-500 hover:bg-violet-50 hover:text-violet-700"><Pencil className="h-4 w-4" /></button></td></tr>)}</tbody></table></div></details></Card>;
}

type AllocationInput = Parameters<typeof allocatePayrollPayment>[0];
type PayrollEntryTarget = {
  entry: PayrollData["entries"][number];
  period: PayrollData["periods"][number] | undefined;
  line: PayrollAccrualLine | null;
  remaining: number;
};

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
  const employeeEntries = data.entries.filter((entry) => entry.employeeId === employeeId).reduce<PayrollEntryTarget[]>((items, entry) => {
    const period = data.periods.find((item) => item.id === entry.periodId);
    const employee = data.employees.find((item) => item.id === employeeId);
    if (!employee) return items;
    if (entry.lines.length === 0) {
      const due = payrollEntryTotal(employee, draftFromEntry(entry));
      const paid = data.allocations.filter((item) => item.entryId === entry.id && !item.payrollLineId).reduce((sum, item) => sum + item.amount, 0);
      items.push({ entry, period, line: null, remaining: Math.max(0, due - paid) });
      return items;
    }
    for (const line of entry.lines) {
      const due = line.amount + (line.kind === "unofficial" || line.paymentMethod === "cash" ? 0 : line.taxAmount);
      const paid = data.allocations.filter((item) => item.entryId === entry.id && item.payrollLineId === line.id).reduce((sum, item) => sum + item.amount, 0);
      items.push({ entry, period, line, remaining: Math.max(0, due - paid) });
    }
    return items;
  }, []).filter((item) => item.remaining > 0.009).sort((a, b) => (b.period?.payDate ?? "").localeCompare(a.period?.payDate ?? ""));
  const employeeDebts = data.debts.filter((debt) => debt.employeeId === employeeId).map((debt) => ({ debt, remaining: Math.max(0, debt.amount - allocatedToDebt(debt.id, data.allocations)) })).filter((item) => item.remaining > 0.009);
  const selectedEntry = employeeEntries.find((item) => `entry:${item.entry.id}:${item.line?.id ?? "all"}` === target);
  const selectedDebt = employeeDebts.find((item) => `debt:${item.debt.id}` === target);
  const targetRemaining = selectedEntry?.remaining ?? selectedDebt?.remaining ?? 0;
  const selectedEntryKind = selectedEntry?.period?.payDate && selectedEntry.period.payDate < todayISO()
    ? (selectedEntry.period.payDate.slice(0, 4) < todayISO().slice(0, 4) ? "prior_year_debt" : "current_year_debt")
    : "current_salary";
  return <div className="grid gap-3 p-5 lg:grid-cols-[1.2fr_1fr_1.5fr_140px_auto] lg:items-end">
    <div><p className="font-bold text-rose-700">{formatMoney(Math.abs(payment.amount))} · {formatDate(payment.date)}</p><p className="mt-1 text-sm text-slate-700">{payment.counterparty || payment.name}</p><p className="mt-1 text-xs text-slate-500">{payment.comment || payment.category || "Без комментария"}</p>{alreadyAllocated > 0 && <p className="mt-1 text-xs font-semibold text-emerald-700">Уже распределено: {formatMoney(alreadyAllocated)}</p>}</div>
    <label className="text-xs font-semibold text-slate-600">Сотрудник<select value={employeeId} onChange={(event) => { setEmployeeId(event.target.value); setTarget(""); }} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">Выберите</option>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}</select></label>
    <label className="text-xs font-semibold text-slate-600">Куда отнести<select value={target} onChange={(event) => { setTarget(event.target.value); const option = employeeEntries.find((item) => `entry:${item.entry.id}:${item.line?.id ?? "all"}` === event.target.value)?.remaining ?? employeeDebts.find((item) => `debt:${item.debt.id}` === event.target.value)?.remaining; if (option) setAmount(Math.min(available, option)); }} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">Выберите начисление</option>{employeeEntries.map(({ entry, period, line, remaining }) => { const kind = period?.payDate && period.payDate < todayISO() ? (period.payDate.slice(0, 4) < todayISO().slice(0, 4) ? "Долг прошлых лет" : "Долг текущего года") : "Текущая зарплата"; const part = line ? ` · ${line.kind === "official" ? "официальная" : line.kind === "unofficial" ? "на карту" : "ИП/СЗ"}${line.comment ? ` (${line.comment})` : ""}` : ""; return <option key={`${entry.id}:${line?.id ?? "all"}`} value={`entry:${entry.id}:${line?.id ?? "all"}`}>{kind}: {period ? `${formatDate(period.periodStart)}–${formatDate(period.periodEnd)}` : "период"}{part} · {formatMoney(remaining)}</option>; })}{employeeDebts.map(({ debt, remaining }) => <option key={debt.id} value={`debt:${debt.id}`}>Долг за {debt.debtYear} год · осталось {formatMoney(remaining)}</option>)}</select></label>
    <MoneyInput label={`Сумма (доступно ${formatMoney(available)})`} value={amount} onChange={setAmount} />
    <button type="button" disabled={disabled || !employeeId || !target || amount <= 0 || amount > available || amount > targetRemaining} onClick={() => void onAllocate({ paymentId: payment.id, employeeId, entryId: selectedEntry?.entry.id, payrollLineId: selectedEntry?.line?.id, debtOpeningId: selectedDebt?.debt.id, amount, allocationKind: selectedDebt ? (selectedDebt.debt.debtYear < new Date().getFullYear() ? "prior_year_debt" : "current_year_debt") : selectedEntryKind })} className="min-h-11 rounded-lg bg-violet-600 px-4 text-sm font-bold text-white disabled:opacity-40">Подтвердить</button>
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
    <div><h3 className="text-sm font-bold text-slate-900">История подтверждённых оплат</h3>{allocations.length ? <div className="mt-2 space-y-1">{allocations.map((item) => { const payment = payments.find((row) => row.id === item.paymentId); return <p key={item.id} className="text-xs text-slate-600">{payment ? formatDate(payment.date) : formatDate(item.confirmedAt.slice(0, 10))} · {formatMoney(item.amount)} · {item.allocationKind === "prior_year_debt" ? "долг прошлых лет" : item.allocationKind === "current_year_debt" ? "долг текущего года" : "текущая зарплата"}{item.confirmedBy ? ` · подтвердил ${item.confirmedBy}` : ""}</p>; })}</div> : <p className="mt-1 text-xs text-slate-500">Подтверждённых оплат пока нет.</p>}</div>
    {!preview && employee.id && <div className="grid gap-2 sm:grid-cols-[120px_1fr_auto] sm:items-end"><label className="text-xs font-semibold">Год долга<input type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-lg border px-3" /></label><MoneyInput label="Начальный долг" value={amount} onChange={setAmount} /><button type="button" disabled={amount < 0} onClick={() => void onSaveDebt(year, amount, "Начальный долг по зарплате")} className="min-h-11 rounded-lg border border-violet-300 px-3 text-sm font-semibold text-violet-700">Сохранить долг</button></div>}
  </div>;
}

function StaffDirectory({ activeEmployees, formerEmployees, companies, preview, canViewPrivate, onEdit, onAdd, onImported, onPreviewLoaded }: { activeEmployees: PayrollEmployee[]; formerEmployees: PayrollEmployee[]; companies: DdsCompany[]; preview: boolean; canViewPrivate: boolean; onEdit: (employee: PayrollEmployee) => void; onAdd?: () => void; onImported: () => Promise<void>; onPreviewLoaded: (employees: PayrollEmployee[]) => void }) {
  const [message, setMessage] = useState("");
  const importFile = async (file: File) => {
    try {
      if (preview) {
        const result = await importPayrollStaffFile(file, { preview: true });
        onPreviewLoaded(result.employees);
        setMessage(`Предпросмотр: ${result.employees.length} сотрудников из файла. Реквизиты и контакты загрузятся при сохранении.`);
        return;
      }
      const staff = await importPayrollStaffFile(file, { preview: false });
      let privateNote = "реквизиты грузит директор";
      if (canViewPrivate) {
        const priv = await importPayrollStaffPrivateFile(file);
        privateNote = `реквизиты и контакты: ${priv.updated}`;
      }
      setMessage(`Штат обновлён: новых ${staff.created}, обновлено ${staff.updated}; ${privateNote}.`);
      await onImported();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Не удалось импортировать штат"); }
  };
  return <div className="space-y-4">
    <Card><div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center"><div className="flex min-w-0 flex-1 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><UsersRound className="h-5 w-5" /></span><div><h2 className="text-lg font-bold text-slate-950">Штат</h2><p className="mt-1 text-sm text-slate-500">Должности, оформление, город и оклады. Платёжные реквизиты вынесены в отдельную вкладку.</p></div></div><div className="flex flex-wrap gap-2">{onAdd && <button type="button" onClick={onAdd} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-bold text-white hover:bg-violet-700"><Plus className="h-4 w-4" />Добавить сотрудника</button>}{canViewPrivate && <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-violet-300 px-4 text-sm font-semibold text-violet-700 hover:bg-violet-50"><FileSpreadsheet className="h-4 w-4" />{preview ? "Загрузить сотрудников из Excel" : "Обновить данные из Excel"}<input type="file" accept=".xlsx" className="hidden" onChange={(event) => event.target.files?.[0] && void importFile(event.target.files[0])} /></label>}</div></div>{message && <p className="mx-5 mb-5 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{message}</p>}</Card>
    <StaffSection title="Действующие сотрудники" employees={activeEmployees} companies={companies} canViewPrivate={canViewPrivate} onEdit={onEdit} defaultOpen />
    <StaffSection title="Уволенные сотрудники" employees={formerEmployees} companies={companies} canViewPrivate={canViewPrivate} onEdit={onEdit} />
  </div>;
}

function StaffSection({ title, employees, companies, canViewPrivate, onEdit, defaultOpen = false }: { title: string; employees: PayrollEmployee[]; companies: DdsCompany[]; canViewPrivate: boolean; onEdit: (employee: PayrollEmployee) => void; defaultOpen?: boolean }) {
  const columns = canViewPrivate ? 12 : 9;
  const companyNames = (employee: PayrollEmployee) => employee.companyIds.map((id) => companies.find((company) => company.id === id)?.name).filter(Boolean).join(", ");
  return <Card><details open={defaultOpen} className="group"><summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-5 py-4 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-300"><div className="min-w-0 flex-1"><h3 className="font-bold text-slate-950">{title}</h3><p className="mt-0.5 text-sm text-slate-500">{employees.length} сотрудников</p></div><ChevronDown className="h-5 w-5 text-slate-400 transition-transform group-open:rotate-180" /></summary><div className="overflow-x-auto border-t border-slate-100"><table className={`w-full min-w-[1220px] text-sm ${canViewPrivate ? "xl:min-w-[1500px]" : ""}`}><thead><tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-5 py-3">ФИО</th><th className="px-4 py-3">Статус</th><th className="px-4 py-3">Трудоустройство</th><th className="px-4 py-3">Компания</th><th className="px-4 py-3">Должность</th><th className="px-4 py-3">Город</th>{canViewPrivate && <th className="px-4 py-3">Рабочая почта</th>}<th className="px-4 py-3 text-right">Оклад</th>{canViewPrivate && <th className="px-4 py-3">Дата рождения</th>}<th className="px-4 py-3">Способ выплаты</th>{canViewPrivate && <th className="px-4 py-3">Телефон</th>}<th className="w-16 px-3 py-3"><span className="sr-only">Открыть карточку</span></th></tr></thead><tbody className="divide-y divide-slate-100">{employees.length === 0 ? <tr><td colSpan={columns} className="px-5 py-8 text-center text-slate-400">Сотрудников нет</td></tr> : employees.map((employee) => <tr key={employee.id} className="align-top hover:bg-slate-50/70"><td className="px-5 py-3"><button type="button" onClick={() => onEdit(employee)} className="min-h-11 cursor-pointer text-left font-semibold text-slate-950 hover:text-violet-700">{employee.fullName}</button></td><td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${employee.employmentStatus === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{employee.employmentStatus === "active" ? "Действующий" : "Уволен"}</span></td><td className="max-w-[260px] px-4 py-3 text-slate-700">{employee.employmentDetails || EMPLOYMENT_LABELS[employee.employmentType]}</td><td className="max-w-[240px] px-4 py-3 text-slate-700">{companyNames(employee) || "Не назначена"}</td><td className="px-4 py-3 text-slate-700">{employee.position || "—"}</td><td className="px-4 py-3 text-slate-700">{employee.city || "—"}</td>{canViewPrivate && <td className="max-w-[210px] break-all px-4 py-3 text-slate-700">{employee.workEmail || "—"}</td>}<td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">{employee.monthlySalary ? formatMoney(employee.monthlySalary) : "—"}</td>{canViewPrivate && <td className="px-4 py-3 text-slate-700">{employee.birthDate ? formatDate(employee.birthDate) : "—"}</td>}<td className="px-4 py-3 text-slate-700">{PAYMENT_METHOD_LABELS[employee.defaultPaymentMethod]}</td>{canViewPrivate && <td className="px-4 py-3 text-slate-700">{employee.phone || "—"}</td>}<td className="px-3 py-3"><button type="button" aria-label={`Открыть карточку ${employee.fullName}`} onClick={() => onEdit(employee)} className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-slate-500 hover:bg-violet-50 hover:text-violet-700"><Pencil className="h-4 w-4" /></button></td></tr>)}</tbody></table></div></details></Card>;
}

function RequisitesDirectory({ employees, canViewPrivate, onEdit }: { employees: PayrollEmployee[]; canViewPrivate: boolean; onEdit: (employee: PayrollEmployee) => void }) {
  if (!canViewPrivate) return <Card><div className="p-5 text-sm text-slate-600"><h2 className="text-lg font-bold text-slate-950">Реквизиты</h2><p className="mt-1">Банковские реквизиты, телефоны и даты рождения доступны только роли директора.</p></div></Card>;
  const rows = employees.filter((employee) => employee.bankName || employee.settlementAccountDetails || employee.cardTransferDetails || employee.paymentDetails || employee.phone);
  return <Card><div className="border-b border-slate-100 p-5"><h2 className="text-lg font-bold text-slate-950">Реквизиты для оплаты</h2><p className="mt-1 text-sm text-slate-500">Показываем только данные, которые есть в карточке сотрудника. Нажмите на ФИО, чтобы исправить или дополнить.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1060px] text-sm"><thead><tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-5 py-3">Сотрудник</th><th className="px-4 py-3">Банк</th><th className="px-4 py-3">Расчётный счёт</th><th className="px-4 py-3">Карта / перевод</th><th className="px-4 py-3">Телефон</th><th className="px-4 py-3">Исходные реквизиты</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">Реквизиты ещё не загружены. Обновите данные из Excel во вкладке «Штат».</td></tr> : rows.map((employee) => <tr key={employee.id} className="align-top hover:bg-slate-50/70"><td className="px-5 py-3"><button type="button" onClick={() => onEdit(employee)} className="min-h-11 cursor-pointer text-left font-semibold text-slate-950 hover:text-violet-700">{employee.fullName}</button></td><td className="px-4 py-3 text-slate-700">{employee.bankName || "—"}</td><td className="max-w-[280px] whitespace-pre-line break-words px-4 py-3 text-slate-700">{employee.settlementAccountDetails || "—"}</td><td className="max-w-[280px] whitespace-pre-line break-words px-4 py-3 text-slate-700">{employee.cardTransferDetails || "—"}</td><td className="px-4 py-3 text-slate-700">{employee.phone || "—"}</td><td className="max-w-[300px] whitespace-pre-line break-words px-4 py-3 text-slate-500">{employee.paymentDetails || "—"}</td></tr>)}</tbody></table></div></Card>;
}

function PayrollLinesTable({ employees, drafts, companies, accounts, onEdit, onChange }: { employees: PayrollEmployee[]; drafts: Record<string, PayrollDraftEntry>; companies: DdsCompany[]; accounts: Account[]; onEdit: (employee: PayrollEmployee) => void; onChange: (employeeId: string, lines: PayrollAccrualLine[]) => void }) {
  return <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[1220px] text-sm"><thead><tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-4 py-3">Сотрудник</th><th className="px-4 py-3">Компания</th><th className="px-4 py-3">Вид начисления</th><th className="px-4 py-3">Зарплата</th><th className="px-4 py-3">Налог</th><th className="px-4 py-3">Способ оплаты</th></tr></thead><tbody className="divide-y divide-slate-100">{employees.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">На выбранный период сотрудников нет</td></tr> : employees.flatMap((employee) => {
    const lines = drafts[employee.id]?.lines ?? blankPayrollEntry(employee).lines;
    const allowedKinds: PayrollAccrualLine["kind"][] = employee.employmentType === "partial" ? ["official", "unofficial"] : employee.employmentType === "official" ? ["official"] : employee.employmentType === "unofficial" ? ["unofficial"] : ["contractor"];
    const minimumLines = employee.employmentType === "partial" ? 2 : 1;
    const patchLine = (id: string, patch: Partial<PayrollAccrualLine>) => onChange(employee.id, lines.map((line) => {
      if (line.id !== id) return line;
      const next = { ...line, ...patch };
      if (patch.companyId !== undefined) next.accountId = suggestPayrollAccount(patch.companyId, null, companies, accounts);
      if (!payrollLineTaxIsPayable(employee, next)) next.taxAmount = 0;
      else if ((patch.amount !== undefined || patch.paymentMethod !== undefined || patch.kind !== undefined) && employee.taxRate !== null) next.taxAmount = Math.round(next.amount * employee.taxRate) / 100;
      return next;
    }));
    const addLine = () => {
      const kind = allowedKinds[0];
      onChange(employee.id, [...lines, { id: crypto.randomUUID(), kind, amount: 0, taxAmount: 0, companyId: employee.companyId, accountId: suggestPayrollAccount(employee.companyId, null, companies, accounts), paymentMethod: kind === "official" || kind === "contractor" ? "bank_account" : "card", salaryPaymentId: null, taxPaymentId: null, comment: "" }]);
    };
    return lines.map((line, index) => {
      const taxPayable = payrollLineTaxIsPayable(employee, line);
      return <tr key={`${employee.id}:${line.id}`} className="align-top hover:bg-slate-50/60">{index === 0 && <td rowSpan={lines.length} className="w-[260px] border-r border-slate-100 px-4 py-3"><button type="button" onClick={() => onEdit(employee)} className="min-h-11 cursor-pointer text-left font-bold text-slate-950 hover:text-violet-700"><span className="block">{employee.fullName}</span><span className="mt-0.5 block text-xs font-normal text-slate-500">{employee.position || "Без должности"}</span><span className="mt-1 inline-flex rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">{EMPLOYMENT_LABELS[employee.employmentType]}</span></button><button type="button" onClick={addLine} className="mt-2 flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-bold text-violet-700 hover:text-violet-900"><Plus className="h-4 w-4" />Добавить строку</button></td>}<td className="w-[230px] px-3 py-3"><select aria-label={`Компания для ${employee.fullName}`} value={line.companyId ?? ""} onChange={(event) => patchLine(line.id, { companyId: event.target.value || null })} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"><option value="">Выберите компанию</option>{companies.filter((company) => company.isActive).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select>{line.amount > 0 && !line.accountId && <select aria-label={`Кошелёк для ${employee.fullName}`} value="" onChange={(event) => patchLine(line.id, { accountId: event.target.value || null })} className="mt-2 min-h-11 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs text-amber-900"><option value="">Выберите кошелёк для календаря</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>}</td><td className="w-[210px] px-3 py-3"><select aria-label={`Вид начисления для ${employee.fullName}`} value={line.kind} onChange={(event) => patchLine(line.id, { kind: event.target.value as PayrollAccrualLine["kind"] })} className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">{allowedKinds.map((kind) => <option key={kind} value={kind}>{kind === "official" ? "Официальная часть" : kind === "unofficial" ? "Неофициальная часть" : "По договору ИП/СЗ"}</option>)}</select></td><td className="w-[170px] px-3 py-3"><MoneyInput label="" value={line.amount} onChange={(amount) => patchLine(line.id, { amount })} /></td><td className="w-[170px] px-3 py-3">{taxPayable ? <><MoneyInput label="" value={line.taxAmount} onChange={(taxAmount) => patchLine(line.id, { taxAmount })} />{employee.taxRate !== null && <p className="mt-1 text-xs text-slate-500">Ставка {employee.taxRate}%</p>}</> : <span className="inline-flex min-h-11 items-center text-slate-400">Не начисляется</span>}</td><td className="px-3 py-3"><div className="flex items-start gap-2"><select aria-label={`Способ оплаты для ${employee.fullName}`} value={line.paymentMethod} onChange={(event) => patchLine(line.id, { paymentMethod: event.target.value as PayrollPaymentMethod })} className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3">{Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" aria-label={`Удалить строку ${index + 1} у ${employee.fullName}`} disabled={lines.length <= minimumLines} onClick={() => onChange(employee.id, lines.filter((item) => item.id !== line.id))} className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-25"><Trash2 className="h-4 w-4" /></button></div></td></tr>;
    });
  })}</tbody></table></div>;
}

function suggestPayrollAccount(companyId: string | null | undefined, currentAccountId: string | null, companies: DdsCompany[], accounts: Account[]): string | null {
  if (currentAccountId && accounts.some((account) => account.id === currentAccountId)) return currentAccountId;
  if (accounts.length === 1) return accounts[0].id;
  const company = companies.find((item) => item.id === companyId);
  if (!company) return null;
  const words = company.name.toLowerCase().replace(/[^а-яa-z0-9 ]/gi, " ").split(/\s+/).filter((word) => word.length > 2 && !["ооо", "ип"].includes(word));
  const matches = accounts.filter((account) => words.some((word) => account.name.toLowerCase().includes(word)));
  return matches.length === 1 ? matches[0].id : null;
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

function newEmployee(): PayrollEmployee {
  return { id: "", fullName: "", employmentStatus: "active", employmentType: "unofficial", employmentDetails: "", hireDate: todayISO(), terminationDate: null, employerName: "", companyIds: [], companyId: null, position: "", project: "", city: "", workEmail: "", birthDate: null, monthlySalary: 0, taxRate: null, defaultPaymentMethod: "card", bankName: "", phone: "", settlementAccountDetails: "", cardTransferDetails: "", paymentDetails: "", paymentDetailsMasked: "", notes: "" };
}

function EmployeeForm({ employee, companies, canViewPrivate, onChange, onSave, onCancel, saving, preview }: { employee: PayrollEmployee; companies: DdsCompany[]; canViewPrivate: boolean; onChange: (employee: PayrollEmployee) => void; onSave: () => Promise<void>; onCancel: () => void; saving: boolean; preview: boolean }) {
  const patch = (value: Partial<PayrollEmployee>) => onChange({ ...employee, ...value });
  return <div className="space-y-4">
    <label className="block text-sm font-semibold text-slate-700">ФИО<input value={employee.fullName} onChange={(event) => patch({ fullName: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold text-slate-700">Статус<select value={employee.employmentStatus} onChange={(event) => patch({ employmentStatus: event.target.value as PayrollEmployee["employmentStatus"] })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="active">Действующий</option><option value="terminated">Уволен</option></select></label>
      <label className="text-sm font-semibold text-slate-700">Оформление<select value={employee.employmentType} onChange={(event) => patch({ employmentType: event.target.value as PayrollEmploymentType })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">{Object.entries(EMPLOYMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm font-semibold text-slate-700">Трудоустройство<input value={employee.employmentDetails} onChange={(event) => patch({ employmentDetails: event.target.value })} placeholder="Например: Самозанятость ООО «РИО»" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
      <label className="text-sm font-semibold text-slate-700">Оклад<input type="number" min="0" step="0.01" value={employee.monthlySalary || ""} onChange={(event) => patch({ monthlySalary: Math.max(0, Number(event.target.value || 0)) })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
      <label className="text-sm font-semibold text-slate-700">Дата приёма<input type="date" value={employee.hireDate ?? ""} onChange={(event) => patch({ hireDate: event.target.value || null })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
      <label className="text-sm font-semibold text-slate-700">Дата увольнения<input type="date" value={employee.terminationDate ?? ""} onChange={(event) => patch({ terminationDate: event.target.value || null })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
      <label className="text-sm font-semibold text-slate-700">Должность<input value={employee.position} onChange={(event) => patch({ position: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
      <label className="text-sm font-semibold text-slate-700">Проект<input value={employee.project} onChange={(event) => patch({ project: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
      <label className="text-sm font-semibold text-slate-700">Город<input value={employee.city} onChange={(event) => patch({ city: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
      <fieldset className="sm:col-span-2"><legend className="text-sm font-semibold text-slate-700">Компании, на которые работает сотрудник</legend><p className="mt-1 text-xs text-slate-500">Можно выбрать несколько. Первая выбранная компания станет основной для новой строки ведомости.</p><div className="mt-2 grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">{companies.filter((company) => company.isActive).map((company) => { const checked = employee.companyIds.includes(company.id); return <label key={company.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-slate-800 hover:bg-slate-50"><input type="checkbox" checked={checked} onChange={() => { const companyIds = checked ? employee.companyIds.filter((id) => id !== company.id) : [...employee.companyIds, company.id]; patch({ companyIds, companyId: companyIds[0] ?? null, employerName: companyIds.map((id) => companies.find((item) => item.id === id)?.name).filter(Boolean).join(", ") }); }} className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500" />{company.name}</label>; })}</div></fieldset>
      <label className="text-sm font-semibold text-slate-700">Способ выплаты<select value={employee.defaultPaymentMethod} onChange={(event) => patch({ defaultPaymentMethod: event.target.value as PayrollPaymentMethod })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3">{Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm font-semibold text-slate-700">Ставка налога, %<input type="number" min="0" max="100" step="0.01" value={employee.taxRate ?? ""} onChange={(event) => patch({ taxRate: event.target.value === "" ? null : Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
      {canViewPrivate && <label className="text-sm font-semibold text-slate-700">Банк<input value={employee.bankName} onChange={(event) => patch({ bankName: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>}
      {canViewPrivate && <label className="text-sm font-semibold text-slate-700">Телефон<input value={employee.phone} onChange={(event) => patch({ phone: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>}
      {canViewPrivate && <label className="text-sm font-semibold text-slate-700">Рабочая почта<input type="email" value={employee.workEmail} onChange={(event) => patch({ workEmail: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>}
      {canViewPrivate && <label className="text-sm font-semibold text-slate-700">Дата рождения<input type="date" value={employee.birthDate ?? ""} onChange={(event) => patch({ birthDate: event.target.value || null })} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>}
    </div>
    {canViewPrivate && <><label className="block text-sm font-semibold text-slate-700">Реквизиты расчётного счёта<textarea value={employee.settlementAccountDetails} onChange={(event) => patch({ settlementAccountDetails: event.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><label className="block text-sm font-semibold text-slate-700">Реквизиты для перевода на карту<textarea value={employee.cardTransferDetails} onChange={(event) => patch({ cardTransferDetails: event.target.value })} rows={2} placeholder="Номер карты, получатель и банк" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><label className="block text-sm font-semibold text-slate-700">Исходные реквизиты из файла<textarea value={employee.paymentDetails} onChange={(event) => patch({ paymentDetails: event.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><label className="block text-sm font-semibold text-slate-700">Маскированные реквизиты<input value={employee.paymentDetailsMasked} onChange={(event) => patch({ paymentDetailsMasked: event.target.value })} placeholder="Например: карта •••• 1234" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label></>}
    <label className="block text-sm font-semibold text-slate-700">Комментарий<textarea value={employee.notes} onChange={(event) => patch({ notes: event.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
    <div className="flex justify-end gap-2"><button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700">Закрыть</button><button type="button" disabled={saving || !employee.fullName.trim()} onClick={() => void onSave()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-bold text-white disabled:opacity-40">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{preview ? "Сохранить в предпросмотре" : "Сохранить"}</button></div>
  </div>;
}
